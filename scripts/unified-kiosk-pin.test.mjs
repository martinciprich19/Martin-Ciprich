import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const read = file => readFile(new URL(file, import.meta.url), 'utf8')
const token = 'a'.repeat(64)

test('one PIN resolver handles new, saved, invalid, ambiguous and rate-limited PINs', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table live_matches (
        id uuid primary key default gen_random_uuid(), match_pin text, challenge_id text,
        is_pin_activated boolean default false, finished_at timestamptz, ended_early_at timestamptz,
        team_a_sets integer default 1, team_b_sets integer default 0,
        team_a_games integer default 4, team_b_games integer default 5,
        set_format text default 'standard', scoring_type text default 'golden_point',
        paused_at timestamptz default now()-interval '2 minutes', paused_seconds double precision default 0
      );
      create table live_match_pauses (
        id uuid primary key default gen_random_uuid(), match_id uuid,
        pin text unique, resumed_at timestamptz, device_token_hash text
      );
      create table live_match_resume_attempts (
        client_key text primary key, attempts integer, window_started timestamptz default now()
      );
      insert into live_matches(match_pin,challenge_id) values ('1234','1');
      insert into live_matches(match_pin,challenge_id,is_pin_activated) values ('3456','2',true);
      insert into live_match_pauses(match_id,pin)
        select id,'5678' from live_matches where match_pin='3456';
    `)
    const old = await read('062_persistent_match_pin.sql')
    await db.exec(old.slice(old.indexOf('create or replace function public.resume_paused_live_match('),
      old.indexOf('create or replace function public.end_live_match(')))
    const migration = await read('075_unified_kiosk_pin.sql')
    await db.exec(migration)
    await db.exec(migration)
    const resolve = async (pin, key) => (await db.query(
      'select resolve_kiosk_pin($1,$2,$3) as result', [pin, token, key])).rows[0].result
    await db.exec('set role anon')
    await assert.rejects(resolve('1234', 'anon'), /permission denied/)
    await db.exec('reset role; set role service_role')
    assert.deepEqual(await resolve('1234', 'new'), { kind: 'new' })
    const resumed = await resolve('5678', 'resume')
    assert.equal(resumed.kind, 'resume')
    assert.ok(resumed.matchId)
    assert.equal((await resolve('5678', 'repeat')).matchId, resumed.matchId)
    assert.match((await resolve('9999', 'invalid')).error, /PIN/)
    assert.match((await resolve('x', 'malformed')).error, /PIN/)
    await db.exec('reset role')
    const saved = (await db.query('select * from live_matches where id=$1', [resumed.matchId])).rows[0]
    assert.equal(saved.paused_at, null)
    assert.ok(saved.paused_seconds >= 120)
    assert.equal(saved.team_a_games, 4)
    assert.equal(saved.team_b_games, 5)
    assert.equal(saved.scoring_type, 'golden_point')
    assert.equal((await db.query("select attempts from live_match_resume_attempts where client_key='resume'")).rows[0].attempts, 1)
    assert.equal((await db.query("select is_pin_activated from live_matches where match_pin='1234'")).rows[0].is_pin_activated, false)
    await db.exec(`insert into live_matches(match_pin,challenge_id) values ('5678','3')`)
    assert.match((await resolve('5678', 'ambiguous')).error, /viacerým/)
    await db.query('update live_matches set finished_at=now() where id=$1', [resumed.matchId])
    assert.deepEqual(await resolve('5678', 'new-after-finish'), { kind: 'new' })
    for (let i = 0; i < 5; i++) await resolve('9999', 'limit')
    assert.match((await resolve('1234', 'limit')).error, /vela pokusov/)
    assert.match((await resolve('3456', 'used')).error, /PIN/)
  } finally { await db.close() }
})

test('PIN API preserves legacy resume and explicitly dispatches unified requests', async () => {
  const source = stripTypeScriptTypes(await read('../app/api/match-resume/route.ts'))
    .replace(/^import .*$/gm, '').replace(/\bexport /g, '')
  let result = { kind: 'new' }
  const calls = []
  const post = new Function('createClient', 'createHmac', 'process', `${source}\nreturn POST`)(
    () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: result, error: null } } }),
    createHmac, { env: { SUPABASE_SERVICE_ROLE_KEY: 'test-key', NEXT_PUBLIC_SUPABASE_URL: 'https://example.test' } })
  const request = (extra = {}, origin = 'https://riva.example') => new Request('https://riva.example/api/match-resume', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '1234', deviceToken: token, ...extra }),
  })
  let response = await post(request({ resolve: true }))
  assert.deepEqual(await response.json(), { kind: 'new' })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(calls[0].name, 'resolve_kiosk_pin')
  assert.equal(calls[0].args.p_client_key.length, 64)
  result = { kind: 'resume', matchId: '00000000-0000-0000-0000-000000000123' }
  assert.deepEqual(await (await post(request({ resolve: true }))).json(), result)
  assert.deepEqual(await (await post(request())).json(), { matchId: result.matchId })
  assert.equal(calls.at(-1).name, 'resume_paused_live_match')
  result = { error: 'PIN invalid' }
  assert.equal((await post(request({ resolve: true }))).status, 400)
  const count = calls.length
  assert.equal((await post(request({ resolve: 'yes' }))).status, 400)
  assert.equal((await post(request({}, 'https://other.example'))).status, 403)
  assert.equal(calls.length, count)
})

test('kiosk has no new/resume toggle and asks for rules only for a new PIN', async () => {
  const source = await read('../components/kiosk-view.tsx')
  assert.doesNotMatch(source, /setResuming|Nová výzva|aria-pressed=/)
  assert.match(source, /resolve: true/)
  assert.match(source, /result.kind === 'new'/)
  assert.match(source, /setChoosingRules\(true\)/)
  assert.match(source, /saveQrDeviceToken\(result.matchId, token\)/)
  assert.match(source, /activate_live_match_pin_for_court/)
})
