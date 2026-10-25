import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

for (const senderType of ['uuid', 'bigint']) {
  test(`066 routes all four activities to private push recipients with ${senderType} sender`, async () => {
    const db = new PGlite()
    try {
      await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key, email text);
        create function auth.uid() returns uuid language sql as $$
          select nullif(current_setting('request.uid',true),'')::uuid;
        $$;
        create function auth.jwt() returns jsonb language sql as $$
          select jsonb_build_object('email', current_setting('request.email',true));
        $$;
        grant usage on schema auth to authenticated, service_role;
        create table proffiles(id bigint primary key,full_name text,email text,settings jsonb default '{}');
        insert into proffiles(id,full_name,email)
          select id,'Player '||id,'player'||id||'@test.invalid' from generate_series(1,4) id;
        insert into auth.users
          select ('00000000-0000-0000-0000-'||lpad(id::text,12,'0'))::uuid,email from proffiles;
        create table friendships(
          id uuid primary key default gen_random_uuid(),user_id bigint references proffiles(id),
          friend_id bigint references proffiles(id),status text
        );
        create table messages(
          id uuid primary key default gen_random_uuid(),sender_id bigint references proffiles(id),
          receiver_id bigint references proffiles(id),content text,is_read boolean default false
        );
        create table pairs(
          id uuid primary key default gen_random_uuid(),
          player_1_id bigint references proffiles(id),player_2_id bigint references proffiles(id)
        );
        create table challenges(
          id uuid primary key default gen_random_uuid(),challenger_1_id bigint,challenger_2_id bigint,
          challenged_1_id bigint,challenged_2_id bigint,arena_id uuid,match_date timestamptz,status text
        );
        create table notifications(
          id uuid primary key default gen_random_uuid(),user_id bigint references proffiles(id),
          sender_id bigint,type text,message text,is_read boolean default false,
          title text not null,body text,created_at timestamptz default now()
        );
        alter table notifications enable row level security;
        grant select on proffiles,notifications to authenticated;
        grant insert,select on friendships,messages to authenticated;
        create policy own_notifications on notifications for select to authenticated using (
          exists(select 1 from proffiles p where p.id=user_id and p.email=auth.jwt()->>'email'));
        alter table friendships enable row level security;
        alter table messages enable row level security;
        create policy own_friend_requests on friendships for insert to authenticated with check (
          exists(select 1 from proffiles p where p.id=user_id and p.email=auth.jwt()->>'email'));
        create policy own_messages on messages for insert to authenticated with check (
          exists(select 1 from proffiles p where p.id=sender_id and p.email=auth.jwt()->>'email'));
        create policy read_friendships on friendships for select to authenticated using (true);
      `)
      for (const file of ['020_pair_invitations.sql', '021_pair_challenge_dual_acceptance.sql',
        '025_challenge_all_participants_accept.sql', '023_create_challenge_rpc.sql',
        '049_web_push_notifications.sql', '064_communication_notifications.sql']) {
        if (senderType === 'bigint' && file === '064_communication_notifications.sql') continue
        await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'))
      }
      if (senderType === 'uuid') await db.exec('alter table notifications alter column sender_id type uuid using null::uuid')
      const migration = await readFile(new URL('066_repair_activity_notifications.sql', import.meta.url), 'utf8')
      await db.exec(migration)
      await db.exec(migration)
      const identity = async player => {
        await db.exec('reset role')
        await db.query("select set_config('request.email',$1,false)", [`player${player}@test.invalid`])
        await db.query("select set_config('request.uid',$1,false)", [`00000000-0000-0000-0000-${String(player).padStart(12, '0')}`])
        await db.exec('set role authenticated')
      }
      for (const player of [1, 2, 3, 4]) {
        await identity(player)
        await db.query('select register_push_token($1,true)', [`player-${player}-device-token-long-enough`])
      }
      await identity(1)
      await assert.rejects(db.exec("insert into messages(sender_id,receiver_id,content) values(3,2,'spoof')"), /row-level security/)
      await db.exec("insert into friendships(user_id,friend_id,status) values(1,2,'pending')")
      await db.exec("insert into messages(sender_id,receiver_id,content) values(1,2,'Secret chat text')")
      assert.equal((await db.query('select * from notifications')).rows.length, 0)
      await db.exec('reset role')
      await db.exec("update friendships set status='accepted'")
      await identity(1)
      const invitation = (await db.query('select create_pair_invitation($1) as id', [2])).rows[0].id
      await identity(2)
      await db.query('select respond_to_pair_invitation($1,true)', [invitation])
      await db.exec('reset role')
      await db.exec('insert into pairs(player_1_id,player_2_id) values(3,4)')
      await identity(1)
      const challenge = (await db.query(`select create_challenge(1,2,3,4,now()+interval '1 day',null) as id`)).rows[0].id
      await db.exec('reset role')
      const notices = (await db.query('select * from notifications order by type,user_id')).rows
      assert.equal(notices.length, 6)
      for (const type of ['friend_request', 'message', 'pair_invitation']) {
        const found = notices.filter(row => row.type === type)
        assert.equal(found.length, 1)
        assert.equal(found[0].user_id, 2)
      }
      assert.deepEqual(notices.filter(row => row.type === 'challenge_request').map(row => row.user_id), [2, 3, 4])
      assert.ok(notices.every(row => row.sender_profile_id === 1 && row.sender_id === null
        && !row.is_read && row.title && row.message.includes('Player 1') && row.body === row.message))
      assert.ok(notices.every(row => !row.message.includes('Secret chat text')))
      assert.ok(notices.filter(row => row.type === 'challenge_request').every(row => row.challenge_id === challenge))
      await db.exec('set role service_role')
      for (const notice of notices) {
        const tokens = (await db.query('select push_notification_tokens($1) as token', [notice.id])).rows.map(row => row.token)
        assert.deepEqual(tokens, [`player-${notice.user_id}-device-token-long-enough`])
      }
      await identity(2)
      assert.equal((await db.query('select * from notifications')).rows.length, 4)
      await db.query('select mark_messages_as_read(1)')
      await db.query('select respond_to_pair_challenge($1,true)', [challenge])
      for (const player of [3, 4]) {
        await identity(player)
        assert.equal((await db.query('select * from notifications')).rows.length, 1)
        await db.query('select respond_to_pair_challenge($1,true)', [challenge])
      }
      await db.exec('reset role')
      assert.equal((await db.query('select status from challenges')).rows[0].status, 'accepted')
      assert.equal((await db.query("select is_read from notifications where type='message'")).rows[0].is_read, true)
      assert.equal((await db.query('select is_read from messages')).rows[0].is_read, true)
      assert.equal((await db.query('select count(*)::int as n from notifications')).rows[0].n, 6)
      await db.exec(migration)
      assert.equal((await db.query('select count(*)::int as n from notifications')).rows[0].n, 6)
      // Even a repeated execution of the new trigger cannot duplicate a source event.
      await db.exec(`create trigger test_duplicate after insert on messages
        for each row execute function notify_activity_recipient();`)
      await identity(1)
      await db.exec("insert into messages(sender_id,receiver_id,content) values(1,2,'second')")
      await db.exec('reset role')
      assert.equal((await db.query("select count(*)::int as n from notifications where type='message'")).rows[0].n, 2)
      await db.exec(`create function fail_notification() returns trigger language plpgsql as $$
        begin raise exception 'Notification failure'; end;
        $$;
        create trigger fail_notification before insert on notifications
          for each row execute function fail_notification();`)
      await identity(1)
      await assert.rejects(db.exec("insert into messages(sender_id,receiver_id,content) values(1,2,'rollback')"), /Notification failure/)
      await assert.rejects(db.exec("insert into friendships(user_id,friend_id,status) values(1,3,'pending')"), /Notification failure/)
      await db.exec('reset role')
      await db.exec("insert into friendships(user_id,friend_id,status) values(1,3,'accepted')")
      await identity(1)
      await assert.rejects(db.query('select create_pair_invitation(3)'), /Notification failure/)
      await assert.rejects(db.exec("select create_challenge(1,2,3,4,now()+interval '2 days',null)"), /Notification failure/)
      await db.exec('reset role')
      assert.equal((await db.query('select count(*)::int as n from messages')).rows[0].n, 2)
      assert.equal((await db.query('select count(*)::int as n from friendships')).rows[0].n, 2)
      assert.equal((await db.query('select count(*)::int as n from pair_invitations')).rows[0].n, 1)
      assert.equal((await db.query('select count(*)::int as n from challenges')).rows[0].n, 1)
      await db.exec(`update proffiles set settings='{"pushAlerts":false}' where id=2; set role service_role`)
      assert.equal((await db.query('select push_notification_tokens($1)', [notices.find(row => row.type === 'message').id])).rows.length, 0)
      await db.exec('set role anon')
      await assert.rejects(db.exec("select * from notifications"), /permission denied/)
      await assert.rejects(db.exec("select push_notification_tokens('anything')"), /permission denied/)
    } finally {
      await db.close()
    }
  })
}

for (const challengeType of ['bigint', 'uuid']) {
  test(`066 preserves ${challengeType} challenge links for all four activity triggers`, async () => {
    const db = new PGlite()
    try {
      const challengeId = challengeType === 'bigint' ? '9007199254740993' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      await db.exec(`
        create role anon;
        create role authenticated;
        create table proffiles(id bigint primary key, full_name text);
        insert into proffiles values (1,'Sender'),(2,'Teammate'),(3,'Opponent 1'),(4,'Opponent 2');
        create table notifications(
          id uuid primary key default gen_random_uuid(),
          user_id bigint references proffiles(id),sender_id uuid,
          type text,message text,is_read boolean default false,
          challenge_id ${challengeType}
        );
        create table friendships(id bigint primary key,user_id bigint,friend_id bigint,status text);
        create table messages(id bigint primary key,sender_id bigint,receiver_id bigint,content text);
        create table pair_invitations(id bigint primary key,inviter_id bigint,invitee_id bigint,status text);
        create table challenges(
          id ${challengeType} primary key,challenger_1_id bigint,challenger_2_id bigint,
          challenged_1_id bigint,challenged_2_id bigint,status text
        );
        alter table notifications add constraint notification_challenge_fk
          foreign key(challenge_id) references challenges(id);
      `)
      const migration = await readFile(new URL('066_repair_activity_notifications.sql', import.meta.url), 'utf8')
      await db.exec(migration)
      await db.exec(`
        insert into friendships values(1,1,2,'pending');
        insert into messages values(1,1,2,'Private content');
        insert into pair_invitations values(1,1,2,'pending');
      `)
      await db.query("insert into challenges values($1,1,2,3,4,'pending')", [challengeId])
      const notices = (await db.query(`select user_id,type,challenge_id::text as challenge_id
        from notifications order by type,user_id`)).rows
      assert.equal(notices.length, 6)
      assert.deepEqual(notices.filter(row => row.type === 'challenge_request'), [2, 3, 4].map(user_id => ({
        user_id, type: 'challenge_request', challenge_id: challengeId,
      })))
      for (const type of ['friend_request', 'message', 'pair_invitation']) {
        assert.deepEqual(notices.filter(row => row.type === type), [{ user_id: 2, type, challenge_id: null }])
      }
      await db.exec(migration)
      assert.equal((await db.query('select count(*)::int as n from notifications')).rows[0].n, 6)
      assert.equal((await db.query(`select data_type from information_schema.columns
        where table_schema='public' and table_name='notifications' and column_name='challenge_id'`)).rows[0].data_type, challengeType)
      assert.equal((await db.query(`select count(*)::int as n from pg_constraint
        where conname='notification_challenge_fk'`)).rows[0].n, 1)
    } finally {
      await db.close()
    }
  })
}

test('066 rejects incompatible recipient schemas before changing data', async () => {
  const db = new PGlite()
  try {
    await db.exec('create table notifications(id uuid,user_id uuid)')
    const migration = await readFile(new URL('066_repair_activity_notifications.sql', import.meta.url), 'utf8')
    await assert.rejects(db.exec(migration), /user_id musi byt ciselne ID profilu/)
    await db.exec('rollback')
    const columns = (await db.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name='notifications' order by ordinal_position`)).rows
    assert.deepEqual(columns.map(row => row.column_name), ['id', 'user_id'])
  } finally {
    await db.close()
  }
})
