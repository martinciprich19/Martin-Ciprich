import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const read = file => readFile(new URL(file, import.meta.url), 'utf8')
const manager = '00000000-0000-0000-0000-000000000011'
const stranger = '00000000-0000-0000-0000-000000000012'
const token = 'a'.repeat(64)

test('only assigned arena managers authorize/revoke installations; tokens remain private', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${manager}'),('${stranger}');
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.user',true),'')::uuid;
      $$;
      create table arenas(id bigint primary key);
      insert into arenas values (1),(2);
      create table arena_admins(arena_id bigint,user_id uuid);
      insert into arena_admins values (1,'${manager}');
      create function is_arena_admin(p_arena_id bigint) returns boolean
        language sql security definer as $$
          select exists(select 1 from public.arena_admins where arena_id=p_arena_id and user_id=auth.uid());
        $$;
    `)
    await db.exec(await read('076_authorized_kiosk_devices.sql'))
    await db.query("select set_config('request.user',$1,false)", [stranger])
    await db.exec('set role authenticated')
    await assert.rejects(db.query("select authorize_kiosk_device(1,'Tablet',$1)", [token]), /oprávnenie/)
    await db.query("select set_config('request.user',$1,false)", [manager])
    await assert.rejects(db.query("select authorize_kiosk_device(2,'Tablet',$1)", [token]), /oprávnenie/)
    const id = (await db.query("select authorize_kiosk_device(1,'Tablet',$1) as id", [token])).rows[0].id
    assert.equal((await db.query('select id,name from arena_kiosk_devices')).rows.length, 1)
    await assert.rejects(db.query('select token_hash from arena_kiosk_devices'), /permission denied/)
    await db.exec('reset role; set role anon')
    assert.equal((await db.query('select is_authorized_kiosk_device($1) as ok', [token])).rows[0].ok, true)
    assert.equal((await db.query('select is_authorized_kiosk_device($1) as ok', ['b'.repeat(64)])).rows[0].ok, false)
    await assert.rejects(db.query('select * from arena_kiosk_devices'), /permission denied/)
    await assert.rejects(db.query("select authorize_kiosk_device(1,'Tablet',$1)", [token]), /permission denied/)
    await db.exec('reset role; set role authenticated')
    await db.query("select set_config('request.user',$1,false)", [stranger])
    assert.equal((await db.query('select id from arena_kiosk_devices')).rows.length, 0)
    await assert.rejects(db.query('select revoke_kiosk_device($1)', [id]), /oprávnenie/)
    await db.query("select set_config('request.user',$1,false)", [manager])
    await db.query('select revoke_kiosk_device($1)', [id])
    assert.equal((await db.query('select is_authorized_kiosk_device($1) as ok', [token])).rows[0].ok, false)
    const second = 'c'.repeat(64)
    await db.query("select authorize_kiosk_device(1,'Second',$1)", [second])
    await db.exec('reset role; delete from arena_admins')
    assert.equal((await db.query('select is_authorized_kiosk_device($1) as ok', [second])).rows[0].ok, false)
  } finally { await db.close() }
})

test('proxy ignores legacy kiosk cookies and URL hints; only a validated device enters kiosk', async () => {
  const source = stripTypeScriptTypes(await read('../proxy.ts')).replace(/^import .*$/gm, '').replace(/\bexport /g, '')
  const jar = entries => {
    const map = new Map(entries)
    return { get: name => map.has(name) ? { value: map.get(name) } : undefined,
      has: name => map.has(name), set: (name,value) => map.set(name,value),
      delete: name => map.delete(name), getAll: () => [...map].map(([name,value]) => ({ name,value })) }
  }
  const response = (kind, status = 200) => ({ kind, status, cookies: jar([]), headers: new Headers() })
  class NextResponse {
    constructor(body, options) { Object.assign(this, response('html', options.status), { body }) }
    static next() { return response('next') }
    static redirect(url) { return { ...response('redirect',307), url: String(url) } }
    static json(_body, options) { return response('json', options.status) }
  }
  let authorized = true
  let courtId = null
  let deviceRole = 'kiosk'
  let available = true
  let fail = false
  let checks = 0
  const proxy = new Function('createServerClient','createDatabaseClient','NextResponse','process',`${source};return proxy`)(
    () => { throw new Error('Auth should not be needed for public pages') },
    () => ({ rpc: async (name) => {
      assert.equal(name, 'get_paired_device_context')
      checks++
      return { data: authorized ? [{ court_id: courtId, available, device_role: deviceRole }] : [], error: fail ? new Error('DB unavailable') : null }
    } }),
    NextResponse, { env: { NEXT_PUBLIC_SUPABASE_URL:'https://db.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test' } })
  const request = (path, cookies = []) => {
    const url = new URL(`https://riva.test${path}`)
    return { url:url.href, nextUrl:url, cookies:jar(cookies) }
  }
  for (const path of ['/kiosk','/match?mode=kiosk','/']) {
    const r = await proxy(request(path, [['riva-kiosk-mode','1']]))
    assert.equal(r.kind,'next')
    assert.equal(r.cookies.get('riva-kiosk-mode').value,'')
  }
  assert.equal(checks,0)
  let r = await proxy(request('/', [['riva-kiosk-device',token]]))
  assert.equal(r.kind,'redirect')
  assert.match(r.url,/\/match\?mode=kiosk/)
  r = await proxy(request('/match?mode=normal', [['riva-kiosk-device',token]]))
  assert.equal(r.cookies.get('riva-kiosk-mode').value,'1')
  r = await proxy(request('/api/kiosk-device', [['riva-kiosk-device',token]]))
  assert.equal(r.status,403)
  authorized = false
  r = await proxy(request('/', [['riva-kiosk-device',token],['riva-kiosk-mode','1']]))
  assert.equal(r.kind,'next')
  assert.equal(r.cookies.get('riva-kiosk-device').value,'')
  fail = true
  r = await proxy(request('/', [['riva-kiosk-device',token]]))
  assert.equal(r.status,503)
  fail = false
  authorized = true
  courtId = 7
  r = await proxy(request('/', [['riva-kiosk-device',token]]))
  assert.match(r.url, /\/match\?mode=kiosk&courtId=7$/)
  r = await proxy(request('/match', [['riva-kiosk-device',token]]))
  const selectionUrl = new URL(r.url)
  assert.equal(selectionUrl.searchParams.get('courtId'), '7')
  assert.equal(selectionUrl.searchParams.get('mode'), 'kiosk')
  r = await proxy(request('/kiosk?courtId=999', [['riva-kiosk-device',token]]))
  assert.match(r.url, /\/kiosk\?courtId=7$/)
  r = await proxy(request('/match?id=game&courtId=999&view=viewer', [['riva-kiosk-device',token]]))
  const matchUrl = new URL(r.url)
  assert.equal(matchUrl.searchParams.get('id'), 'game')
  assert.equal(matchUrl.searchParams.get('courtId'), '7')
  assert.equal(matchUrl.searchParams.get('mode'), 'kiosk')
  assert.equal(matchUrl.searchParams.has('view'), false)
  r = await proxy(request('/match?id=game&courtId=7&mode=kiosk', [['riva-kiosk-device',token]]))
  assert.equal(r.kind, 'next')
  available = false
  r = await proxy(request('/', [['riva-kiosk-device',token]]))
  assert.equal(r.status, 403)
  assert.match(r.body, /Kiosk pozastavený/)
  assert.equal(r.cookies.get('riva-kiosk-device'), undefined, 'Suspension retains device authorization')
  available = true
  r = await proxy(request('/kiosk?courtId=7', [['riva-kiosk-device',token]]))
  assert.equal(r.kind, 'next')
  for (const path of ['/profile', '/players/1', '/rankings', '/arena-admin']) {
    r = await proxy(request(path, [['riva-kiosk-device',token]]))
    assert.match(r.url, /\/match\?mode=kiosk&courtId=7$/)
  }
  deviceRole = 'scoreboard'
  r = await proxy(request('/api/device-heartbeat', [['riva-kiosk-device',token]]))
  assert.equal(r.kind, 'next')
  r = await proxy(request('/match?id=game', [['riva-kiosk-device',token]]))
  assert.match(r.url, /\/scoreboard\/7$/)
  r = await proxy(request('/scoreboard/99', [['riva-kiosk-device',token]]))
  assert.match(r.url, /\/scoreboard\/7$/)
  r = await proxy(request('/scoreboard/7', [['riva-kiosk-device',token]]))
  assert.equal(r.kind, 'next')
  r = await proxy(request('/api/pause-match', [['riva-kiosk-device',token]]))
  assert.equal(r.status, 403)
})

