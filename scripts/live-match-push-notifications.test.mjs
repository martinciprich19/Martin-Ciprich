import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('078 sends private, idempotent win/loss and paused-match PIN notifications', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create table proffiles(id bigint primary key, full_name text);
      insert into proffiles values (1,'Player 1'),(2,'Player 2'),(3,'Player 3'),(4,'Player 4'),(5,'Unrelated');
      create table notifications(
        id uuid primary key default gen_random_uuid(),
        user_id bigint not null references proffiles(id),
        type text not null,
        title text not null,
        body text,
        message text not null,
        is_read boolean not null default false,
        match_id text,
        source_activity_key text,
        created_at timestamptz not null default now()
      );
      create table matches(
        id uuid primary key,
        status text not null,
        player1_id bigint,
        team1_player2_id bigint,
        player2_id bigint,
        team2_player2_id bigint,
        winner_id bigint,
        player1_sets_won integer not null,
        player2_sets_won integer not null
      );
      create table challenges(
        id uuid primary key,
        challenger_1_id bigint,
        challenger_2_id bigint,
        challenged_1_id bigint,
        challenged_2_id bigint
      );
      create table live_matches(
        id uuid primary key,
        team_a_player1_id bigint,
        team_a_player2_id bigint,
        team_b_player1_id bigint,
        team_b_player2_id bigint,
        challenge_id text,
        resume_pin text,
        paused_at timestamptz
      );
      create table live_match_pauses(
        id uuid primary key,
        match_id uuid not null references live_matches(id),
        pin text not null,
        created_at timestamptz not null default now(),
        resumed_at timestamptz
      );
    `)

    const migration = await readFile(new URL('078_live_match_push_notifications.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(migration)

    await db.exec(`
      insert into matches values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pending',1,2,3,4,1,2,0);
      update matches set status='confirmed' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    `)
    const resultNotices = (await db.query(`
      select user_id, title, body, match_id from notifications
      where type='match_finished' order by user_id
    `)).rows
    assert.deepEqual(resultNotices.map(row => row.user_id), [1, 2, 3, 4])
    assert.deepEqual(resultNotices.map(row => row.title), [
      'Výhra v zápase', 'Výhra v zápase', 'Prehra v zápase', 'Prehra v zápase',
    ])
    assert.ok(resultNotices.every(row => row.body.includes('2:0') && row.match_id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
    assert.equal((await db.query("select count(*)::int as n from notifications where type='match_finished'")).rows[0].n, 4)

    await db.exec(`
      insert into live_matches values
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,2,3,4,null,'0042',null);
      insert into live_match_pauses(id,match_id,pin) values
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','0042');
      update live_matches set paused_at=now() where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      update live_matches set paused_at=now()+interval '1 minute' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    `)
    const pauseNotices = (await db.query(`
      select user_id, type, title, body from notifications
      where type='match_paused' order by user_id
    `)).rows
    assert.equal(pauseNotices.length, 4)
    assert.deepEqual(pauseNotices.map(row => row.user_id), [1, 2, 3, 4])
    assert.ok(pauseNotices.every(row => row.title === 'Zápas prerušený' && row.body.includes('0042')))
    assert.ok(!(await db.query('select 1 from notifications where user_id=5')).rows.length)

    await db.exec(`
      update live_matches set paused_at=null,resume_pin=null where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      insert into live_match_pauses(id,match_id,pin) values
        ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','7316');
      update live_matches set resume_pin='7316',paused_at=now()+interval '2 minutes'
        where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    `)
    assert.equal((await db.query("select count(*)::int as n from notifications where type='match_paused'")).rows[0].n, 8)
  } finally {
    await db.close()
  }
})
