import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('profile gender is saved from signup metadata without inferring old accounts', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema auth;
      create table auth.users (email text primary key, raw_user_meta_data jsonb);
      create table public.proffiles (id bigint generated always as identity primary key, email text);
      insert into auth.users values
        ('existing@test.invalid', '{"gender":"female"}'),
        ('legacy@test.invalid', '{}');
      insert into proffiles (email) values ('existing@test.invalid'), ('legacy@test.invalid');
    `)
    await db.exec(await readFile(new URL('./028_profile_gender.sql', import.meta.url), 'utf8'))
    const existing = (await db.query('select email, gender from proffiles order by id')).rows
    assert.equal(existing[0].gender, 'female')
    assert.equal(existing[1].gender, null)
    await db.exec(`
      insert into auth.users values ('new@test.invalid', '{"gender":"male"}');
      insert into proffiles (email) values ('NEW@test.invalid');
    `)
    assert.equal((await db.query("select gender from proffiles where email = 'NEW@test.invalid'")).rows[0].gender, 'male')
    await db.exec("insert into proffiles (email, gender) values ('explicit@test.invalid', 'female')")
    assert.equal((await db.query("select gender from proffiles where email = 'explicit@test.invalid'")).rows[0].gender, 'female')
    await assert.rejects(db.query("insert into proffiles (email, gender) values ('invalid@test.invalid', 'invalid')"))
  } finally {
    await db.close()
  }
})