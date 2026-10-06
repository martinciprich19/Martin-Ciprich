import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')
const uid = (n) => `00000000-0000-0000-0000-00000000000${n}`

test('037 delete_my_account', async (suite) => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth;
      create function auth.jwt() returns jsonb language sql as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
      $$;
      create function auth.uid() returns uuid language sql as $$ select (auth.jwt() ->> 'sub')::uuid; $$;
      create function auth.role() returns text language sql as $$ select auth.jwt() ->> 'role'; $$;
      grant usage on schema auth to authenticated;
      create table auth.users (id uuid primary key, email text);
      create table public.proffiles (
        id bigint primary key, full_name text, email text unique, phone text default '', bio text default '',
        region text default '', level text default '', avatar_url text, home_venue_id bigint, auto_venue_id bigint,
        phone_visibility text default 'accepted_only',
        elo_rating integer default 1000, highest_elo integer default 1000,
        matches_played integer default 0, matches_won integer default 0
      );
      grant select, update on public.proffiles to authenticated;
      create table public.matches (
        id bigint generated always as identity primary key,
        player1_id bigint references proffiles(id), player2_id bigint references proffiles(id),
        team1_player2_id bigint references proffiles(id), team2_player2_id bigint references proffiles(id),
        winner_id bigint references proffiles(id), match_date timestamptz,
        status text, player1_sets_won integer, player2_sets_won integer,
        player1_games_won integer, player2_games_won integer
      );
      -- Personal tables as they exist in the live project (profile ids and an auth uuid).
      create table public.messages (id serial primary key, sender_id bigint references proffiles(id), receiver_id bigint references proffiles(id), content text);
      create table public.friendships (id serial primary key, user_id bigint references proffiles(id), friend_id bigint references proffiles(id));
      create table public.notifications (id serial primary key, user_id uuid references auth.users(id) on delete cascade, title text);
      create table public.pairs (id serial primary key, player_1_id bigint references proffiles(id), player_2_id bigint references proffiles(id));
      create table public.challenges (id serial primary key, challenger_1_id bigint, challenger_2_id bigint, challenged_1_id bigint, challenged_2_id bigint);
      create table public.player_requests (id serial primary key, user_id bigint references proffiles(id));

      insert into auth.users (id, email)
        select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'player' || n || '@test.invalid' from generate_series(1, 5) as n;
      insert into proffiles (id, full_name, email, phone, bio, avatar_url)
        select n, 'Player ' || n, 'player' || n || '@test.invalid', '0900', 'bio', 'https://x/avatar' from generate_series(1, 5) as n;
      insert into messages (sender_id, receiver_id, content) values (1, 2, 'hi'), (2, 1, 'hello'), (2, 3, 'keep');
      insert into friendships (user_id, friend_id) values (1, 2), (3, 2);
      insert into notifications (user_id, title) values ('${uid(1)}', 'mine'), ('${uid(2)}', 'other');
      insert into pairs (player_1_id, player_2_id) values (1, 2), (3, 4);
      insert into challenges (challenger_1_id, challenger_2_id, challenged_1_id, challenged_2_id) values (1, 2, 3, 4), (2, 5, 3, 4);
      insert into player_requests (user_id) values (1), (3);
    `)
    for (const name of [
      '027_match_results_approval_elo.sql', '029_match_confirmation_elo_on_full_approval.sql',
      '031_player_stats_from_confirmed_matches.sql', '032_create_submit_match_result.sql',
      '033_fix_respond_to_match_result_overload.sql', '034_seasonal_and_career_elo.sql',
      '035_fix_recalculate_safeupdate.sql', '036_player_settings.sql', '037_delete_my_account.sql',
    ]) await db.exec(await migration(name))

    await db.exec(`
      insert into matches (player1_id, team1_player2_id, player2_id, team2_player2_id, winner_id, match_date, status)
        values (1, 2, 3, 4, 1, now() - interval '1 day', 'confirmed'), (1, 2, 3, 4, 1, now(), 'pending');
      update proffiles set settings = '{"emailMessages": false}' where id = 1;
    `)
    const asUser = async (n, run) => {
      await db.exec(`set request.jwt.claims = '${JSON.stringify({ sub: uid(n), email: `player${n}@test.invalid`, role: 'authenticated' })}'; set role authenticated;`)
      try { return await run() } finally { await db.exec('reset role; reset request.jwt.claims;') }
    }

    await suite.test('anonymous callers are rejected', async () => {
      await db.exec(`set role anon`)
      await assert.rejects(db.query('select public.delete_my_account()'), /permission denied/)
      await db.exec('reset role')
    })

    await suite.test('player with matches is anonymized, personal data and auth user removed', async () => {
      const eloBefore = (await db.query('select id, elo_rating from proffiles where id in (2, 3) order by id')).rows
      const result = await asUser(1, () => db.query('select public.delete_my_account() as r'))
      assert.equal(result.rows[0].r, 'deleted')

      const profile = (await db.query('select full_name, email, phone, bio, avatar_url, phone_visibility, settings, deleted_at is not null as deleted from proffiles where id = 1')).rows[0]
      assert.deepEqual(profile, { full_name: 'Vymazaný hráč', email: 'deleted-1@deleted.spl.invalid', phone: '', bio: '', avatar_url: null, phone_visibility: 'never', settings: {}, deleted: true })
      assert.equal((await db.query(`select count(*)::int as c from auth.users where id = '${uid(1)}'`)).rows[0].c, 0)
      assert.deepEqual((await db.query('select content from messages order by id')).rows, [{ content: 'keep' }])
      assert.deepEqual((await db.query('select user_id, friend_id from friendships')).rows, [{ user_id: 3, friend_id: 2 }])
      assert.deepEqual((await db.query('select title from notifications')).rows, [{ title: 'other' }])
      assert.deepEqual((await db.query('select player_1_id from pairs')).rows, [{ player_1_id: 3 }])
      assert.deepEqual((await db.query('select challenger_1_id from challenges')).rows, [{ challenger_1_id: 2 }])
      assert.deepEqual((await db.query('select user_id from player_requests')).rows, [{ user_id: 3 }])

      // Confirmed match stays for the other players, the pending one is cancelled.
      assert.deepEqual((await db.query('select status from matches order by id')).rows, [{ status: 'confirmed' }, { status: 'cancelled' }])
      assert.deepEqual((await db.query('select id, elo_rating from proffiles where id in (2, 3) order by id')).rows, eloBefore)
    })

    await suite.test('player without matches is deleted completely', async () => {
      await asUser(5, () => db.query('select public.delete_my_account()'))
      assert.equal((await db.query('select count(*)::int as c from proffiles where id = 5')).rows[0].c, 0)
      assert.equal((await db.query(`select count(*)::int as c from auth.users where id = '${uid(5)}'`)).rows[0].c, 0)
      assert.equal((await db.query('select count(*)::int as c from challenges')).rows[0].c, 0)
    })

    await suite.test('the same e-mail can register a new profile afterwards', async () => {
      await db.exec(`insert into proffiles (id, full_name, email) values (6, 'New', 'player1@test.invalid')`)
    })
  } finally {
    await db.close()
  }
})
