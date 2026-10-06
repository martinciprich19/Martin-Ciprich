import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')

test('player statistics follow confirmed matches (insert, delete, reject, edit)', async (suite) => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth;
      create function auth.jwt() returns jsonb language sql as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
      $$;
      create function auth.uid() returns uuid language sql as $$
        select (auth.jwt() ->> 'sub')::uuid;
      $$;
      create function auth.role() returns text language sql as $$
        select auth.jwt() ->> 'role';
      $$;
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
    for (const name of ['027_match_results_approval_elo.sql', '029_match_confirmation_elo_on_full_approval.sql', '030_fix_submit_match_result_player_mapping.sql', '031_player_stats_from_confirmed_matches.sql']) {
      await db.exec(await migration(name))
    }

    const identity = async (id) => {
      await db.query('select set_config($1, $2, false)', ['request.jwt.claims', JSON.stringify({
        sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated', email: `player${id}@test.invalid`,
      })])
    }
    const stats = async () => (await db.query('select id, elo_rating, highest_elo, matches_played, matches_won from proffiles order by id')).rows
    const played = async () => (await stats()).map((row) => row.matches_played)
    const confirmMatch = async (date, team1Wins = true) => {
      await identity(1)
      const sets = team1Wins ? [{ team1Score: 6, team2Score: 4 }, { team1Score: 6, team2Score: 3 }] : [{ team1Score: 4, team2Score: 6 }, { team1Score: 3, team2Score: 6 }]
      const id = (await db.query(`select submit_match_result(1, 2, 3, 4, $1::timestamptz, 'Arena', $2::jsonb) as id`, [date, JSON.stringify(sets)])).rows[0].id
      for (const playerId of [1, 2, 3, 4]) {
        await identity(playerId)
        await db.query('select respond_to_match_result($1, true)', [id])
      }
      return id
    }
    const asAdmin = async (sql, params) => {
      await db.query("select set_config('request.jwt.claims', '', false)")
      return db.query(sql, params)
    }

    await suite.test('pending matches do not count; full confirmation counts once', async () => {
      await identity(1)
      const id = (await db.query(`select submit_match_result(1, 2, 3, 4, now(), 'Arena', '[{"team1Score":6,"team2Score":4},{"team1Score":6,"team2Score":2}]'::jsonb) as id`)).rows[0].id
      for (const playerId of [1, 2, 3]) { await identity(playerId); await db.query('select respond_to_match_result($1, true)', [id]) }
      assert.deepEqual(await played(), [0, 0, 0, 0])
      await identity(4)
      assert.equal((await db.query('select respond_to_match_result($1, true) as s', [id])).rows[0].s, 'confirmed')
      assert.deepEqual(await stats(), [
        { id: 1, elo_rating: 1016, highest_elo: 1016, matches_played: 1, matches_won: 1 },
        { id: 2, elo_rating: 1016, highest_elo: 1016, matches_played: 1, matches_won: 1 },
        { id: 3, elo_rating: 984, highest_elo: 1000, matches_played: 1, matches_won: 0 },
        { id: 4, elo_rating: 984, highest_elo: 1000, matches_played: 1, matches_won: 0 },
      ])
      await asAdmin('delete from matches')
    })

    await suite.test('deleting a confirmed match recalculates stats and ELO', async () => {
      assert.deepEqual(await played(), [0, 0, 0, 0])
      const first = await confirmMatch('2026-01-01')
      await confirmMatch('2026-02-01', false)
      assert.deepEqual(await played(), [2, 2, 2, 2])
      await asAdmin('delete from matches where id = $1', [first])
      const rows = await stats()
      assert.deepEqual(rows.map((row) => row.matches_played), [1, 1, 1, 1])
      assert.deepEqual(rows.map((row) => row.matches_won), [0, 0, 1, 1])
      assert.deepEqual(rows.map((row) => row.elo_rating), [984, 984, 1016, 1016])
      assert.deepEqual(rows.map((row) => row.highest_elo), [1000, 1000, 1016, 1016])
    })

    await suite.test('rejecting or editing a confirmed match is reflected', async () => {
      const [{ id }] = (await db.query('select id from matches')).rows
      await asAdmin("update matches set winner_id = player1_id where id = $1", [id])
      assert.deepEqual((await stats()).map((row) => row.matches_won), [1, 1, 0, 0])
      await asAdmin("update matches set status = 'rejected' where id = $1", [id])
      assert.deepEqual(await stats(), [1, 2, 3, 4].map((id) => ({ id, elo_rating: 1000, highest_elo: 1000, matches_played: 0, matches_won: 0 })))
      const elo = (await db.query('select elo_applied, elo_delta_team1 from matches where id = $1', [id])).rows[0]
      assert.deepEqual(elo, { elo_applied: false, elo_delta_team1: null })
    })

    await suite.test('truncate resets everything; clients still cannot write stats directly', async () => {
      await confirmMatch('2026-03-01')
      assert.deepEqual(await played(), [1, 1, 1, 1])
      await asAdmin('truncate matches')
      assert.deepEqual(await played(), [0, 0, 0, 0])
      await identity(1)
      await db.exec('set role authenticated')
      try {
        await assert.rejects(db.query('update proffiles set matches_played = 99 where id = 1'))
      } finally { await db.exec('reset role') }
    })
  } finally {
    await db.close()
  }
})
