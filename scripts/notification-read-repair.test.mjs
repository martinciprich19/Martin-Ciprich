import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('./109_repair_notification_read.sql', import.meta.url), 'utf8')
const first = '00000000-0000-0000-0000-000000000001'
const second = '00000000-0000-0000-0000-000000000002'

for (const countryColumns of [true, false]) {
  test(`repair marks only the caller's notifications and applicable announcements (country columns: ${countryColumns})`, async () => {
    const db = new PGlite()
    try {
      await db.exec(`
        create role anon;
        create role authenticated;
        create schema auth;
        create table auth.users (id uuid primary key, email text);
        insert into auth.users values ('${first}', 'one@example.test'), ('${second}', 'two@example.test');
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        create function auth.jwt() returns jsonb language sql stable as $$
          select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
        $$;
        create table public.proffiles (id bigint primary key, email text not null${countryColumns ? ', country_code text' : ''});
        grant select on public.proffiles to authenticated;
        insert into public.proffiles values (1, 'one@example.test'${countryColumns ? ", 'SK'" : ''}), (2, 'two@example.test'${countryColumns ? ", 'NL'" : ''});
        create table public.notifications (id bigint primary key, user_id bigint, is_read boolean not null default false${countryColumns ? ', country_code text' : ''});
        insert into public.notifications values (1, 1, false${countryColumns ? ', null' : ''}), (2, 2, false${countryColumns ? ', null' : ''}), (3, null, false${countryColumns ? ', null' : ''})${countryColumns ? ", (4, null, false, 'SK'), (5, null, false, 'NL')" : ''};
      `)
      await db.exec(migration)
      await db.exec(migration)
      await db.exec(`set role authenticated;
        set request.jwt.claim.sub = '${first}';
        set request.jwt.claims = '{"email":"one@example.test"}';`)
      await db.query('select public.mark_notifications_as_read()')
      await db.query('select public.mark_notifications_as_read()')
      const receipts = (await db.query('select notification_id from public.notification_read_receipts order by notification_id')).rows.map(row => row.notification_id)
      assert.deepEqual(receipts, countryColumns ? ['3', '4'] : ['3'])
      await db.exec('reset role')
      const notifications = (await db.query('select id, is_read from public.notifications order by id')).rows
      assert.equal(notifications[0].is_read, true)
      assert.equal(notifications[1].is_read, false)
      assert.equal(notifications[2].is_read, false)
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${second}'; set request.jwt.claims = '{"email":"two@example.test"}';`)
      assert.equal((await db.query('select count(*)::int as count from public.notification_read_receipts')).rows[0].count, 0)
      await db.query('select public.mark_notifications_as_read()')
      assert.deepEqual((await db.query('select notification_id from public.notification_read_receipts order by notification_id')).rows.map(row => row.notification_id), countryColumns ? ['3', '5'] : ['3'])
      await db.exec("set request.jwt.claim.sub = '';")
      await assert.rejects(db.query('select public.mark_notifications_as_read()'), /Prihlásenie je potrebné/)
    } finally {
      await db.close()
    }
  })
}
