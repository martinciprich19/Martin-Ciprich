import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('105 removes the identified sources and preserves one actionable notification per recipient', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.uid',true),'')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql as $$
        select jsonb_build_object('email',current_setting('request.email',true))
      $$;
      create table proffiles(id bigint primary key, full_name text, email text);
      insert into proffiles select i,'Player '||i,'player'||i||'@test.invalid' from generate_series(1,5) i;
      create table pairs(player_1_id bigint,player_2_id bigint);
      insert into pairs values (1,2),(3,4);
      create table challenges(
        id bigint generated always as identity primary key,
        challenger_1_id bigint,challenger_2_id bigint,challenged_1_id bigint,challenged_2_id bigint,
        match_date timestamptz,arena_id bigint,status text,challenger_1_accepted boolean,
        challenger_2_accepted boolean,challenged_1_accepted boolean,challenged_2_accepted boolean
      );
      create table notifications(
        id bigint generated always as identity primary key,user_id bigint,type text,title text,message text,
        is_read boolean default false,challenge_id bigint,source_activity_key text,created_at timestamptz default now()
      );
      create function notify_activity_recipient() returns trigger language plpgsql as $$
        begin
          insert into notifications(user_id,type,title,message,challenge_id,source_activity_key)
          select id,'challenge_request','Canonical','Invitation',new.id,'challenges:'||new.id
          from unnest(array[new.challenger_2_id,new.challenged_1_id,new.challenged_2_id]) id;
          return new;
        end $$;
      create trigger canonical after insert on challenges for each row execute function notify_activity_recipient();
      create function handle_new_challenge_notification() returns trigger language plpgsql as $$
        begin
          insert into notifications(user_id,title,message,is_read,type)
          select id,'Nová výzva na zápas','Boli ste vyzvaní na súboj v padele!',false,'challenge'
          from unnest(array[new.challenged_1_id,new.challenged_2_id]) id;
          return new;
        end $$;
      create trigger legacy after insert on challenges for each row execute function handle_new_challenge_notification();
      create function unrelated_trigger() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger unrelated after insert on challenges for each row execute function unrelated_trigger();
      create function create_challenge(bigint,bigint,bigint,bigint,timestamptz,bigint)
      returns bigint language plpgsql as $$
        declare result bigint;
        begin
          insert into challenges(challenger_1_id,challenger_2_id,challenged_1_id,challenged_2_id,match_date,arena_id,status)
          values ($1,$2,$3,$4,$5,$6,'pending') returning id into result;
          insert into notifications(user_id,title,message,is_read,type,challenge_id)
          select id,'Nová výzva do zápasu','Dostali ste novú výzvu. Potvrďte účasť v aplikácii.',false,'challenge_request',result
          from unnest(array[$3,$4]) id;
          return result;
        end $$;
      select create_challenge(1,2,3,4,now()+interval '1 day',1);
      update notifications set is_read=true where source_activity_key='challenges:1';
      insert into notifications(user_id,title,message,is_read,type,created_at)
      values (3,'Nová výzva na zápas','Boli ste vyzvaní na súboj v padele!',false,'challenge',now()-interval '1 day');
      insert into notifications(user_id,title,message,is_read,type,challenge_id)
      values (3,'Other','Important',false,'challenge_request',1);
    `)
    const migration = await readFile(new URL('105_challenge_notification_duplicates.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    const historical = (await db.query('select user_id,title,is_read from notifications order by id')).rows
    assert.equal(historical.length, 5)
    assert.deepEqual(historical.filter(row => row.title === 'Canonical').map(row => [row.user_id, row.is_read]), [[2, true], [3, false], [4, false]])
    assert.equal(historical.filter(row => row.title === 'Other').length, 1)
    assert.equal(historical.filter(row => row.title === 'Nová výzva na zápas').length, 1)
    assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgrelid='challenges'::regclass and tgname='unrelated'")).rows[0].n, 1)
    assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgrelid='challenges'::regclass and tgname='legacy'")).rows[0].n, 0)
    await db.exec("set request.uid='00000000-0000-0000-0000-000000000001'; set request.email='player1@test.invalid'")
    await assert.rejects(db.exec("select create_challenge(2,1,3,4,now()+interval '1 day',1)"), /Vyzývateľ musí/)
    await assert.rejects(db.exec("select create_challenge(1,2,3,3,now()+interval '1 day',1)"), /rozdielni/)
    await assert.rejects(db.exec("select create_challenge(1,2,3,5,now()+interval '1 day',1)"), /dvojica sa nenašla/)
    await db.exec("select create_challenge(1,2,3,4,now()+interval '1 day',1)")
    const created = (await db.query("select user_id,challenge_id from notifications where source_activity_key='challenges:2' order by user_id")).rows
    assert.deepEqual(created, [{ user_id: 2, challenge_id: 2 }, { user_id: 3, challenge_id: 2 }, { user_id: 4, challenge_id: 2 }])
    assert.equal((await db.query('select count(*)::int as n from notifications where challenge_id=2')).rows[0].n, 3)
    assert.equal((await db.query('select challenger_1_accepted from challenges where id=2')).rows[0].challenger_1_accepted, true)
  } finally {
    await db.close()
  }
})

test('105 refuses to run on an incompatible schema without changing it', async () => {
  const db = new PGlite()
  try {
    await db.exec('create table challenges(id bigint); create table notifications(id bigint)')
    const migration = await readFile(new URL('105_challenge_notification_duplicates.sql', import.meta.url), 'utf8')
    await assert.rejects(db.exec(migration), (error) => error.message.includes('create_challenge') && error.message.includes('Migracia bola zastavena'))
    await db.exec('rollback')
    assert.equal((await db.query("select count(*)::int as n from pg_proc where proname='create_challenge'")).rows[0].n, 0)
  } finally {
    await db.close()
  }
})
