import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { awardLivePoint, undoSavedPoint, POINT_STAT_KEYS } from '../lib/live-match-scoring.ts'

const sql = async (file) => readFile(new URL(file, import.meta.url), 'utf8')

test('national routing integrates with existing QR, results, rematch and score guards', async () => {
  const db = new PGlite()
  try {
    // Same pre-migration schema as qr-match-repair.test.mjs, plus deployed bigint arenas.
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema auth;
      create function auth.jwt() returns jsonb language sql as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
      $$;
      create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid; $$;
      create function auth.role() returns text language sql as $$ select auth.jwt()->>'role'; $$;
      create table auth.users(email text, raw_user_meta_data jsonb);
      grant usage on schema auth to authenticated;
      create table proffiles (
        id bigint primary key, full_name text, email text unique, avatar_url text, region text,
        home_venue_id bigint, auto_venue_id bigint,
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
        challenged_1_id bigint, challenged_2_id bigint, status text, arena_id bigint,
        challenger_2_accepted boolean default false,
        challenged_1_accepted boolean default false, challenged_2_accepted boolean default false
      );
      create table pairs(id bigint generated always as identity, player_1_id bigint, player_2_id bigint);
      create table arenas(id bigint primary key, name text, city text, region text, is_active boolean default true);
      create table player_requests(id bigint generated always as identity, user_id bigint, arena_id bigint);
      create table notifications(
        id uuid primary key default gen_random_uuid(), user_id bigint, sender_id bigint,
        challenge_id bigint, type text, message text, is_read boolean,
        created_at timestamptz default now()
      );
      grant select on challenges, proffiles to authenticated;
      insert into proffiles(id, full_name, email, region)
        select id, 'Player ' || id, 'player' || id || '@test.invalid', 'Bratislavský kraj'
        from generate_series(1,4) id;
      insert into arenas values (1,'SK Arena','Bratislava','Bratislavský kraj',true);
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
      '054_profile_serve_return_statistics.sql', '061_repair_qr_match_setup.sql',
      '062_persistent_match_pin.sql', '063_match_completion_and_rematch.sql',
      '065_rematch_team_selection.sql', '067_public_live_matches.sql',
      '068_national_leagues.sql',
    ]) await db.exec(await sql(file))
    const oldQuick = (await db.query('insert into live_matches(team_a_games) values (3) returning id')).rows[0].id
    const routing = await sql('069_national_league_routing.sql')
    await db.exec(routing)
    await db.exec(routing)
    assert.deepEqual((await db.query('select country_code,team_a_games from live_matches where id=$1', [oldQuick])).rows[0],
      { country_code: 'SK', team_a_games: 3 })
    await db.exec(`
      insert into auth.users(email,raw_user_meta_data)
        select 'player' || id || '@test.invalid',
          '{"country_code":"NL","preferred_language":"en","subdivision_code":"NL-NH"}'::jsonb
        from generate_series(5,8) id;
      insert into proffiles(id,full_name,email)
        select id,'Player ' || id,'player' || id || '@test.invalid' from generate_series(5,8) id;
      insert into arenas(id,name,city,region,country_code)
        values (2,'NL Arena','Amsterdam','Noord-Holland','NL');
    `)
    assert.deepEqual((await db.query('select country_code,preferred_language,subdivision_code,region from proffiles where id=5')).rows[0],
      { country_code: 'NL', preferred_language: 'en', subdivision_code: 'NL-NH', region: 'Noord-Holland' })
    assert.equal((await db.query('insert into pairs(player_1_id,player_2_id) values (5,6) returning country_code')).rows[0].country_code, 'NL')
    assert.equal((await db.query('insert into player_requests(user_id,arena_id) values (5,2) returning country_code')).rows[0].country_code, 'NL')
    await assert.rejects(db.exec('insert into player_requests(user_id,arena_id) values (5,1)'), /Arena/)
    await assert.rejects(db.exec("insert into pairs(player_1_id,player_2_id,country_code) values (5,6,'SK')"), /Selected country/)
    await assert.rejects(db.exec('insert into pairs(player_1_id,player_2_id) values (1,5)'), /same national league/)
    await assert.rejects(db.exec("update proffiles set country_code='SK' where id=5"), /membership cannot/)
    await assert.rejects(db.exec('update proffiles set home_venue_id=1 where id=5'), /Home arena/)
    await db.exec(`insert into challenges(id,challenger_1_id,challenger_2_id,challenged_1_id,challenged_2_id,status,arena_id)
      values (1,5,6,7,8,'pending',2)`)
    assert.equal((await db.query('select country_code from challenges where id=1')).rows[0].country_code, 'NL')
    await assert.rejects(db.exec(`insert into challenges(id,challenger_1_id,challenger_2_id,challenged_1_id,challenged_2_id,status,arena_id)
      values (2,5,6,7,8,'pending',1)`), /Arena/)
    await assert.rejects(db.exec(`insert into challenges(id,challenger_1_id,challenger_2_id,challenged_1_id,challenged_2_id,status)
      values (3,1,6,7,8,'pending')`), /same national league/)
    await db.exec("update challenges set status='accepted' where id=1")
    await db.exec("insert into live_matches(challenge_id) values ('1')")
    assert.equal((await db.query("select country_code from live_matches where challenge_id='1'")).rows[0].country_code, 'NL')

    await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({
      sub: '00000000-0000-0000-0000-000000000005', email: 'player5@test.invalid',
    })])
    const sets = JSON.stringify([{ team1Score: 6, team2Score: 3 }, { team1Score: 6, team2Score: 4 }])
    const result = (await db.query("select submit_match_result('NL Arena',now(),$1::jsonb,5,6,7,8) as id", [sets])).rows[0].id
    assert.equal((await db.query('select country_code from matches where id=$1', [result])).rows[0].country_code, 'NL')
    await assert.rejects(db.query("select submit_match_result('NL Arena',now(),$1::jsonb,5,6,7,1)", [sets]), /same national league/)
    await assert.rejects(db.query("select submit_match_result('SK Arena',now(),$1::jsonb,5,6,7,8)", [sets]), /Arena/)

    const qr = '00000000-0000-0000-0000-000000000269'
    const token = 'a'.repeat(64)
    await db.exec('set role anon')
    await db.query("select create_qr_device_match_with_settings($1::uuid,5,6,7,8,'NL Arena',$2,'advantage','standard','super_tiebreak')", [qr, token])
    await assert.rejects(db.query("select create_qr_device_match($1::uuid,5,6,7,1,'NL Arena',$2)",
      ['00000000-0000-0000-0000-000000000270', token]), /same national league/)
    await db.query('select set_config($1,$2,false)', ['request.headers', JSON.stringify({ 'x-riva-qr-device': token })])
    await db.query("update live_matches set serving_team='TEAM_A',initial_server_chosen=true,started_at=now() where id=$1", [qr])
    const quick = (await db.query("insert into live_matches(country_code,serving_team,initial_server_chosen) values ('NL','TEAM_A',true) returning id,country_code")).rows[0]
    assert.equal(quick.country_code, 'NL')
    await db.query('update live_matches set team_a_game_score=15 where id=$1', [quick.id])
    await assert.rejects(db.query("update live_matches set scoring_type='advantage' where id=$1", [quick.id]), /Pravidla/)
    await db.exec('reset role')
    assert.equal((await db.query('select country_code from live_matches where id=$1', [qr])).rows[0].country_code, 'NL')
    assert.ok((await db.query('select * from get_public_live_matches()')).rows.some(row => row.id === qr && row.country_code === 'NL'))
    assert.equal((await db.query("select * from get_public_live_matches('SK')")).rows.some(row => row.id === qr), false)
    const nlLive = (await db.query("select * from get_public_live_matches('NL')")).rows.find(row => row.id === qr)
    assert.equal(nlLive.arena_id, 2)
    await db.query(`update live_matches set team_a_sets=2,completed_sets='[[6,3],[6,4]]',
      finished_at=now() where id=$1`, [qr])
    const qrResult = (await db.query('select official_result_id from live_matches where id=$1', [qr])).rows[0].official_result_id
    assert.equal((await db.query('select country_code from matches where id::text=$1', [qrResult])).rows[0].country_code, 'NL')
    assert.equal((await db.query('select count(*)::int as total from notifications where match_id=$1', [qrResult])).rows[0].total, 4)
    await db.exec('set role anon')
    const registeredReplay = '00000000-0000-0000-0000-000000000272'
    await db.query('select create_live_match_rematch($1,$2,$3,array[0,2,1,3]::smallint[])', [qr, registeredReplay, token])
    await db.exec('reset role')
    assert.equal((await db.query('select country_code from live_matches where id=$1', [registeredReplay])).rows[0].country_code, 'NL')

    // A real anonymous quick rematch has no participant IDs from which to derive NL.
    await db.query(`update live_matches set team_a_sets=2,completed_sets='[[6,3],[6,4]]',
      started_at=now()-interval '10 minutes',finished_at=now() where id=$1`, [quick.id])
    const replay = '00000000-0000-0000-0000-000000000271'
    await db.query('select set_config($1,$2,false)', ['request.jwt.claims', '{}'])
    await db.exec('set role anon')
    await db.query('select create_live_match_rematch($1,$2,$3,array[0,1,2,3]::smallint[])', [quick.id, replay, token])
    await db.exec('reset role')
    assert.equal((await db.query('select country_code from live_matches where id=$1', [replay])).rows[0].country_code, 'NL')
    await db.exec(routing)
    assert.equal((await db.query('select country_code from live_matches where id=$1', [replay])).rows[0].country_code, 'NL')
    assert.equal((await db.query('select country_code from live_matches where id=$1', [oldQuick])).rows[0].country_code, 'SK')

    for (const file of ['031_player_stats_from_confirmed_matches.sql', '034_seasonal_and_career_elo.sql',
      '035_fix_recalculate_safeupdate.sql', '077_live_match_finalization.sql']) await db.exec(await sql(file))
    await db.exec(await sql('077_live_match_finalization.sql'))
    const correctable = '00000000-0000-0000-0000-000000000277'
    await db.exec('set role anon')
    await db.query("select create_qr_device_match_with_settings($1,5,6,7,8,'NL Arena',$2,'golden_point','standard','full_set')",
      [correctable, token])
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-riva-qr-device': token })])
    const fields = [...POINT_STAT_KEYS, 'team_a_game_score', 'team_b_game_score', 'team_a_games', 'team_b_games',
      'team_a_sets', 'team_b_sets', 'serving_team', 'serving_player', 'initial_server_chosen',
      'streak_team', 'current_point_streak', 'started_at', 'finished_at', 'completed_sets', 'set_statistics',
      'service_game_statistics', 'point_history', 'point_history_complete', 'advantage_team', 'tiebreak_score']
    const saveScore = async (score) => {
      await db.query(`update live_matches set ${fields.map((field, index) => `${field}=$${index + 1}`).join(',')}
        where id=$${fields.length + 1}`, [...fields.map(field => typeof score[field] === 'object'
          && score[field] !== null ? JSON.stringify(score[field]) : score[field]), correctable])
    }
    const readScore = async () => {
      await db.exec('reset role')
      const row = (await db.query('select * from live_matches where id=$1', [correctable])).rows[0]
      await db.exec('set role anon')
      return JSON.parse(JSON.stringify(row))
    }
    let tracked = await readScore()
    tracked = { ...tracked, serving_team: 'TEAM_A', initial_server_chosen: true }
    const preWinStates = []
    for (let point = 0; point < 48; point++) {
      preWinStates.push(tracked)
      tracked = awardLivePoint(tracked, 'TEAM_A')
      await saveScore(tracked)
    }
    let persisted = await readScore()
    assert.ok(persisted.finished_at)
    assert.equal(persisted.official_result_id, null, 'Winning point must not submit a pending result')
    assert.equal(persisted.result_finalized_at, null)
    await db.exec('reset role')
    assert.equal((await db.query("select count(*)::int as total from notifications where type='match_result'")).rows[0].total, 8,
      'Only the two historical results have approval notifications')
    const ratingsBefore = (await db.query('select id,elo_rating,career_elo,matches_played from proffiles order by id')).rows
    await db.exec('set role anon')
    tracked = undoSavedPoint(JSON.parse(JSON.stringify(persisted)))
    await saveScore(tracked)
    persisted = await readScore()
    assert.equal(persisted.finished_at, null)
    for (const field of fields) assert.deepEqual(persisted[field], preWinStates.at(-1)[field], field)
    await assert.rejects(db.query('select finalize_live_match($1)', [correctable]), /dohraj/)
    await saveScore(awardLivePoint(tracked, 'TEAM_A'))
    await assert.rejects(db.query('update live_matches set result_finalized_at=now() where id=$1', [correctable]))
    await db.query("select set_config('request.headers','{}',false)")
    await assert.rejects(db.query('select finalize_live_match($1)', [correctable]), /opravnenie/)
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-riva-qr-device': token })])
    const next = '00000000-0000-0000-0000-000000000278'
    await assert.rejects(db.query('select create_live_match_rematch($1,$2,$3,array[0,0,1,2]::smallint[])',
      [correctable, next, token]), /roznych/)
    assert.equal((await db.query('select result_finalized_at from live_matches where id=$1', [correctable])).rows[0].result_finalized_at, null,
      'Failed rematch must roll back finalization')
    await db.exec('reset role')
    assert.deepEqual((await db.query('select id,elo_rating,career_elo,matches_played from proffiles order by id')).rows, ratingsBefore)
    await db.exec('set role anon')
    await db.query('select create_live_match_rematch($1,$2,$3,array[0,2,1,3]::smallint[])', [correctable, next, token])
    await db.query('select finalize_live_match($1)', [correctable])
    await db.query('select create_live_match_rematch($1,$2,$3,array[0,2,1,3]::smallint[])', [correctable, next, token])
    persisted = await readScore()
    assert.ok(persisted.result_finalized_at)
    await assert.rejects(saveScore(tracked), /definitivne/)
    await db.exec('reset role')
    const finalizedResult = (await db.query('select * from matches where id::text=$1', [persisted.official_result_id])).rows[0]
    assert.equal(finalizedResult.status, 'confirmed')
    assert.equal(finalizedResult.elo_applied, true)
    assert.deepEqual(finalizedResult.approved_profile_ids, [], 'Do not claim players manually approved')
    assert.equal(finalizedResult.country_code, 'NL')
    assert.equal(finalizedResult.live_statistics.point_history.length, 48)
    assert.equal((await db.query('select count(*)::int as total from notifications where match_id=$1',
      [persisted.official_result_id])).rows[0].total, 0)
    assert.deepEqual((await db.query('select matches_played from proffiles where id between 5 and 8 order by id')).rows.map(row => row.matches_played),
      [1, 1, 1, 1])
    assert.deepEqual((await db.query('select career_elo from proffiles where id between 5 and 8 order by id')).rows.map(row => row.career_elo),
      [1016, 1016, 984, 984])
    assert.equal((await db.query('select country_code from live_matches where id=$1', [next])).rows[0].country_code, 'NL')
    assert.equal((await db.query('select status from matches where id=$1', [result])).rows[0].status, 'pending',
      'Manual results must keep player approvals')
    const quickFinal = (await db.query("insert into live_matches(team_a_sets,completed_sets,started_at,resume_pin) values (1,'[[6,0]]',now(),'1234') returning id")).rows[0].id
    await db.exec('set role anon')
    await db.query("update live_matches set team_a_sets=2,completed_sets='[[6,0],[6,0]]',finished_at=now() where id=$1", [quickFinal])
    await db.exec('reset role')
    assert.equal((await db.query('select resume_pin from live_matches where id=$1', [quickFinal])).rows[0].resume_pin, '1234',
      'Provisional win must retain the resume PIN')
    await db.exec('set role anon')
    await db.query('select finalize_live_match($1)', [quickFinal])
    await assert.rejects(db.query('update live_matches set team_a_sets=1 where id=$1', [quickFinal]), /definitivne/)
    await db.exec('reset role')
    assert.equal((await db.query('select official_result_id from live_matches where id=$1', [quickFinal])).rows[0].official_result_id, null)
    assert.equal((await db.query('select resume_pin from live_matches where id=$1', [quickFinal])).rows[0].resume_pin, null)
  } finally { await db.close() }
})
