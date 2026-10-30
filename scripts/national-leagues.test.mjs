import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('./068_national_leagues.sql', import.meta.url), 'utf8')

test('national league preparation preserves data, supports Dutch signup and is repeatable', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
      create table public.proffiles(
        id bigint generated always as identity primary key,
        email text, region text, elo_rating integer default 1000
      );
      create table public.arenas(id bigint primary key, region text);
      create table public.pairs(id bigint primary key);
      create table public.challenges(id text primary key);
      create table public.matches(id bigint primary key, result_sets jsonb);
      create table public.live_matches(id uuid primary key, team_a_games integer);
      create table public.player_requests(id bigint primary key);
      insert into public.proffiles(email, region, elo_rating) values
        ('old@example.test', 'Bratislavský kraj', 1234),
        ('unknown@example.test', 'Legacy region', 900);
      insert into public.arenas values (1, 'Žilinský kraj');
      insert into public.matches values (1, '[[6,3],[6,4]]');
      insert into public.live_matches values ('00000000-0000-0000-0000-000000000001', 5);
      create function public.no_live_updates() returns trigger language plpgsql as $$
        begin raise exception 'Existing live match cannot be changed'; end;
      $$;
      create trigger no_live_updates before update on public.live_matches
        for each row execute function public.no_live_updates();
    `)
    await db.exec(migration)
    await db.exec(migration)
    assert.deepEqual((await db.query(`
      select country_code, count(*)::int as total from league_subdivisions
      group by country_code order by country_code
    `)).rows, [{ country_code: 'NL', total: 12 }, { country_code: 'SK', total: 8 }])
    assert.deepEqual((await db.query(`
      select country_code, preferred_language, subdivision_code, elo_rating
      from proffiles where email='old@example.test'
    `)).rows[0], { country_code: 'SK', preferred_language: 'sk', subdivision_code: 'SK-BL', elo_rating: 1234 })
    assert.deepEqual((await db.query(`
      select region, subdivision_code from proffiles where email='unknown@example.test'
    `)).rows[0], { region: 'Legacy region', subdivision_code: null })
    assert.deepEqual((await db.query('select country_code, subdivision_code from arenas')).rows[0],
      { country_code: 'SK', subdivision_code: 'SK-ZI' })
    assert.deepEqual((await db.query('select result_sets, country_code from matches')).rows[0],
      { result_sets: [[6, 3], [6, 4]], country_code: 'SK' })
    assert.deepEqual((await db.query('select country_code, team_a_games from live_matches')).rows[0],
      { country_code: 'SK', team_a_games: 5 })

    await db.exec(`
      insert into auth.users values
        ('11111111-1111-4111-8111-111111111111', 'nl@example.test',
          '{"country_code":"NL","subdivision_code":"NL-NH"}'),
        ('22222222-2222-4222-8222-222222222222', 'english@example.test',
          '{"country_code":"NL","preferred_language":"en","subdivision_code":"NL-UT"}');
      insert into proffiles(email, region) values ('nl@example.test',''), ('english@example.test','');
      insert into proffiles(email, region) values ('legacy-signup@example.test','Trnavský kraj');
    `)
    assert.deepEqual((await db.query(`
      select country_code, preferred_language, subdivision_code, region
      from proffiles where email='nl@example.test'
    `)).rows[0], { country_code: 'NL', preferred_language: 'nl', subdivision_code: 'NL-NH', region: 'Noord-Holland' })
    assert.equal((await db.query("select preferred_language from proffiles where email='english@example.test'")).rows[0].preferred_language, 'en')
    assert.equal((await db.query("select preferred_language from proffiles where email='legacy-signup@example.test'")).rows[0].preferred_language, 'sk')
    await db.exec(migration)
    assert.equal((await db.query("select country_code from proffiles where email='nl@example.test'")).rows[0].country_code, 'NL')
    await assert.rejects(db.exec("update proffiles set subdivision_code='SK-BL' where email='nl@example.test'"), /Subdivision/)
    await assert.rejects(db.exec("update proffiles set country_code='XX' where email='nl@example.test'"), /foreign key/)
    await assert.rejects(db.exec("update proffiles set preferred_language='xx' where email='nl@example.test'"), /check constraint/)
    await db.exec("update proffiles set region='Zeeland' where email='nl@example.test'")
    assert.equal((await db.query("select subdivision_code from proffiles where email='nl@example.test'")).rows[0].subdivision_code, 'NL-ZE')

    await db.exec('set role anon')
    assert.equal((await db.query('select * from league_subdivisions')).rows.length, 20)
    await assert.rejects(db.exec("insert into league_countries values ('XX','Test','en')"), /permission denied/)
    await assert.rejects(db.exec("delete from league_subdivisions"), /permission denied/)
  } finally {
    await db.close()
  }
})

test('missing prerequisites abort the whole migration without partial schema changes', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated;')
    await assert.rejects(db.exec(migration), /Missing required table public.proffiles/)
    await db.exec('rollback')
    assert.equal((await db.query("select to_regclass('public.league_countries') as table_name")).rows[0].table_name, null)
  } finally {
    await db.close()
  }
})
