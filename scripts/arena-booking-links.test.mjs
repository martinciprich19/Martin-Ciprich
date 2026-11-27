import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('./107_arena_booking_links.sql', import.meta.url), 'utf8')
const superAdmin = '00000000-0000-0000-0000-000000000091'
const otherUser = '00000000-0000-0000-0000-000000000092'

test('booking links are managed only by the super admin and creation is atomic', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function public.is_super_admin() returns boolean language sql stable as $$
        select coalesce(current_setting('request.jwt.claim.role', true) = 'super_admin', false)
      $$;
      create table public.arenas (id bigint generated always as identity primary key, name text not null, booking_url text);
      grant select, insert, update on public.arenas to authenticated;
      create function public.super_admin_create_arena(text, text, text, text, text, integer)
      returns bigint language plpgsql security definer as $$
      declare result bigint;
      begin
        insert into public.arenas(name) values ($1) returning id into result;
        return result;
      end;
      $$;
    `)
    await db.exec(migration)
    await db.exec(migration)
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${superAdmin}'; set request.jwt.claim.role = 'super_admin';`)
    const create = 'select public.super_admin_create_arena_with_booking($1, $2, $3, $4, $5, $6, $7) as id'
    const args = ['Club', 'City', 'Address', 'SK', 'Region', 2, 'https://booking.example.test/slot']
    const id = (await db.query(create, args)).rows[0].id
    assert.equal((await db.query('select booking_url from public.arenas where id = $1', [id])).rows[0].booking_url, args[6])
    await db.query('select public.super_admin_set_arena_booking_url($1, $2)', [id, ' https://other.example.test/ '])
    assert.equal((await db.query('select booking_url from public.arenas where id = $1', [id])).rows[0].booking_url, 'https://other.example.test/')
    for (const invalid of ['javascript:alert(1)', 'http://example.test', 'https://user@example.test', 'https://example.test\\@evil.test']) {
      await assert.rejects(db.query('select public.super_admin_set_arena_booking_url($1, $2)', [id, invalid]), /HTTPS/)
      await assert.rejects(db.query(create, [...args.slice(0, 6), invalid]), /HTTPS/)
    }
    assert.equal((await db.query('select count(*)::int as count from public.arenas')).rows[0].count, 1)
    await db.query('select public.super_admin_set_arena_booking_url($1, $2)', [id, ''])
    assert.equal((await db.query('select booking_url from public.arenas where id = $1', [id])).rows[0].booking_url, null)
    await assert.rejects(db.query('select public.super_admin_set_arena_booking_url($1, $2)', [999, null]), /Arena not found/)
    await db.exec(`set request.jwt.claim.sub = '${otherUser}'; set request.jwt.claim.role = 'admin';`)
    await assert.rejects(db.query('select public.super_admin_set_arena_booking_url($1, $2)', [id, args[6]]), /Super Admin/)
    await assert.rejects(db.query('update public.arenas set booking_url = $1 where id = $2', [args[6], id]), /Super Admin/)
    await assert.rejects(db.query(create, args), /Super Admin/)
  } finally {
    await db.close()
  }
})

test('arena cards show only a safe external booking button when a link is configured', async () => {
  const card = await readFile(new URL('../components/arenas-view.tsx', import.meta.url), 'utf8')
  const dashboard = await readFile(new URL('../components/super-admin-dashboard.tsx', import.meta.url), 'utf8')
  assert.match(card, /arena\.bookingUrl \? <a href=\{arena\.bookingUrl\} target="_blank" rel="noopener noreferrer"/)
  assert.match(card, /t\('Rezervovať kurt'\)/)
  assert.match(dashboard, /super_admin_create_arena_with_booking/)
  assert.match(dashboard, /super_admin_set_arena_booking_url/)
})
