import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { parseMatchAvatars } from '../lib/live-match-avatars.ts'

test('avatar slots preserve team/player order and reject ambiguous data', () => {
  assert.deepEqual(parseMatchAvatars([3, 1, 0, 2].map((slot) => ({ player_slot: slot, avatar_url: slot === 1 ? null : `https://example.test/${slot}.png` }))),
    ['https://example.test/0.png', null, 'https://example.test/2.png', 'https://example.test/3.png'])
  assert.throws(() => parseMatchAvatars([]), /fotky/)
  assert.throws(() => parseMatchAvatars(Array(4).fill({ player_slot: 0, avatar_url: null })), /priradenie/)
})

test('challenge avatars use participant IDs, protect inactive PIN games and skip quick games', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql as $$
        select jsonb_build_object('email',current_setting('request.jwt.claim.email',true)) $$;
      create function auth.role() returns text language sql as $$
        select current_setting('request.jwt.claim.role',true) $$;
      create table proffiles(id bigint primary key,email text,avatar_url text);
      create table challenges(id bigint primary key,challenger_1_id bigint,challenger_2_id bigint,challenged_1_id bigint,challenged_2_id bigint);
      create table live_matches(id uuid primary key,challenge_id text,is_pin_activated boolean default false,qr_created_by bigint,
        team_a_player1_id bigint,team_a_player2_id bigint,team_b_player1_id bigint,team_b_player2_id bigint);
      insert into proffiles select i,'player'||i||'@test.invalid','https://example.test/'||i||'.png' from generate_series(1,4)i;
      insert into challenges values(7,2,1,4,3);
      insert into live_matches(id,challenge_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','7');
      insert into live_matches(id) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');`)
    await db.exec(await readFile(new URL('./051_live_match_player_avatars.sql', import.meta.url), 'utf8'))
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await db.exec('set role anon')
    await assert.rejects(db.query('select * from live_match_player_avatars($1)', [id]), /pristup/)
    assert.equal((await db.query('select * from live_match_player_avatars($1)', ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])).rows.length, 0)
    await db.exec(`reset role; set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
      set request.jwt.claim.email='player1@test.invalid'; set request.jwt.claim.role='authenticated'; set role authenticated;`)
    assert.equal((await db.query('select * from live_match_player_avatars($1)', [id])).rows[0].avatar_url, 'https://example.test/2.png')
    await db.exec(`reset role; update live_matches set is_pin_activated=true; set request.jwt.claim.sub=''; set role anon;`)
    assert.deepEqual((await db.query('select * from live_match_player_avatars($1)', [id])).rows.map((p) => p.avatar_url),
      [2, 1, 4, 3].map((i) => `https://example.test/${i}.png`))
  } finally { await db.close() }
})
