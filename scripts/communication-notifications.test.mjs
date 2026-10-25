import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

for (const senderType of ['bigint', 'uuid']) {
  test(`friend requests and messages create atomic private notifications with ${senderType} legacy sender`, async () => {
    const db = new PGlite()
    try {
      await db.exec(`
        create role anon;
        create role authenticated;
        create schema auth;
        create function auth.uid() returns uuid language sql as $$
          select nullif(current_setting('request.uid',true),'')::uuid;
        $$;
        create function auth.jwt() returns jsonb language sql as $$
          select jsonb_build_object('email',current_setting('request.email',true));
        $$;
        grant usage on schema auth to authenticated;
        create table proffiles(id bigint primary key,full_name text,email text);
        insert into proffiles values (1,'Alice','alice@test.invalid'),
          (2,'Bob','bob@test.invalid'),(3,'Carol','carol@test.invalid');
        create table friendships(
          id uuid primary key default gen_random_uuid(), user_id bigint references proffiles(id),
          friend_id bigint references proffiles(id),status text
        );
        create table messages(
          id uuid primary key default gen_random_uuid(),sender_id bigint references proffiles(id),
          receiver_id bigint references proffiles(id),content text,is_read boolean default false
        );
        create table notifications(
          id uuid primary key default gen_random_uuid(),user_id bigint references proffiles(id),
          sender_id ${senderType},type text,message text,is_read boolean default false
        );
        alter table notifications enable row level security;
        grant select on proffiles,notifications to authenticated;
        grant insert,select on friendships,messages to authenticated;
        create policy own_notifications on notifications for select to authenticated
          using (exists (select 1 from proffiles p where p.id=user_id and p.email=auth.jwt()->>'email'));
        alter table friendships enable row level security;
        alter table messages enable row level security;
        create policy own_friend_requests on friendships for insert to authenticated
          with check (exists (select 1 from proffiles p where p.id=user_id and p.email=auth.jwt()->>'email'));
        create policy own_messages on messages for insert to authenticated
          with check (exists (select 1 from proffiles p where p.id=sender_id and p.email=auth.jwt()->>'email'));
        create policy read_friendships on friendships for select to authenticated using (true);
        create policy read_messages on messages for select to authenticated
          using (exists(select 1 from proffiles p where p.id in (sender_id,receiver_id) and p.email=auth.jwt()->>'email'));
      `)
      const migration = await readFile(new URL('064_communication_notifications.sql', import.meta.url), 'utf8')
      await db.exec(migration)
      await db.exec(migration)
      const identity = async email => {
        await db.query("select set_config('request.email',$1,false)", [email])
        await db.exec("set request.uid='00000000-0000-0000-0000-000000000001'; set role authenticated")
      }
      await identity('alice@test.invalid')
      await assert.rejects(db.exec("insert into friendships(user_id,friend_id,status) values(3,2,'pending')"), /row-level security/)
      await assert.rejects(db.exec("insert into messages(sender_id,receiver_id,content) values(3,2,'spoof')"), /row-level security/)
      await db.exec("insert into friendships(user_id,friend_id,status) values(1,2,'pending')")
      await db.exec("insert into messages(sender_id,receiver_id,content) values(1,2,'Private message content')")
      assert.equal((await db.query('select * from notifications')).rows.length, 0)
      await assert.rejects(db.exec("insert into notifications(user_id,type) values(2,'message')"), /permission denied/)
      await identity('bob@test.invalid')
      const received = (await db.query('select * from notifications order by type')).rows
      assert.equal(received.length, 2)
      assert.deepEqual(received.map(row => row.type), ['friend_request', 'message'])
      assert.ok(received.every(row => row.user_id === 2 && row.sender_profile_id === 1 && !row.is_read))
      assert.ok(received.every(row => row.sender_id === null && row.message.includes('Alice')))
      assert.ok(received.every(row => !row.message.includes('Private message content')))
      assert.ok(received[0].source_friendship_id)
      assert.ok(received[1].source_message_id)
      await db.query('select mark_messages_as_read($1)', [1])
      assert.equal((await db.query("select is_read from notifications where type='message'")).rows[0].is_read, true)
      assert.equal((await db.query("select is_read from notifications where type='friend_request'")).rows[0].is_read, false)
      assert.equal((await db.query('select is_read from messages')).rows[0].is_read, true)
      await identity('carol@test.invalid')
      assert.equal((await db.query('select * from notifications')).rows.length, 0)
      await db.query('select mark_messages_as_read($1)', [1])
      await db.exec('reset role')
      await db.exec(migration)
      assert.equal((await db.query('select count(*)::int as n from notifications')).rows[0].n, 2)
      await db.exec("update friendships set status='accepted'; update messages set is_read=true")
      assert.equal((await db.query('select count(*)::int as n from notifications')).rows[0].n, 2)
      await identity('alice@test.invalid')
      await db.exec("insert into messages(sender_id,receiver_id,content) values(1,2,'Another message')")
      await db.exec('reset role')
      assert.equal((await db.query("select count(*)::int as n from notifications where type='message'")).rows[0].n, 2)
      await db.exec(`
        create function test_notification_failure() returns trigger language plpgsql as $$
          begin raise exception 'Notification failure'; end;
        $$;
        create trigger test_notification_failure before insert on notifications
          for each row execute function test_notification_failure();
      `)
      await identity('alice@test.invalid')
      await assert.rejects(db.exec("insert into messages(sender_id,receiver_id,content) values(1,2,'Rolled back')"), /Notification failure/)
      await assert.rejects(db.exec("insert into friendships(user_id,friend_id,status) values(1,3,'pending')"), /Notification failure/)
      await db.exec('reset role')
      assert.equal((await db.query('select count(*)::int as n from messages')).rows[0].n, 2)
      assert.equal((await db.query('select count(*)::int as n from friendships')).rows[0].n, 1)
      await db.exec('set role anon')
      await assert.rejects(db.exec('select mark_messages_as_read(1)'), /permission denied/)
    } finally {
      await db.close()
    }
  })
}