test('device API requires manager authorization and issues only private installation cookies', async () => {
  const source = stripTypeScriptTypes(await read('../app/api/kiosk-device/route.ts'))
    .replace(/^import .*$/gm, '').replace(/\bexport /g, '')
  let user = { id: manager }
  let allowed = true
  const calls = []
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async (name,args) => {
      calls.push({ name,args })
      return { data: name === 'is_arena_admin' ? allowed : manager, error: null }
    },
  }
  const NextResponse = { json: (body,init) => {
    const response = Response.json(body,init)
    response.cookies = { values: [], set: (...args) => response.cookies.values.push(args) }
    return response
  } }
  const post = new Function('randomBytes','NextResponse','createClient',`${source};return POST`)(
    randomBytes,NextResponse,async () => client)
  const request = (origin = 'https://riva.test') => new Request('https://riva.test/api/kiosk-device', {
    method:'POST',headers:{ origin,'content-type':'application/json' },
    body:JSON.stringify({ arenaId:'1',courtId:'7',name:'Tablet' }),
  })
  assert.equal((await post(request('https://other.test'))).status,403)
  user = null
  assert.equal((await post(request())).status,401)
  user = { id: manager }
  allowed = false
  assert.equal((await post(request())).status,403)
  assert.equal(calls.some(call => call.name === 'authorize_court_kiosk_device'),false)
  allowed = true
  const response = await post(request())
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{ authorized:true })
  const deviceCookie = response.cookies.values.find(([name]) => name === 'riva-kiosk-device')
  assert.match(deviceCookie[1],/^[a-f0-9]{64}$/)
  assert.equal(deviceCookie[2].httpOnly,true)
  assert.equal(deviceCookie[2].secure,true)
  assert.equal(deviceCookie[2].sameSite,'lax')
  assert.equal(calls.at(-1).args.p_token,deviceCookie[1])
  assert.equal(calls.at(-1).args.p_court_id, '7')
})
