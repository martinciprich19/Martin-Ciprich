import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('four-player result approval and atomic ELO', async (suite) => {
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
      grant usage on schema auth to authenticated;
      create table public.proffiles (
        id bigint primary key, full_name text, email text unique,
        elo_rating integer default 1000, highest_elo integer default 1000,
        matches_played integer default 0, matches_won integer default 0
      );
      grant select on public.proffiles to authenticated;
      create table public.matches (
        id bigint generated always as identity primary key,
        player1_id bigint references proffiles(id), player2_id bigint references proffiles(id),
        team1_player2_id bigint references proffiles(id), team2_player2_id bigint references proffiles(id),
        winner_id bigint references proffiles(id), match_date timestamptz,
        status text check (status in ('pending', 'approved', 'rejected')),
        player1_sets_won integer, player2_sets_won integer,
        player1_games_won integer, player2_games_won integer
      );
      insert into proffiles (id, full_name, email)
        select player_id, 'Player ' || player_id, 'player' || player_id || '@test.invalid'
        from generate_series(1, 5) as player_id;
      insert into matches (player1_id, team1_player2_id, player2_id, team2_player2_id, status)
        values (1, 2, 3, 4, 'approved');
    `)
    const migration = await readFile(new URL('./027_match_results_approval_elo.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    const legacyMatch = (await db.query('select status, elo_applied from matches')).rows[0]
    assert.equal(legacyMatch.status, 'approved')
    assert.equal(legacyMatch.elo_applied, true)

    const identity = async (id) => {
      await db.query('select set_config($1, $2, false)', ['request.jwt.claims', JSON.stringify({
        sub: '00000000-0000-0000-0000-000000000001', email: `player${id}@test.invalid`,
      })])
    }
    const reset = async (team1Elo = 1000, team2Elo = 1000) => {
      await db.exec('truncate matches restart identity')
      await db.query(`update proffiles set elo_rating = case when id in (1, 2) then $1::integer else $2::integer end,
        highest_elo = case when id in (1, 2) then $1::integer else $2::integer end, matches_played = 0, matches_won = 0`, [team1Elo, team2Elo])
      await identity(1)
    }
    const submit = async (sets = [{ team1Score: 6, team2Score: 4 }, { team1Score: 7, team2Score: 6 }]) => {
      const result = await db.query(`select submit_match_result(1, 2, 3, 4, now(), 'Test arena', $1::jsonb) as id`, [JSON.stringify(sets)])
      return result.rows[0].id
    }
    const respond = async (id, playerId, accept = true) => {
      await identity(playerId)
      const result = await db.query('select respond_to_match_result($1, $2) as status', [id, accept])
      return result.rows[0].status
    }
    const ratings = async () => (await db.query('select * from proffiles where id <= 4 order by id')).rows

    await suite.test('pending result is visible to all four participants, but not outsiders', async () => {
      await reset()
      await submit()
      for (const playerId of [1, 2, 3, 4, 5]) {
        await identity(playerId)
        await db.exec('set role authenticated')
        try {
          const rows = (await db.query('select * from matches')).rows
          assert.equal(rows.length, playerId === 5 ? 0 : 1)
          if (rows.length) assert.equal(rows[0].status, 'pending')
        } finally { await db.exec('reset role') }
      }
    })

    await suite.test('four approvals required; duplicate and concurrent retries do not add stats twice', async () => {
      await reset()
      const id = await submit()
      assert.equal(await respond(id, 1), 'pending')
      assert.equal(await respond(id, 1), 'pending')
      assert.equal(await respond(id, 2), 'pending')
      assert.equal(await respond(id, 3), 'pending')
      for (const profile of await ratings()) assert.equal(profile.matches_played, 0)
      assert.equal(await respond(id, 4), 'confirmed')
      await Promise.all([
        db.query('select respond_to_match_result($1, true)', [id]),
        db.query('select respond_to_match_result($1, true)', [id]),
      ])
      const profiles = await ratings()
      assert.deepEqual(profiles.map((profile) => profile.elo_rating), [1016, 1016, 984, 984])
      assert.deepEqual(profiles.map((profile) => profile.matches_played), [1, 1, 1, 1])
      assert.deepEqual(profiles.map((profile) => profile.matches_won), [1, 1, 0, 0])
      assert.deepEqual(profiles.map((profile) => profile.highest_elo), [1016, 1016, 1000, 1000])
    })

    await suite.test('rejection leaves ELO and stats unchanged', async () => {
      await reset()
      const id = await submit()
      await respond(id, 1)
      assert.equal(await respond(id, 3, false), 'rejected')
      await assert.rejects(respond(id, 4))
      for (const profile of await ratings()) {
        assert.equal(profile.matches_played, 0)
        assert.equal(profile.elo_rating, 1000)
      }
    })

    await suite.test('outsiders cannot submit or approve; direct writes are blocked', async () => {
      await reset()
      const id = await submit()
      await identity(5)
      await assert.rejects(submit())
      await assert.rejects(respond(id, 5))
      await db.exec('set role authenticated')
      try {
        await assert.rejects(db.query("update matches set status = 'confirmed' where id::text = $1", [id]))
        await assert.rejects(db.query("insert into matches (status) values ('pending')"))
      } finally { await db.exec('reset role') }
    })

    await suite.test('server enforces standard sets and best-of-three', async () => {
      await reset()
      for (const sets of [
        [{ team1Score: 6, team2Score: 6 }, { team1Score: 6, team2Score: 4 }],
        [{ team1Score: 10, team2Score: 4 }, { team1Score: 6, team2Score: 4 }],
        [{ team1Score: 6, team2Score: 4 }, { team1Score: 4, team2Score: 6 }],
        [{ team1Score: 6, team2Score: 4 }, { team1Score: 6, team2Score: 4 }, { team1Score: 7, team2Score: 5 }],
      ]) await assert.rejects(submit(sets))
      const id = await submit([{ team1Score: 6, team2Score: 4 }, { team1Score: 4, team2Score: 6 }, { team1Score: 7, team2Score: 5 }])
      assert.ok(id)
    })

    await suite.test('favorite gains less and underdog gains more; changes remain symmetric', async () => {
      for (const [team1Elo, team2Elo, delta] of [[1400, 1000, 3], [1000, 1400, 29]]) {
        await reset(team1Elo, team2Elo)
        const id = await submit()
        for (const playerId of [1, 2, 3, 4]) await respond(id, playerId)
        const profiles = await ratings()
        assert.deepEqual(profiles.map((profile) => profile.elo_rating), [team1Elo + delta, team1Elo + delta, team2Elo - delta, team2Elo - delta])
      }
    })

    await suite.test('authenticated RPC callers can confirm a second-team win', async () => {
      await reset()
      const id = await submit([{ team1Score: 4, team2Score: 6 }, { team1Score: 6, team2Score: 7 }])
      for (const playerId of [1, 2, 3, 4]) {
        await identity(playerId)
        await db.exec('set role authenticated')
        try {
          const result = await db.query('select respond_to_match_result($1, true) as status', [id])
          assert.equal(result.rows[0].status, playerId === 4 ? 'confirmed' : 'pending')
        } finally { await db.exec('reset role') }
      }
      const profiles = await ratings()
      assert.deepEqual(profiles.map((profile) => profile.elo_rating), [984, 984, 1016, 1016])
      assert.deepEqual(profiles.map((profile) => profile.matches_won), [0, 0, 1, 1])
    })
  } finally { await db.close() }
})