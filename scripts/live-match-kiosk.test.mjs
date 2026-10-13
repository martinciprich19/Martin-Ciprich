import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('confirmed pair challenge gets a one-time kiosk PIN', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.jwt() returns jsonb language sql as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
      $$;
      create function auth.uid() returns uuid language sql as $$
        select (auth.jwt() ->> 'sub')::uuid;
      $$;
      create table public.proffiles(id bigint primary key, full_name text, email text);
      create table public.challenges(
        id text primary key,
        challenger_1_id bigint,
        challenger_2_id bigint,
        challenged_1_id bigint,
        challenged_2_id bigint,
        status text,
        challenger_2_accepted boolean not null default false,
        challenged_1_accepted boolean not null default false,
        challenged_2_accepted boolean not null default false
      );
      create table public.notifications(user_id bigint, challenge_id text, type text, is_read boolean);
      insert into public.proffiles values
        (1, 'Player A1', 'a1@example.test'),
        (2, 'Player A2', 'a2@example.test'),
        (3, 'Player B1', 'b1@example.test'),
        (4, 'Player B2', 'b2@example.test');
      insert into public.challenges (
        id, challenger_1_id, challenger_2_id, challenged_1_id, challenged_2_id, status
      ) values ('challenge-1', 1, 2, 3, 4, 'pending');
    `)

    const scoreboardMigration = await readFile(new URL('./041_live_match_scoreboard.sql', import.meta.url), 'utf8')
    const kioskMigration = await readFile(new URL('./042_live_match_kiosk_pin.sql', import.meta.url), 'utf8')
    await db.exec(scoreboardMigration)
    await db.exec(kioskMigration)
    await db.exec(kioskMigration)
    const quickGameMigration = await readFile(new URL('./043_quick_live_matches.sql', import.meta.url), 'utf8')
    await db.exec(quickGameMigration)
    await db.exec(quickGameMigration)
    const playerScoreMigration = await readFile(new URL('./044_live_match_players_sets.sql', import.meta.url), 'utf8')
    await db.exec(playerScoreMigration)
    await db.exec(playerScoreMigration)

    await db.exec('set role anon')
    const quickGames = []
    for (let index = 0; index < 2; index++) {
      const { rows: [quickGame] } = await db.query(`
        insert into public.live_matches (serving_team, initial_server_chosen)
        values ('TEAM_A', true)
        returning id, challenge_id, is_pin_activated, team_a_game_score
      `)
      assert.equal(quickGame.challenge_id, null)
      assert.equal(quickGame.is_pin_activated, false)
      assert.equal(quickGame.team_a_game_score, 0)
      quickGames.push(quickGame)
    }
    assert.notEqual(quickGames[0].id, quickGames[1].id)
    const { rows: [scoredQuickGame] } = await db.query(
      'update public.live_matches set team_a_game_score = 15 where id = $1 returning team_a_game_score',
      [quickGames[0].id],
    )
    assert.equal(scoredQuickGame.team_a_game_score, 15)
    const { rows: [extendedScore] } = await db.query(
      'update public.live_matches set team_a_games = 4, team_b_games = 3, team_a_sets = 1, serving_player = 2 where id = $1 returning team_a_games, team_b_games, team_a_sets, serving_player, team_a_player2_name',
      [quickGames[0].id],
    )
    assert.equal(extendedScore.team_a_games, 4)
    assert.equal(extendedScore.team_b_games, 3)
    assert.equal(extendedScore.team_a_sets, 1)
    assert.equal(extendedScore.serving_player, 2)
    assert.equal(extendedScore.team_a_player2_name, 'Hráč 2')
    await assert.rejects(db.query('update public.live_matches set serving_player = 3 where id = $1', [quickGames[0].id]))
    await assert.rejects(db.query('update public.live_matches set team_a_sets = -1 where id = $1', [quickGames[0].id]))
    await assert.rejects(db.query("insert into public.live_matches (match_pin) values ('4829')"))
    await assert.rejects(db.query("insert into public.live_matches (challenge_id) values ('fake-challenge')"))
    await db.exec('reset role')

    for (const [profileId, email] of [[2, 'a2@example.test'], [3, 'b1@example.test'], [4, 'b2@example.test']]) {
      await db.query('select set_config($1, $2, false)', [
        'request.jwt.claims',
        JSON.stringify({ sub: `00000000-0000-0000-0000-${String(profileId).padStart(12, '0')}`, email }),
      ])
      const { rows } = await db.query(
        'select public.respond_to_pair_challenge($1, true) as status',
        ['challenge-1'],
      )
      assert.equal(rows[0].status, profileId === 4 ? 'accepted' : 'pending')
      const matches = await db.query('select id from public.live_matches where challenge_id = $1', ['challenge-1'])
      assert.equal(matches.rows.length, profileId === 4 ? 1 : 0)
    }

    const { rows: [match] } = await db.query(
      'select id, match_pin, is_pin_activated, team_a_player1_name, team_a_player2_name, team_b_player1_name, team_b_player2_name from public.live_matches where challenge_id = $1',
      ['challenge-1'],
    )
    assert.match(match.match_pin, /^\d{4}$/)
    assert.equal(match.is_pin_activated, false)
    assert.equal(match.team_a_player1_name, 'Player A1')
    assert.equal(match.team_a_player2_name, 'Player A2')
    assert.equal(match.team_b_player1_name, 'Player B1')
    assert.equal(match.team_b_player2_name, 'Player B2')
    await db.exec('set role anon')
    assert.equal((await db.query('select id from public.live_matches where id = $1', [match.id])).rows.length, 0)
    await db.exec('reset role')
    const unusedPin = String((Number(match.match_pin) + 1) % 10000).padStart(4, '0')
    await assert.rejects(db.query('select public.activate_live_match_pin($1)', [unusedPin]))
    assert.equal(
      (await db.query('select public.activate_live_match_pin($1) as id', [match.match_pin])).rows[0].id,
      match.id,
    )
    await assert.rejects(db.query('select public.activate_live_match_pin($1)', [match.match_pin]))

    await db.exec('set role anon')
    assert.equal((await db.query('select id from public.live_matches where id = $1', [match.id])).rows.length, 1)
    await db.query('update public.live_matches set team_a_game_score = 15 where id = $1', [match.id])
    await assert.rejects(db.query('select match_pin from public.live_matches where id = $1', [match.id]))
    await assert.rejects(db.query("update public.live_matches set match_pin = '0000' where challenge_id = 'challenge-1'"))
    await db.exec('reset role')
  } finally {
    await db.close()
  }
})
