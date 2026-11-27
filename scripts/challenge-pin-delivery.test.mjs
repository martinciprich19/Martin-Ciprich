import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('confirmed challenges receive one private PIN and four notification/email jobs', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.uid',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('email',current_setting('request.email',true)) $$;
      create table proffiles(id bigint primary key, email text, full_name text);
      insert into proffiles select i,'player'||i||'@test.invalid','Player '||i from generate_series(1,5) i;
      create table challenges(id bigint primary key, challenger_1_id bigint,challenger_2_id bigint,
        challenged_1_id bigint,challenged_2_id bigint, challenger_1_accepted boolean,
        challenger_2_accepted boolean,challenged_1_accepted boolean,challenged_2_accepted boolean,
        status text, match_date timestamptz);
      create table notifications(id uuid primary key default gen_random_uuid(),user_id bigint,type text,title text,
        body text,message text,is_read boolean,challenge_id bigint,source_activity_key text);
      create unique index on notifications(user_id,source_activity_key) where source_activity_key is not null;
      create table live_matches(id uuid primary key default gen_random_uuid(),challenge_id text unique,match_pin text unique,
        is_pin_activated boolean default false, team_a_player1_name text,team_b_player1_name text,
        ended_early_at timestamptz,result_finalized_at timestamptz,official_result_id uuid);
      create function respond_to_pair_challenge(bigint,boolean) returns text language plpgsql as $$
        begin
          update challenges set status='accepted' where id=$1;
          insert into live_matches(challenge_id,match_pin) values ($1::text,'4321');
          return 'accepted';
        end $$;
      create function accept_challenge(bigint,bigint) returns text language sql as $$ select 'old'::text $$;
      insert into challenges values
        (1,1,2,3,4,true,true,true,true,'confirmed',now()+interval '1 day'),
        (2,1,2,3,4,true,false,false,false,'pending',now()+interval '1 day'),
        (3,1,2,3,4,true,true,true,true,'confirmed',now()-interval '1 day');
    `)
    const migration = await readFile(new URL('106_challenge_pin_delivery.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    assert.equal((await db.query('select status from challenges where id=1')).rows[0].status, 'accepted')
    assert.equal((await db.query('select status from challenges where id=3')).rows[0].status, 'confirmed')
    assert.equal((await db.query('select count(*)::int as n from notifications where challenge_id=1')).rows[0].n, 4)
    assert.equal((await db.query("select count(*)::int as n from challenge_pin_emails where challenge_id='1'")).rows[0].n, 4)
    assert.ok((await db.query("select * from notifications where type='challenge_match_ready'")).rows.every(row => !/\d{4}/.test(row.message)))
    await db.exec("set request.uid='00000000-0000-0000-0000-000000000001'; set request.email='player2@test.invalid'; set role authenticated")
    assert.equal((await db.query('select * from get_challenge_match_pin(1)')).rows.length, 1)
    await assert.rejects(db.exec('select * from challenge_pin_emails'), /permission denied/)
    await assert.rejects(db.exec('select accept_challenge(2,3)'), /nezhoduje/)
    assert.equal((await db.query('select accept_challenge(2,2) as result')).rows[0].result, 'accepted')
    await db.exec("reset role; set request.email='player5@test.invalid'; set role authenticated")
    assert.equal((await db.query('select * from get_challenge_match_pin(1)')).rows.length, 0)
    await db.exec('reset role')
    assert.equal((await db.query('select count(*)::int as n from notifications where challenge_id=2')).rows[0].n, 4)
    assert.equal((await db.query("select count(*)::int as n from challenge_pin_emails where challenge_id='2'")).rows[0].n, 4)
    await db.exec("update live_matches set result_finalized_at=now() where challenge_id='2'; set request.email='player2@test.invalid'; set role authenticated")
    assert.equal((await db.query('select * from get_challenge_match_pin(2)')).rows.length, 0)
  } finally { await db.close() }
})

test('106 stops when the numeric acceptance workflow is missing', async () => {
  const db = new PGlite()
  try {
    const migration = await readFile(new URL('106_challenge_pin_delivery.sql', import.meta.url), 'utf8')
    await assert.rejects(db.exec(migration), (error) => error.message.includes('Migracia bola zastavena'))
  } finally { await db.close() }
})
