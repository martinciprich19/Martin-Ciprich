import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { awardLivePoint, parseRecordedMatchStatistics } from '../lib/live-match-scoring.ts'

test('QR registration, final-result submission and four-player ELO approval', async () => {
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
        id bigint primary key, full_name text, email text unique, avatar_url text,
        elo_rating integer default 1000, highest_elo integer default 1000,
        matches_played integer default 0, matches_won integer default 0
      );
      grant select on public.proffiles to authenticated;
      create table public.matches (
        id bigint generated always as identity primary key,
        player1_id bigint, player2_id bigint, team1_player2_id bigint, team2_player2_id bigint,
        winner_id bigint, match_date timestamptz, status text,
        player1_sets_won integer, player2_sets_won integer,
        player1_games_won integer, player2_games_won integer
      );
      create table public.challenges (
        id bigint primary key, challenger_1_id bigint, challenger_2_id bigint,
        challenged_1_id bigint, challenged_2_id bigint, status text,
        challenger_2_accepted boolean default false,
        challenged_1_accepted boolean default false, challenged_2_accepted boolean default false
      );
      create table public.notifications(user_id bigint, challenge_id bigint, type text, is_read boolean);
      grant select on public.challenges to authenticated;
      insert into proffiles (id, full_name, email)
        select id, 'Player ' || id, 'player' || id || '@test.invalid' from generate_series(1,5) id;
    `)
    for (const file of [
      '027_match_results_approval_elo.sql', '032_create_submit_match_result.sql',
      '029_match_confirmation_elo_on_full_approval.sql',
      '041_live_match_scoreboard.sql', '042_live_match_kiosk_pin.sql',
      '043_quick_live_matches.sql', '044_live_match_players_sets.sql',
      '045_live_match_finish_statistics.sql', '046_live_match_serve_statistics.sql',
      '047_live_match_duration_and_stats.sql', '048_qr_registered_live_matches.sql',
      '048_qr_registered_live_matches.sql',
      '050_live_match_set_statistics.sql', '050_live_match_set_statistics.sql',
      '051_live_match_player_avatars.sql', '051_live_match_player_avatars.sql',
    ]) await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'))
    const historicalId = (await db.query("insert into live_matches (team_a_game_score,started_at) values (15,now()) returning id")).rows[0].id
    for (let retry = 0; retry < 2; retry++) {
      await db.exec(await readFile(new URL('053_extended_match_statistics.sql', import.meta.url), 'utf8'))
      await db.exec(await readFile(new URL('054_profile_serve_return_statistics.sql', import.meta.url), 'utf8'))
    }
    assert.equal((await db.query('select service_game_statistics from live_matches where id=$1', [historicalId])).rows[0].service_game_statistics, null)
    await assert.rejects(db.query(`update live_matches set service_game_statistics =
      '{"team_a_won":null,"team_a_lost":0,"team_b_won":0,"team_b_lost":0}' where id=$1`, [historicalId]), /check constraint/)

    const identity = async (id) => {
      await db.query('select set_config($1, $2, false)', ['request.jwt.claims', JSON.stringify({
        sub: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`,
        email: `player${id}@test.invalid`,
        role: 'authenticated',
      })])
    }
    const liveId = '00000000-0000-0000-0000-000000000100'
    const create = (ids = [1, 2, 3, 4], id = liveId) => db.query(
      'select create_qr_live_match($1::uuid, $2, $3, $4, $5, $6) as id',
      [id, ...ids, 'QR test court'],
    )
    await identity(5)
    await assert.rejects(create(), /organizator/)
    await identity(1)
    await db.exec('set role authenticated')
    await assert.rejects(create([1, 1, 3, 4]), /roznych/)
    await assert.rejects(create([1, 2, 3, 999]), /roznych/)
    assert.equal((await create()).rows[0].id, liveId)
    assert.equal((await create()).rows[0].id, liveId)
    await assert.rejects(create([1, 3, 2, 4]), /pouzite/)
    const live = (await db.query('select * from live_matches where id = $1', [liveId])).rows[0]
    const photos = (await db.query('select * from live_match_player_avatars($1)', [liveId])).rows
    assert.deepEqual(photos.map((p) => p.player_slot), [0, 1, 2, 3])
    assert.ok(photos.every((p) => p.avatar_url === null))
    assert.equal(live.team_a_player1_name, 'Player 1')
    assert.equal(live.team_a_player2_name, 'Player 2')
    assert.equal(live.team_b_player1_name, 'Player 3')
    assert.equal(live.team_b_player2_name, 'Player 4')
    assert.equal(live.qr_created_by, 1)
    assert.equal(live.official_result_id, null)
    await assert.rejects(db.query('update live_matches set qr_created_by = 2 where id = $1', [liveId]))
    await assert.rejects(db.query('insert into live_matches (qr_created_by) values (1)'))
    await db.exec('reset role')

    await db.exec('set role anon')
    await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ role: 'anon' })])
    await assert.rejects(db.query('select * from live_match_player_avatars($1)', [liveId]), /pristup/)
    assert.equal((await db.query('select id from live_matches where id = $1', [liveId])).rows.length, 0)
    assert.equal((await db.query('update live_matches set team_a_game_score = 15 where id = $1 returning id', [liveId])).rows.length, 0)
    await db.exec('reset role')
    for (const id of [2, 5]) {
      await identity(id)
      await db.exec('set role authenticated')
      assert.equal((await db.query('select id from live_matches where id = $1', [liveId])).rows.length, id === 2 ? 1 : 0)
      if (id === 2) assert.equal((await db.query('select * from live_match_player_avatars($1)', [liveId])).rows.length, 4)
      else await assert.rejects(db.query('select * from live_match_player_avatars($1)', [liveId]), /pristup/)
      assert.equal((await db.query('update live_matches set team_a_game_score = 15 where id = $1 returning id', [liveId])).rows.length, 0)
      await db.exec('reset role')
    }

    await identity(1)
    await db.exec('set role authenticated')
    let score = { ...live, serving_team: 'TEAM_A', initial_server_chosen: true }
    for (let point = 0; point < 48; point++) {
      score = awardLivePoint(score, 'TEAM_A', `2026-10-13T10:${point < 47 ? '00' : '30'}:00.000Z`)
      const { id, team_a_player1_name, team_a_player2_name, team_b_player1_name, team_b_player2_name,
        team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id,
        qr_created_by, qr_arena_name, official_result_id, challenge_id, match_pin, is_pin_activated,
        created_at, statistics_complete, team_a_player1_points, team_a_player2_points,
        team_b_player1_points, team_b_player2_points, ...snapshot } = score
      const keys = Object.keys(snapshot)
      const values = Object.values(snapshot).map((value) => Array.isArray(value) ? JSON.stringify(value) : value)
      await db.query(`update live_matches set ${keys.map((key, i) => `${key} = $${i + 1}`).join(', ')}
        where id = $${keys.length + 1}`, [...values, liveId])
    }
    const finished = (await db.query('select official_result_id from live_matches where id = $1', [liveId])).rows[0]
    assert.ok(finished.official_result_id)
    const resultId = finished.official_result_id
    const result = (await db.query('select * from matches where id::text = $1', [resultId])).rows[0]
    assert.equal(result.status, 'pending')
    assert.deepEqual(result.approved_profile_ids, [])
    assert.deepEqual(result.result_sets, [{ team1Score: 6, team2Score: 0 }, { team1Score: 6, team2Score: 0 }])
    assert.deepEqual([result.player1_id, result.team1_player2_id, result.player2_id, result.team2_player2_id], [1, 2, 3, 4])
    assert.equal(result.elo_applied, false)
    const storedStatistics = parseRecordedMatchStatistics(result.live_statistics)
    assert.equal(storedStatistics.team_a_total_points_won, 48)
    assert.deepEqual(storedStatistics.service_game_statistics, { team_a_won: 6, team_a_lost: 0, team_b_won: 0, team_b_lost: 6 })
    assert.ok(!('qr_device_token_hash' in result.live_statistics))
    assert.equal((await db.query('select * from profile_serve_statistics(1)')).rows[0].points_won, 0)
    await assert.rejects(db.query("update matches set live_statistics = '{}' where id::text = $1", [resultId]), /permission denied|statistiky/i)
    await assert.rejects(db.query("update live_matches set service_game_statistics = '{}' where id = $1", [liveId]), /ukonceny/)
    await db.query('update live_matches set team_a_sets = 2 where id = $1', [liveId])
    assert.equal((await db.query('select id from matches')).rows.length, 1)
    await assert.rejects(db.query('update live_matches set team_a_game_score = 15 where id = $1', [liveId]))
    const perSet = (await db.query('select set_statistics from live_matches where id = $1', [liveId])).rows[0].set_statistics
    assert.equal(perSet.length, 2)
    assert.equal(perSet[0].team_a_total_points_won, 24)
    assert.equal(perSet[1].team_a_total_points_won, 24)
    await assert.rejects(db.query("update live_matches set set_statistics = '[]' where id = $1", [liveId]), /ukonceny/)
    await db.exec('reset role')
    for (const id of [1, 2, 3, 4]) {
      await identity(id)
      const status = (await db.query('select respond_to_match_result($1, true) as status', [resultId])).rows[0].status
      assert.equal(status, id === 4 ? 'confirmed' : 'pending')
      const profiles = (await db.query('select matches_played from proffiles where id <= 4')).rows
      assert.ok(profiles.every((profile) => profile.matches_played === (id === 4 ? 1 : 0)))
      if (id < 4) assert.ok((await db.query('select elo_rating from proffiles where id <= 4')).rows.every((p) => p.elo_rating === 1000))
    }
    assert.deepEqual((await db.query('select elo_rating from proffiles where id <= 4 order by id')).rows.map((p) => p.elo_rating), [1016, 1016, 984, 984])
    await db.query('select respond_to_match_result($1, true)', [resultId])
    assert.equal((await db.query('select matches_played from proffiles where id = 1')).rows[0].matches_played, 1)
    for (const [id, won, lost] of [[1, 12, 0], [2, 12, 0], [3, 0, 12], [4, 0, 12]]) {
      const aggregate = (await db.query('select * from profile_serve_statistics($1)', [id])).rows[0]
      assert.deepEqual(aggregate, { points_won: won, points_lost: lost, recorded_matches: 1, confirmed_matches: 1 })
      const combined = (await db.query('select * from profile_serve_return_statistics($1)', [id])).rows[0]
      assert.deepEqual(combined, {
        ...aggregate, return_points_won: id <= 2 ? 24 : 0, return_points_lost: id <= 2 ? 0 : 24,
      })
    }

    // QR matches accept advantage sets without changing the manual-result tennis rules.
    await identity(1)
    const longId = '00000000-0000-0000-0000-000000000101'
    await create([1, 2, 3, 4], longId)
    await db.exec('set role authenticated')
    await assert.rejects(db.query(`update live_matches set team_a_sets = 2,
      completed_sets = '[[8,7],[6,0]]', started_at = now(), finished_at = now() where id = $1`, [longId]))
    assert.equal((await db.query('select team_a_sets from live_matches where id = $1', [longId])).rows[0].team_a_sets, 0)
    await db.query(`update live_matches set team_a_sets = 2, completed_sets = '[[8,6],[9,7]]',
      started_at = now(), finished_at = now() where id = $1`, [longId])
    assert.equal((await db.query('select count(*)::integer as count from matches')).rows[0].count, 2)
    await db.exec('reset role')

    await db.exec('set role anon')
    const quickId = (await db.query('insert into live_matches default values returning id')).rows[0].id
    await db.query("update live_matches set team_a_sets = 2, completed_sets = '[[6,0],[6,0]]' where id = $1", [quickId])
    await db.exec('reset role')
    assert.equal((await db.query('select count(*)::integer as count from matches')).rows[0].count, 2)

    for (let retry = 0; retry < 2; retry++) {
      await db.exec(await readFile(new URL('052_qr_matches_without_login.sql', import.meta.url), 'utf8'))
    }
    const deviceId = '00000000-0000-0000-0000-000000000102'
    const token = 'a'.repeat(64)
    const deviceCreate = (ids = [1, 2, 3, 4], key = token) => db.query(
      'select create_qr_device_match($1::uuid,$2,$3,$4,$5,$6,$7) as id',
      [deviceId, ...ids, 'Anonymous QR court', key],
    )
    await db.query('select set_config($1,$2,false)', ['request.jwt.claims', '{"role":"anon"}'])
    await db.exec('set role anon')
    await assert.rejects(deviceCreate([1, 1, 3, 4]), /roznych/)
    await assert.rejects(deviceCreate([1, 2, 3, 999]), /roznych/)
    await assert.rejects(deviceCreate([1, 2, 3, 4], 'short'), /kluc/)
    assert.equal((await deviceCreate()).rows[0].id, deviceId)
    assert.equal((await deviceCreate()).rows[0].id, deviceId)
    await assert.rejects(deviceCreate([1, 3, 2, 4]), /pouzite/)
    await assert.rejects(deviceCreate([1, 2, 3, 4], 'b'.repeat(64)), /pouzite/)
    assert.equal((await db.query('select id from live_matches where id=$1', [deviceId])).rows.length, 1)
    assert.equal((await db.query('select * from live_match_player_avatars($1)', [deviceId])).rows.length, 4)
    await assert.rejects(db.query('select qr_device_token_hash from live_matches where id=$1', [deviceId]))
    const updatePoint = () => db.query('update live_matches set team_a_game_score=15 where id=$1 returning id', [deviceId])
    assert.equal((await updatePoint()).rows.length, 0)
    await db.query('select set_config($1,$2,false)', ['request.headers', JSON.stringify({ 'x-riva-qr-device': 'b'.repeat(64) })])
    assert.equal((await updatePoint()).rows.length, 0)
    await db.query('select set_config($1,$2,false)', ['request.headers', JSON.stringify({ 'x-riva-qr-device': token })])
    assert.equal((await updatePoint()).rows.length, 1)
    await assert.rejects(db.query('update live_matches set qr_device_token_hash=$1 where id=$2', ['b'.repeat(64), deviceId]))
    await db.exec('reset role')
    const deviceRow = (await db.query('select * from live_matches where id=$1', [deviceId])).rows[0]
    assert.notEqual(deviceRow.qr_device_token_hash, token)
    await db.query('update live_matches set team_a_game_score=0 where id=$1', [deviceId])
    await db.exec('set role anon')
    let deviceScore = { ...deviceRow, team_a_game_score: 0, serving_team: 'TEAM_A', initial_server_chosen: true }
    for (let point = 0; point < 48; point++) {
      deviceScore = awardLivePoint(deviceScore, 'TEAM_A', '2026-10-13T11:00:00.000Z')
      const keys = Object.keys(snapshotForDevice(deviceScore))
      const values = Object.values(snapshotForDevice(deviceScore)).map((value) => Array.isArray(value) ? JSON.stringify(value) : value)
      await db.query(`update live_matches set ${keys.map((key, i) => `${key}=$${i + 1}`).join(',')}
        where id=$${keys.length + 1}`, [...values, deviceId])
    }
    const deviceResultId = (await db.query('select official_result_id from live_matches where id=$1', [deviceId])).rows[0].official_result_id
    assert.ok(deviceResultId)
    await db.exec('reset role')
    const deviceResult = (await db.query('select * from matches where id::text=$1', [deviceResultId])).rows[0]
    assert.equal(deviceResult.status, 'pending')
    assert.equal(deviceResult.elo_applied, false)
    assert.equal(parseRecordedMatchStatistics(deviceResult.live_statistics).team_a_total_points_won, 48)
    assert.ok(!JSON.stringify(deviceResult.live_statistics).includes(token))
    assert.deepEqual(deviceResult.approved_profile_ids, [])
    assert.deepEqual(deviceResult.result_sets, [{ team1Score: 6, team2Score: 0 }, { team1Score: 6, team2Score: 0 }])
    assert.equal((await db.query('select matches_played from proffiles where id=1')).rows[0].matches_played, 1)
    for (const id of [1, 2, 3, 4]) {
      await identity(id)
      const status = (await db.query('select respond_to_match_result($1,true) as status', [deviceResultId])).rows[0].status
      assert.equal(status, id === 4 ? 'confirmed' : 'pending')
      assert.ok((await db.query('select matches_played from proffiles where id<=4')).rows.every((p) => p.matches_played === (id === 4 ? 2 : 1)))
    }
    const baseline = (await db.query('select * from profile_serve_statistics(1)')).rows[0]
    assert.equal(baseline.points_won, 24)
    assert.equal(baseline.points_lost, 0)

    // Fixtures bypass workflow triggers only in this disposable database.
    await db.exec('alter table matches disable trigger user')
    const fixture = {
      ...result.live_statistics,
      team_a_player1_serve_points_won: 99, team_a_player1_serve_points_lost: 1,
      team_a_player2_serve_points_won: 1, team_a_player2_serve_points_lost: 3,
    }
    await db.query(`insert into matches (player1_id, team1_player1_id, team1_player2_id,
      player2_id, team2_player1_id, team2_player2_id, status, live_statistics)
      select 2,2,1,3,3,4,'confirmed',$1::jsonb from generate_series(1,1005)`, [JSON.stringify(fixture)])
    for (const [status, payload] of [
      ['pending', fixture], ['rejected', fixture],
      ['confirmed', { ...fixture, statistics_complete: false }], ['confirmed', null],
    ]) {
      await db.query(`insert into matches (player1_id,team1_player1_id,team1_player2_id,
        player2_id,team2_player1_id,team2_player2_id,status,live_statistics)
        values (2,2,1,3,3,4,$1,$2::jsonb)`, [status, payload === null ? null : JSON.stringify(payload)])
    }
    await db.exec('alter table matches enable trigger user')
    await identity(1)
    await db.exec('set role authenticated')
    const aggregate = (await db.query('select * from profile_serve_statistics(1)')).rows[0]
    assert.equal(aggregate.points_won, baseline.points_won + 1005)
    assert.equal(aggregate.points_lost, baseline.points_lost + 3015)
    assert.equal(aggregate.recorded_matches, baseline.recorded_matches + 1005)
    assert.equal(aggregate.confirmed_matches, baseline.confirmed_matches + 1007)
    const combined = (await db.query('select * from profile_serve_return_statistics(1)')).rows[0]
    assert.equal(combined.points_won, aggregate.points_won)
    assert.equal(combined.points_lost, aggregate.points_lost)
    assert.equal(combined.return_points_won, 48 + 1005 * 24)
    assert.equal(combined.return_points_lost, 0)
    const opponentsReturn = (await db.query('select * from profile_serve_return_statistics(3)')).rows[0]
    assert.equal(opponentsReturn.return_points_won, 1005 * 4)
    assert.equal(opponentsReturn.return_points_lost, 48 + 1005 * 100)
    assert.equal(Math.round(aggregate.points_won / (aggregate.points_won + aggregate.points_lost) * 100), 25)
    await db.exec('reset role')
    await assert.rejects(db.query("update matches set live_statistics='{}' where id::text=$1", [resultId]), /statistiky/i)
    await db.exec('alter table matches disable trigger guard_official_live_statistics')
    await db.query('update matches set live_statistics=null where id::text=$1', [resultId])
    await db.exec('alter table matches enable trigger guard_official_live_statistics')
    await db.exec(await readFile(new URL('053_extended_match_statistics.sql', import.meta.url), 'utf8'))
    assert.deepEqual((await db.query('select live_statistics from matches where id::text=$1', [resultId])).rows[0].live_statistics, result.live_statistics)
    assert.equal((await db.query('select * from profile_serve_statistics(1)')).rows[0].points_won, aggregate.points_won)
  } finally {
    await db.close()
  }
})

function snapshotForDevice(score) {
  const { id, team_a_player1_name, team_a_player2_name, team_b_player1_name, team_b_player2_name,
    team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id,
    qr_created_by, qr_arena_name, qr_device_token_hash, official_result_id, challenge_id, match_pin, is_pin_activated,
    created_at, statistics_complete, team_a_player1_points, team_a_player2_points,
    team_b_player1_points, team_b_player2_points, ...snapshot } = score
  return snapshot
}
