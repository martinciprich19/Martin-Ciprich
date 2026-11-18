import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('registered live matches expose only the team ELO win probability', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create table public.proffiles (id bigint primary key, elo_rating integer);
      create table public.challenges (
        id bigint primary key,
        challenger_1_id bigint, challenger_2_id bigint,
        challenged_1_id bigint, challenged_2_id bigint
      );
      create table public.matches (
        id bigint primary key,
        player1_id bigint,
        winner_id bigint,
        status text,
        elo_delta_team1 integer
      );
      create table public.live_matches (
        id uuid primary key,
        qr_created_by bigint,
        challenge_id text,
        team_a_player1_id bigint,
        team_a_player2_id bigint,
        team_b_player1_id bigint,
        team_b_player2_id bigint,
        official_result_id text
      );
      insert into public.proffiles values (1, 1200), (2, 1200), (3, 1000), (4, 1000);
      insert into public.live_matches values
        ('00000000-0000-0000-0000-000000000001', 1, null, 1, 2, 3, 4, null),
        ('00000000-0000-0000-0000-000000000002', null, null, null, null, null, null, null),
        ('00000000-0000-0000-0000-000000000003', null, '7', null, null, null, null, null);
      insert into public.challenges values (7, 1, 2, 3, 4);
    `)
    await db.exec(await readFile(new URL('./099_live_match_win_probability.sql', import.meta.url), 'utf8'))

    const qrProbability = (await db.query(
      'select live_match_win_probability($1::uuid) as probability',
      ['00000000-0000-0000-0000-000000000001'],
    )).rows[0].probability
    const challengeProbability = (await db.query(
      'select live_match_win_probability($1::uuid) as probability',
      ['00000000-0000-0000-0000-000000000003'],
    )).rows[0].probability
    assert.ok(Math.abs(Number(qrProbability) - 0.759746927) < 0.000001)
    assert.equal(Number(challengeProbability), Number(qrProbability))
    assert.equal((await db.query(
      'select live_match_win_probability($1::uuid) as probability',
      ['00000000-0000-0000-0000-000000000002'],
    )).rows[0].probability, null)
    assert.equal((await db.query(
      'select live_match_win_probability($1::uuid) as probability',
      ['00000000-0000-0000-0000-000000000099'],
    )).rows[0].probability, null)

    await db.exec(`
      insert into public.matches values (10, 1, 1, 'confirmed', 16);
      update public.live_matches
      set official_result_id = '10'
      where id = '00000000-0000-0000-0000-000000000001';
    `)
    assert.equal(Number((await db.query(
      'select live_match_win_probability($1::uuid) as probability',
      ['00000000-0000-0000-0000-000000000001'],
    )).rows[0].probability), 0.5)
  } finally {
    await db.close()
  }
})
