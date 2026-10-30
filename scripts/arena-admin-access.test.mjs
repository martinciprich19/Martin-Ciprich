import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('./071_arena_admin_access.sql', import.meta.url), 'utf8')
const managerId = '10000000-0000-0000-0000-000000000001'
const otherId = '10000000-0000-0000-0000-000000000002'

async function fixture() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.arenas(
      id bigint primary key,
      name text not null,
      is_active boolean not null default true
    );
    insert into public.arenas(id, name) values (1, 'Arena One'), (2, 'Arena Two');
    insert into auth.users values
      ('${managerId}'), ('${otherId}');
  `)
  await db.exec(migration)
  await db.exec(`insert into public.arena_admins(arena_id, user_id) values (1, '${managerId}')`)
  return db
}

test('migration is repeatable and does not create a global administrator role', async () => {
  const db = await fixture()
  try {
    await db.exec(migration)
    const tables = await db.query(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('arena_admins', 'arena_courts')
      order by table_name
    `)
    assert.deepEqual(tables.rows.map((row) => row.table_name), ['arena_admins', 'arena_courts'])
    assert.match(migration, /user_id uuid not null references auth\.users\(id\)/)
    assert.doesNotMatch(migration.replace(/--.*$/gm, ''), /app_metadata|raw_user_meta_data/)
  } finally {
    await db.close()
  }
})

test('court access is limited to the assigned arena and assignment rows cannot be changed by managers', async () => {
  const db = await fixture()
  try {
    await db.exec(`
      set request.jwt.claim.sub = '${managerId}';
      set role authenticated;
      insert into public.arena_courts(arena_id, name) values (1, 'Court 1');
    `)
    assert.deepEqual(
      (await db.query('select arena_id, name from public.arena_courts order by arena_id')).rows,
      [{ arena_id: 1, name: 'Court 1' }],
    )
    await assert.rejects(
      db.exec("insert into public.arena_courts(arena_id, name) values (2, 'Court 2')"),
      /row-level security/i,
    )
    await assert.rejects(
      db.exec("delete from public.arena_courts where arena_id = 1"),
      /permission denied/i,
    )
    await assert.rejects(
      db.exec(`insert into public.arena_admins(arena_id, user_id) values (2, '${managerId}')`),
      /permission denied|row-level security/i,
    )
    await db.exec('reset role')
  } finally {
    await db.close()
  }
})

test('an account without an assignment cannot read or create courts', async () => {
  const db = await fixture()
  try {
    await db.exec(`set request.jwt.claim.sub = '${otherId}'; set role authenticated;`)
    assert.deepEqual((await db.query('select * from public.arena_courts')).rows, [])
    await assert.rejects(
      db.exec("insert into public.arena_courts(arena_id, name) values (1, 'Unauthorized Court')"),
      /row-level security/i,
    )
    await db.exec('reset role')
  } finally {
    await db.close()
  }
})
