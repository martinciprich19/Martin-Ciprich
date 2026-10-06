import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('036 stores player preferences in proffiles.settings', async () => {
  const db = new PGlite()
  await db.exec(`create table public.proffiles (id bigserial primary key, email text unique not null);
    insert into public.proffiles (email) values ('a@spl.sk'), ('b@spl.sk');`)
  const sql = await readFile(new URL('./036_player_settings.sql', import.meta.url), 'utf8')
  await db.exec(sql)
  await db.exec(sql) // idempotent

  const defaults = (await db.query(`select settings from proffiles order by id`)).rows
  assert.deepEqual(defaults, [{ settings: {} }, { settings: {} }])

  const preferences = { emailChallenges: false, emailMessages: true, emailTournaments: true, preferredTimeSlots: ['weekends'] }
  await db.query(`update proffiles set settings = $1::jsonb where email = 'a@spl.sk'`, [JSON.stringify(preferences)])
  const saved = (await db.query(`select email, settings from proffiles order by id`)).rows
  assert.deepEqual(saved, [{ email: 'a@spl.sk', settings: preferences }, { email: 'b@spl.sk', settings: {} }])

  await assert.rejects(db.query(`update proffiles set settings = '[1,2]'::jsonb where email = 'b@spl.sk'`), /proffiles_settings_is_object/)
  await assert.rejects(db.query(`update proffiles set settings = null where email = 'b@spl.sk'`), /null/)
  await db.close()
})
