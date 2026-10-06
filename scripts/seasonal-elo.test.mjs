import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')

test('seasonal ELO resets every half-year, career ELO is continuous', async (suite) => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth;
      create function auth.jwt() returns jsonb language sql as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
      $$;
      create function auth.uid() returns uuid language sql as $$ select (auth.jwt() ->> 'sub')::uuid; $$;
      create function auth.role() returns text language sql as $$ select auth.jwt() ->> 'role'; $$;
      grant usage on schema auth to authenticated;
      create table public.proffiles (
        id bigint primary key, full_name text, email text unique,
        elo_rating integer default 1000, highest_elo integer default 1000,
        matches_played integer default 0, matches_won integer default 0
      );
      grant select, update on public.proffiles to authenticated;
      create table public.matches (
        id bigint generated always as identity primary key,
        player1_id bigint references proffiles(id), player2_id bigint references proffiles(id),
        team1_player2_id bigint references proffiles(id), team2_player2_id bigint references proffiles(id),
        winner_id bigint references proffiles(id), match_date timestamptz,
        status text, player1_sets_won integer, player2_sets_won integer,
        player1_games_won integer, player2_games_won integer
      );
      insert into proffiles (id, full_name, email)
        select player_id, 'Player ' || player_id, 'player' || player_id || '@test.invalid'
        from generate_series(1, 4) as player_id;
    `)
    for (const name of [
      '027_match_results_approval_elo.sql', '029_match_confirmation_elo_on_full_approval.sql',
      '031_player_stats_from_confirmed_matches.sql', '032_create_submit_match_result.sql',
      '033_fix_respond_to_match_result_overload.sql', '034_seasonal_and_career_elo.sql',
      '035_fix_recalculate_safeupdate.sql',
    ]) await db.exec(await migration(name))

    // Supabase's pg_safeupdate rejects UPDATE/DELETE without WHERE for API calls.
    await suite.test('no installed function runs UPDATE/DELETE without WHERE (pg_safeupdate)', async () => {
      const functions = (await db.query(`select p.proname, p.prosrc from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows
      const statement = /\b(update\s+(only\s+)?[\w.]+(\s+as\s+\w+)?\s+set\b|delete\s+from\b)[^;]*;/gis
      const offenders = functions.flatMap(({ proname, prosrc }) =>
        [...prosrc.matchAll(statement)].filter(([sql]) => !/\bwhere\b/i.test(sql)).map(([sql]) => `${proname}: ${sql}`))
      assert.deepEqual(offenders, [])
    })

    const currentSeason = (await db.query(`select public.spl_season_start(now())::text as s`)).rows[0].s
    const previousSeasonDate = (await db.query(`select (public.spl_season_start(now()) - interval '2 months')::text as d`)).rows[0].d
    const currentSeasonDate = (await db.query(`select (public.spl_season_start(now()) + interval '1 day')::text as d`)).rows[0].d
    const confirmed = (date, winner) => db.query(
      `insert into matches (player1_id, team1_player2_id, player2_id, team2_player2_id, winner_id, match_date, status)
       values (1, 2, 3, 4, $1, $2::timestamptz, 'confirmed') returning id`, [winner, date])
    const ratings = async () => (await db.query(
      'select id, elo_rating, career_elo, highest_elo, matches_played, elo_season_start::text as season from proffiles order by id')).rows

    await suite.test('season boundaries are 1. január and 1. júl (Bratislava time)', async () => {
      const rows = (await db.query(`select
        public.spl_season_start('2026-06-30 21:59:59+00')::text as a,
        public.spl_season_start('2026-06-30 22:00:00+00')::text as b,
        public.spl_season_start('2026-12-31 22:59:59+00')::text as c,
        public.spl_season_start('2026-12-31 23:00:00+00')::text as d`)).rows[0]
      assert.deepEqual(rows, { a: '2026-01-01', b: '2026-07-01', c: '2026-07-01', d: '2027-01-01' })
    })

    await suite.test('previous-season matches move career ELO only', async () => {
      await confirmed(previousSeasonDate, 1)
      const rows = await ratings()
      assert.deepEqual(rows.map((r) => r.elo_rating), [1000, 1000, 1000, 1000])
      assert.deepEqual(rows.map((r) => r.career_elo), [1016, 1016, 984, 984])
      assert.deepEqual(rows.map((r) => r.highest_elo), [1016, 1016, 1000, 1000])
      assert.deepEqual(rows.map((r) => r.matches_played), [1, 1, 1, 1])
      assert.ok(rows.every((r) => r.season === currentSeason))
    })

    await suite.test('current-season match: seasonal starts from base, career continues', async () => {
      const { rows: [{ id }] } = await confirmed(currentSeasonDate, 3)
      const rows = await ratings()
      assert.deepEqual(rows.map((r) => r.elo_rating), [984, 984, 1016, 1016])
      assert.deepEqual(rows.map((r) => r.career_elo), [999, 999, 1001, 1001])
      const deltas = (await db.query('select elo_delta_team1, career_elo_delta_team1 from matches where id = $1', [id])).rows[0]
      assert.deepEqual(deltas, { elo_delta_team1: -16, career_elo_delta_team1: -17 })
    })

    await suite.test('deleting the current-season match restores both ratings', async () => {
      await db.exec(`delete from matches where match_date >= public.spl_season_start(now())`)
      const rows = await ratings()
      assert.deepEqual(rows.map((r) => r.elo_rating), [1000, 1000, 1000, 1000])
      assert.deepEqual(rows.map((r) => r.career_elo), [1016, 1016, 984, 984])
    })

    await suite.test('season rollover via refresh_season_ratings()', async () => {
      await db.exec(`select set_config('spl.match_stats_update', 'on', false);
        update proffiles set elo_rating = 1234, elo_season_start = '2000-01-01';
        select set_config('spl.match_stats_update', 'off', false);`)
      await db.exec('select public.refresh_season_ratings()')
      const rows = await ratings()
      assert.deepEqual(rows.map((r) => r.elo_rating), [1000, 1000, 1000, 1000])
      assert.ok(rows.every((r) => r.season === currentSeason))
    })

    await suite.test('clients cannot write career ELO or season directly', async () => {
      await db.query('select set_config($1, $2, false)', ['request.jwt.claims', JSON.stringify({
        sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated', email: 'player1@test.invalid',
      })])
      await db.exec('set role authenticated')
      try {
        await assert.rejects(db.query('update proffiles set career_elo = 5000 where id = 1'))
        await assert.rejects(db.query('update proffiles set starting_elo = 5000 where id = 1'))
      } finally {
        await db.exec('reset role')
        await db.query("select set_config('request.jwt.claims', '', false)")
      }
    })
  } finally {
    await db.close()
  }
})
