import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const read = (file) => readFile(new URL(file, import.meta.url), 'utf8')

test('public directory includes paused matches with unchanged eligibility, country and arena guards', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table live_matches (
        id uuid primary key default gen_random_uuid(),
        team_a_player1_name text, team_a_player2_name text,
        team_b_player1_name text, team_b_player2_name text,
        team_a_game_score smallint default 15, team_b_game_score smallint default 30,
        team_a_games integer default 4, team_b_games integer default 5,
        team_a_sets integer default 1, team_b_sets integer default 0,
        started_at timestamptz default now(), paused_at timestamptz,
        finished_at timestamptz, ended_early_at timestamptz,
        initial_server_chosen boolean default true,
        is_pin_activated boolean default true,
        country_code text default 'SK', challenge_id text, qr_arena_name text,
        qr_device_token_hash text, resume_pin text
      );
      create table arenas (
        id bigint primary key, name text, city text, region text,
        country_code text, is_active boolean default true
      );
      create table challenges(id bigint primary key, arena_id bigint);
      insert into arenas values
        (1,'Arena','Bratislava','Bratislavský kraj','SK',true),
        (2,'Arena','Amsterdam','Noord-Holland','NL',true);
      insert into challenges values (10,1);
    `)
    const routing = await read('069_national_league_routing.sql')
    await db.exec(routing.slice(
      routing.indexOf('drop function if exists public.get_public_live_matches();'),
      routing.indexOf('-- Quick-game insertion')))
    const migration = await read('074_public_paused_matches.sql')
    await db.exec(migration)
    await db.exec(migration)

    const insert = async (extra = '') => (await db.query(`
      insert into live_matches(qr_arena_name ${extra ? ', ' + extra.split('|')[0] : ''})
      values ('Arena' ${extra ? ', ' + extra.split('|')[1] : ''}) returning id
    `)).rows[0].id
    const active = await insert()
    const paused = await insert('paused_at|now()')
    const dutch = await insert("country_code,paused_at|'NL',now()")
    const official = await insert("challenge_id,paused_at|'10',now()")
    await insert('finished_at,paused_at|now(),now()')
    await insert('ended_early_at,paused_at|now(),now()')
    await insert('started_at,paused_at|null,now()')
    await insert('initial_server_chosen,paused_at|false,now()')
    await insert("challenge_id,is_pin_activated,paused_at|'10',false,now()")
    await db.exec(`insert into live_matches(id,paused_at)
      values ('00000000-0000-0000-0000-000000000001',now())`)

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      const all = (await db.query('select * from get_public_live_matches()')).rows
      assert.deepEqual(new Set(all.map(row => row.id)), new Set([active, paused, dutch, official]))
      const sk = (await db.query("select * from get_public_live_matches('SK')")).rows
      assert.equal(sk.length, 3)
      assert.ok(sk.every(row => row.country_code === 'SK' && row.arena_id === 1))
      const row = sk.find(row => row.id === paused)
      assert.ok(row.paused_at)
      assert.equal(row.team_a_games, 4)
      assert.equal(row.team_b_games, 5)
      assert.equal(row.team_a_sets, 1)
      assert.equal(row.team_b_game_score, 30)
      assert.equal(sk.find(row => row.id === active).paused_at, null)
      assert.equal('resume_pin' in row, false)
      assert.equal('qr_device_token_hash' in row, false)
      assert.equal((await db.query("select * from get_public_live_matches('NL')")).rows[0].arena_id, 2)
      await assert.rejects(db.query('select * from live_matches'), /permission denied/)
      await db.exec('reset role')
    }
    await db.query('update live_matches set paused_at=null where id=$1', [paused])
    assert.equal((await db.query('select paused_at from get_public_live_matches() where id=$1', [paused])).rows[0].paused_at, null)
  } finally {
    await db.close()
  }
})

test('directory renders paused status separately while keeping spectator-only links', async () => {
  const view = await read('../components/live-matches-view.tsx')
  assert.match(view, /paused_at: string \| null/)
  assert.match(view, /match\.paused_at \? \(/)
  assert.match(view, /t\('Prerušený zápas', 'Paused match'\)/)
  assert.match(view, /t\('Naživo', 'Live'\)/)
  assert.match(view, /&view=viewer/)
  assert.doesNotMatch(view, /not finished or paused/)
})
