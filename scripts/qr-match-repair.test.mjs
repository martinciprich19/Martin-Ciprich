import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { awardLivePoint } from '../lib/live-match-scoring.ts'

test('repair, persistent PIN, immediate result notifications and independent rematches', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create role service_role;
      create schema auth;
      create function auth.jwt() returns jsonb language sql as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
      $$;
      create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid; $$;
      create function auth.role() returns text language sql as $$ select auth.jwt()->>'role'; $$;
      grant usage on schema auth to authenticated;
      create table proffiles (
        id bigint primary key, full_name text, email text unique, avatar_url text,
        elo_rating integer default 1000, highest_elo integer default 1000,
        matches_played integer default 0, matches_won integer default 0
      );
      create table matches (
        id bigint generated always as identity primary key,
        player1_id bigint, player2_id bigint, team1_player2_id bigint, team2_player2_id bigint,
        winner_id bigint, match_date timestamptz, status text,
        player1_sets_won integer, player2_sets_won integer,
        player1_games_won integer, player2_games_won integer
      );
      create table challenges (
        id bigint primary key, challenger_1_id bigint, challenger_2_id bigint,
        challenged_1_id bigint, challenged_2_id bigint, status text,
        challenger_2_accepted boolean default false,
        challenged_1_accepted boolean default false, challenged_2_accepted boolean default false
      );
      create table notifications(
        id uuid primary key default gen_random_uuid(), user_id bigint, sender_id bigint,
        challenge_id bigint, type text, message text, is_read boolean,
        created_at timestamptz default now()
      );
      grant select on challenges, proffiles to authenticated;
      insert into proffiles(id, full_name, email)
        select id, 'Player ' || id, 'player' || id || '@test.invalid' from generate_series(1,4) id;
    `)
    for (const file of [
      '027_match_results_approval_elo.sql', '032_create_submit_match_result.sql',
      '029_match_confirmation_elo_on_full_approval.sql',
      '041_live_match_scoreboard.sql', '042_live_match_kiosk_pin.sql',
      '043_quick_live_matches.sql', '044_live_match_players_sets.sql',
      '045_live_match_finish_statistics.sql', '046_live_match_serve_statistics.sql',
      '047_live_match_duration_and_stats.sql', '048_qr_registered_live_matches.sql',
      '050_live_match_set_statistics.sql', '051_live_match_player_avatars.sql',
      '052_qr_matches_without_login.sql', '053_extended_match_statistics.sql',
      '054_profile_serve_return_statistics.sql',
    ]) await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'))
    assert.equal((await db.query("select to_regprocedure('public.create_qr_device_match_with_settings(uuid,bigint,bigint,bigint,bigint,text,text,text,text,text)') as fn")).rows[0].fn, null)
    const repair = await readFile(new URL('061_repair_qr_match_setup.sql', import.meta.url), 'utf8')
    await db.exec(repair)
    const token = 'a'.repeat(64)
    const id = '00000000-0000-0000-0000-000000000161'
    await db.exec('set role anon')
    await db.query('select create_qr_device_match_with_settings($1::uuid,1,2,3,4,$2,$3,$4,$5,$6)',
      [id, 'Repair test', token, 'advantage', 'seven_games_no_tiebreak', 'super_tiebreak'])
    await db.query('select set_config($1,$2,false)', ['request.headers', JSON.stringify({ 'x-riva-qr-device': token })])
    await db.query('update live_matches set team_a_games=6,team_b_games=6 where id=$1', [id])
    await db.exec('reset role')
    await db.exec(repair)
    assert.equal((await db.query('select is_tiebreak from live_matches where id=$1', [id])).rows[0].is_tiebreak, false)
    const tieId = (await db.query(`insert into live_matches
      (team_a_sets,team_b_sets,third_set_format,tiebreak_score)
      values (1,1,'super_tiebreak','{"a":9,"b":8,"first_team":"TEAM_A","first_player":1}') returning id`)).rows[0].id
    await db.exec(repair)
    assert.equal((await db.query('select tiebreak_score from live_matches where id=$1', [tieId])).rows[0].tiebreak_score.a, 9)
    await db.exec('set role anon')
    const receipt = (await db.query('select pause_live_match($1) as receipt', [id])).rows[0].receipt
    assert.equal(receipt.recipients, 4)
    assert.match(receipt.pin, /^\d{4}$/)
    await assert.rejects(db.query('select resume_pin from live_matches where id=$1', [id]), /permission denied/)
    await db.exec('reset role')
    const persistentPin = await readFile(new URL('062_persistent_match_pin.sql', import.meta.url), 'utf8')
    await db.exec(persistentPin)
    await db.exec(persistentPin)
    const completion = await readFile(new URL('063_match_completion_and_rematch.sql', import.meta.url), 'utf8')
    await db.exec(completion)
    await db.exec(completion)
    const rematchTeams = await readFile(new URL('065_rematch_team_selection.sql', import.meta.url), 'utf8')
    await db.exec(rematchTeams)
    await db.exec(rematchTeams)
    const before = (await db.query('select team_a_games,team_b_games,point_history from live_matches where id=$1', [id])).rows[0]
    const firstToken = 'b'.repeat(64)
    const secondToken = 'c'.repeat(64)
    await db.exec('set role service_role')
    const resume = async (device, client) => (await db.query(
      'select resume_paused_live_match($1,$2,$3) as result', [receipt.pin, device, client])).rows[0].result
    assert.equal((await resume(firstToken, 'first-device')).matchId, id)
    assert.equal((await resume(firstToken, 'first-device')).matchId, id)
    assert.equal((await resume(secondToken, 'second-device')).matchId, id)
    await db.exec('reset role')
    assert.equal((await db.query('select resume_pin from live_matches where id=$1', [id])).rows[0].resume_pin, receipt.pin)
    await db.exec('set role anon')
    await db.query('select set_config($1,$2,false)', ['request.headers', '{}'])
    await assert.rejects(db.query('select end_live_match($1)', [id]), /opravnenie/)
    await db.query('select set_config($1,$2,false)', ['request.headers', JSON.stringify({ 'x-riva-qr-device': secondToken })])
    const repeated = (await db.query('select pause_live_match($1) as receipt', [id])).rows[0].receipt
    assert.deepEqual(repeated, receipt)
    assert.equal((await db.query('select can_manage_live_match($1) as allowed', [id])).rows[0].allowed, true)
    await db.exec('reset role')
    await db.query("update live_matches set paused_at=now()-interval '2 minutes' where id=$1", [id])
    await db.exec('set role service_role')
    assert.equal((await resume(secondToken, 'second-device')).matchId, id)
    await db.exec('reset role')
    assert.ok((await db.query('select paused_seconds from live_matches where id=$1', [id])).rows[0].paused_seconds >= 120)
    await db.exec('set role anon')
    await db.query('select end_live_match($1)', [id])
    await db.query('select end_live_match($1)', [id])
    const ended = (await db.query('select ended_early_at,finished_at,status,official_result_id from live_matches where id=$1', [id])).rows[0]
    assert.ok(ended.ended_early_at)
    assert.ok(ended.finished_at)
    assert.equal(ended.status, 'finished')
    assert.equal(ended.official_result_id, null)
    assert.deepEqual((await db.query('select team_a_games,team_b_games,point_history from live_matches where id=$1', [id])).rows[0], before)
    await assert.rejects(db.query('update live_matches set team_a_game_score=15 where id=$1', [id]), /natrvalo ukonceny/)
    await assert.rejects(db.query('select pause_live_match($1)', [id]), /Ukonceny/)
    await db.exec('set role service_role')
    assert.ok((await resume(secondToken, 'after-end')).error)
    await db.exec('reset role')
    assert.equal((await db.query('select count(*)::int as n from matches')).rows[0].n, 0)
    assert.equal((await db.query("select count(*)::int as n from notifications where type='match_result'")).rows[0].n, 0)
    assert.equal((await db.query('select count(*)::int as n from live_match_pauses where match_id=$1 and pin is not null', [id])).rows[0].n, 0)
    assert.equal((await db.query('select resume_pin from live_matches where id=$1', [id])).rows[0].resume_pin, null)

    // Ending a paused game must stop the clock and expire its PIN too.
    const quickId = (await db.query('insert into live_matches default values returning id')).rows[0].id
    await db.exec('set role anon')
    const quickPin = (await db.query('select pause_live_match($1) as receipt', [quickId])).rows[0].receipt.pin
    await db.query('select end_live_match($1)', [quickId])
    await db.exec('set role service_role')
    assert.ok((await db.query('select resume_paused_live_match($1,$2,$3) as result', [quickPin, firstToken, 'quick-ended'])).rows[0].result.error)
    await db.exec('reset role')
    assert.equal((await db.query('select paused_at from live_matches where id=$1', [quickId])).rows[0].paused_at, null)

    // A normally completed match also releases its PIN, without changing its result.
    const normalId = (await db.query('insert into live_matches default values returning id')).rows[0].id
    await db.exec('set role anon')
    const normalPin = (await db.query('select pause_live_match($1) as receipt', [normalId])).rows[0].receipt.pin
    await db.exec('set role service_role')
    await db.query('select resume_paused_live_match($1,$2,$3)', [normalPin, firstToken, 'normal-resume'])
    await db.exec('reset role')
    await db.query('update live_matches set team_a_sets=2,started_at=now(),finished_at=now() where id=$1', [normalId])
    assert.equal((await db.query('select pin from live_match_pauses where match_id=$1', [normalId])).rows[0].pin, null)
    await db.exec('set role service_role')
    assert.ok((await db.query('select resume_paused_live_match($1,$2,$3) as result', [normalPin, firstToken, 'normal-finished'])).rows[0].result.error)
    // Quick rematches reset state without creating official results or notices.
    await db.exec('set role anon')
    const quickNextId = '00000000-0000-0000-0000-000000000163'
    assert.equal((await db.query('select create_live_match_rematch($1,$2,$3,$4::smallint[]) as id',
      [normalId, quickNextId, token, [0, 1, 2, 3]])).rows[0].id, quickNextId)
    assert.equal((await db.query('select team_a_sets from live_matches where id=$1', [quickNextId])).rows[0].team_a_sets, 0)
    await assert.rejects(db.query('select create_live_match_rematch($1,$2,$3,$4::smallint[])',
      [normalId, quickNextId, token, [0, 0, 2, 3]]), /dvojic/)
    await assert.rejects(db.query('select create_live_match_rematch($1,$2,$3,$4::smallint[])',
      [id, quickNextId, token, [0, 1, 2, 3]]), /riadne dohraj/)
    await db.exec('reset role')
    const completedQrId = '00000000-0000-0000-0000-000000000162'
    await db.exec('set role anon')
    await db.query('select create_qr_device_match_with_settings($1::uuid,1,2,3,4,$2,$3,$4,$5,$6)',
      [completedQrId, 'Completed court', token, 'golden_point', 'standard', 'super_tiebreak'])
    await db.query('select set_config($1,$2,false)', ['request.headers', JSON.stringify({ 'x-riva-qr-device': token })])
    const completedPin = (await db.query('select pause_live_match($1) as receipt', [completedQrId])).rows[0].receipt.pin
    await db.exec('set role service_role')
    await db.query('select resume_paused_live_match($1,$2,$3)', [completedPin, firstToken, 'completed-qr'])
    await db.exec('reset role')
    const storedScore = (await db.query('select * from live_matches where id=$1', [completedQrId])).rows[0]
    const metadata = new Set([
      'id', 'team_a_player1_name', 'team_a_player2_name', 'team_b_player1_name', 'team_b_player2_name',
      'team_a_player1_id', 'team_a_player2_id', 'team_b_player1_id', 'team_b_player2_id',
      'qr_created_by', 'qr_arena_name', 'qr_device_token_hash', 'official_result_id', 'challenge_id',
      'match_pin', 'is_pin_activated', 'created_at', 'statistics_complete', 'is_tiebreak',
      'team_a_player1_points', 'team_a_player2_points', 'team_b_player1_points', 'team_b_player2_points',
      'paused_at', 'paused_seconds', 'status', 'resume_pin', 'ended_early_at',
    ])
    let score = Object.fromEntries(Object.entries(storedScore).filter(([key]) => !metadata.has(key)))
    await db.exec('set role anon')
    await db.query('select set_config($1,$2,false)', ['request.headers', JSON.stringify({ 'x-riva-qr-device': firstToken })])
    await db.query("update live_matches set initial_server_chosen=true,serving_team='TEAM_A' where id=$1", [completedQrId])
    score.initial_server_chosen = true
    score.serving_team = 'TEAM_A'
    for (let i = 0; i < 48; i++) {
      const patch = awardLivePoint(score, 'TEAM_A')
      const keys = Object.keys(patch)
      const values = Object.values(patch).map(value => Array.isArray(value) || (value !== null && typeof value === 'object') ? JSON.stringify(value) : value)
      if (i === 47) {
        await db.exec(`reset role;
          create function test_notification_failure() returns trigger language plpgsql as $$
          begin raise exception 'Test notification failure'; end $$;
          create trigger test_notification_failure before insert on notifications
            for each row execute function test_notification_failure();
          set role anon;`)
        await assert.rejects(db.query(`update live_matches set ${keys.map((key, index) => `${key}=$${index + 1}`).join(',')} where id=$${keys.length + 1}`,
          [...values, completedQrId]), /Test notification failure/)
        const unchanged = (await db.query('select team_a_sets,finished_at,official_result_id from live_matches where id=$1', [completedQrId])).rows[0]
        assert.equal(unchanged.team_a_sets, 1)
        assert.equal(unchanged.finished_at, null)
        assert.equal(unchanged.official_result_id, null)
        await db.exec('reset role; drop trigger test_notification_failure on notifications; drop function test_notification_failure(); set role anon;')
      }
      await db.query(`update live_matches set ${keys.map((key, index) => `${key}=$${index + 1}`).join(',')} where id=$${keys.length + 1}`,
        [...values, completedQrId])
      score = { ...score, ...patch }
      if (i === 46) {
        await db.exec('reset role')
        assert.equal((await db.query("select count(*)::int as n from notifications where type='match_result'")).rows[0].n, 0)
        await db.exec('set role anon')
      }
    }
    const resultId = (await db.query('select official_result_id from live_matches where id=$1', [completedQrId])).rows[0].official_result_id
    assert.ok(resultId)
    await db.exec('reset role')
    assert.equal((await db.query('select resume_pin from live_matches where id=$1', [completedQrId])).rows[0].resume_pin, null)
    const notices = (await db.query("select user_id,is_read,message from notifications where match_id=$1 and type='match_result' order by user_id", [resultId])).rows
    assert.deepEqual(notices.map(n => n.user_id), [1, 2, 3, 4])
    assert.ok(notices.every(n => n.is_read === false && n.message.includes('Potvrd vysledok')))
    assert.equal((await db.query('select elo_applied from matches where id::text=$1', [resultId])).rows[0].elo_applied, false)
    // Notification creation is idempotent even when a pending result is updated.
    await db.query("update matches set status='pending' where id::text=$1", [resultId])
    await db.exec(completion)
    assert.equal((await db.query('select count(*)::int as n from notifications where match_id=$1', [resultId])).rows[0].n, 4)
    await db.exec('set role anon')
    const nextId = '00000000-0000-0000-0000-000000000164'
    await db.query('select set_config($1,$2,false)', ['request.headers', '{}'])
    await assert.rejects(db.query('select create_live_match_rematch($1,$2,$3,$4::smallint[])',
      [completedQrId, nextId, token, [0, 1, 2, 3]]), /opravnenie/)
    await db.query('select set_config($1,$2,false)', ['request.headers', JSON.stringify({ 'x-riva-qr-device': firstToken })])
    const rematch = () => db.query('select create_live_match_rematch($1,$2,$3,$4::smallint[]) as id',
      [completedQrId, nextId, secondToken, [0, 2, 1, 3]])
    assert.equal((await rematch()).rows[0].id, nextId)
    assert.equal((await rematch()).rows[0].id, nextId)
    await assert.rejects(db.query('select create_live_match_rematch($1,$2,$3,$4::smallint[])',
      [completedQrId, nextId, secondToken, [0, 1, 2, 3]]), /rozdelenim/)
    await assert.rejects(db.query('select create_live_match_rematch($1,$2,$3,$4::smallint[])',
      [completedQrId, quickNextId, token, [0, 1, 2, 3]]), /uz bol vytvoreny/)
    await db.exec('reset role')
    const next = (await db.query('select * from live_matches where id=$1', [nextId])).rows[0]
    assert.deepEqual([next.team_a_player1_id, next.team_a_player2_id, next.team_b_player1_id, next.team_b_player2_id], [1, 3, 2, 4])
    assert.deepEqual([next.scoring_type, next.set_format, next.third_set_format], ['golden_point', 'standard', 'super_tiebreak'])
    assert.equal(next.official_result_id, null)
    assert.equal(next.team_a_sets, 0)
    assert.equal(next.team_a_total_points_won, 0)
    assert.equal(next.started_at, null)
    assert.equal(next.initial_server_chosen, false)
    assert.deepEqual(next.point_history, [])
    assert.deepEqual(next.completed_sets, [])
    assert.equal((await db.query("select count(*)::int as n from notifications where type='match_result'")).rows[0].n, 4)
    assert.equal((await db.query('select live_statistics from matches where id::text=$1', [resultId])).rows[0].live_statistics.point_history.length, 48)

    // Challenge/PIN finishes notify all four too, and rematches are independent
    // registered matches rather than reusing the challenge's unique activation PIN.
    await db.exec("insert into challenges(id,challenger_1_id,challenger_2_id,challenged_1_id,challenged_2_id,status) values(63,1,2,3,4,'accepted')")
    const challengeId = (await db.query(`insert into live_matches
      (challenge_id,match_pin,is_pin_activated,scoring_type,set_format,third_set_format)
      values('63','6363',true,'advantage','seven_games_no_tiebreak','full_set') returning id`)).rows[0].id
    await db.exec('set role anon')
    await db.query('select set_config($1,$2,false)', ['request.headers', '{}'])
    await db.query(`update live_matches set team_a_sets=2,completed_sets='[[7,6],[7,5]]',
      started_at=now(),finished_at=now() where id=$1`, [challengeId])
    const challengeResult = (await db.query('select official_result_id from live_matches where id=$1', [challengeId])).rows[0].official_result_id
    assert.ok(challengeResult)
    await db.exec('reset role')
    assert.equal((await db.query('select count(*)::int as n from notifications where match_id=$1', [challengeResult])).rows[0].n, 4)
    // Existing approvals substitute for redundant reminders on legacy results.
    await db.query('delete from notifications where match_id=$1 and user_id=1', [challengeResult])
    await db.query("update matches set approved_profile_ids='{1}' where id::text=$1", [challengeResult])
    await db.exec('set role anon')
    const challengeNext = '00000000-0000-0000-0000-000000000165'
    await db.query('select create_live_match_rematch($1,$2,$3,$4::smallint[])',
      [challengeId, challengeNext, token, [0, 3, 1, 2]])
    await db.exec('reset role')
    assert.equal((await db.query('select count(*)::int as n from notifications where match_id=$1', [challengeResult])).rows[0].n, 3)
    const challengeReplay = (await db.query('select challenge_id,scoring_type,set_format,third_set_format from live_matches where id=$1', [challengeNext])).rows[0]
    assert.deepEqual(challengeReplay, {challenge_id:null,scoring_type:'advantage',set_format:'seven_games_no_tiebreak',third_set_format:'full_set'})
    assert.deepEqual((await db.query(`select team_a_player1_id,team_a_player2_id,team_b_player1_id,team_b_player2_id
      from live_matches where id=$1`, [challengeNext])).rows[0],
      {team_a_player1_id:1,team_a_player2_id:4,team_b_player1_id:2,team_b_player2_id:3})
    // All confirmations, not the next-game or exit action, are required for ELO.
    for (const player of [1, 2, 3, 4]) {
      await db.exec('set role authenticated')
      await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({
        sub:`00000000-0000-0000-0000-${String(player).padStart(12,'0')}`,
        email:`player${player}@test.invalid`, role:'authenticated',
      })])
      const response = (await db.query('select respond_to_match_result($1,true) as status', [resultId])).rows[0].status
      assert.equal(response, player === 4 ? 'confirmed' : 'pending')
    }
    await db.exec('reset role')
    assert.equal((await db.query('select elo_applied from matches where id::text=$1', [resultId])).rows[0].elo_applied, true)
    await db.exec('set role anon')
    await db.query('select set_config($1,$2,false)', ['request.headers', JSON.stringify({ 'x-riva-qr-device': secondToken })])
    await db.query(`update live_matches set team_b_sets=2,completed_sets='[[0,6],[0,6]]',
      started_at=now(),finished_at=now() where id=$1`, [nextId])
    const replayResultId = (await db.query('select official_result_id from live_matches where id=$1', [nextId])).rows[0].official_result_id
    assert.notEqual(replayResultId, resultId)
    await db.exec('reset role')
    assert.equal((await db.query('select count(*)::int as n from notifications where match_id=$1', [replayResultId])).rows[0].n, 4)
    assert.equal((await db.query('select status from matches where id::text=$1', [resultId])).rows[0].status, 'confirmed')
    assert.equal((await db.query('select status from matches where id::text=$1', [replayResultId])).rows[0].status, 'pending')
    // Production legacy schemas can store approved IDs as text[].
    await db.exec(`alter table matches alter column approved_profile_ids drop default;
      alter table matches alter column approved_profile_ids type text[] using approved_profile_ids::text[];
      alter table matches alter column approved_profile_ids set default '{}'::text[];`)
    await db.query('delete from notifications where match_id=$1', [challengeResult])
    await db.exec(completion)
    assert.deepEqual((await db.query('select user_id from notifications where match_id=$1 order by user_id', [challengeResult])).rows.map(row => row.user_id), [2, 3, 4])
    await db.exec('set role anon')
    await db.query('select set_config($1,$2,false)', ['request.headers', '{}'])
    assert.equal((await db.query('select create_live_match_rematch($1,$2,$3,$4::smallint[]) as id',
      [challengeId, challengeNext, token, [0, 3, 1, 2]])).rows[0].id, challengeNext)
    await db.exec('reset role')
    await db.exec('alter table notifications alter column sender_id type uuid using null::uuid')
    await db.query('delete from notifications where match_id=$1', [challengeResult])
    await db.exec(completion)
    const systemNotices = (await db.query('select user_id,sender_id from notifications where match_id=$1 order by user_id', [challengeResult])).rows
    assert.deepEqual(systemNotices.map(row => row.user_id), [2, 3, 4])
    assert.ok(systemNotices.every(row => row.sender_id === null))
    await db.query('delete from notifications where match_id=$1', [replayResultId])
    await db.query("update matches set status='pending' where id::text=$1", [replayResultId])
    assert.equal((await db.query('select count(*)::int as n from notifications where match_id=$1 and sender_id is null', [replayResultId])).rows[0].n, 4)
  } finally {
    await db.close()
  }
})
