import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes, createHmac } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

test('pairing API keeps tokens private, checks origin and promotes only a confirmed target installation', async () => {
  const source = stripTypeScriptTypes(await readFile(new URL('../app/api/device-pair/route.ts', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '').replace(/\bexport /g, '')
  const calls = []
  let paired = []
  let failure = null
  const env = { SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', NEXT_PUBLIC_SUPABASE_URL: 'https://db.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key' }
  const NextResponse = { json: (body, init) => {
    const response = Response.json(body, init)
    response.cookies = { values: [], set: (...args) => response.cookies.values.push(args) }
    return response
  } }
  const createClient = (_url, key) => ({ rpc: async (name, args) => {
    calls.push({ name, args, key })
    return { data: name === 'create_device_pairing_request' ? new Date(Date.now() + 600000).toISOString() : paired, error: failure }
  } })
  const { POST, GET } = new Function('createClient','randomBytes','createHmac','NextResponse','process','console',
    `${source};return {POST,GET}`)(createClient, randomBytes, createHmac, NextResponse, { env }, { error() {} })
  const request = (method, origin = 'https://riva.test', token = null) => {
    const r = new Request('https://riva.test/api/device-pair', { method, headers: { origin, 'x-forwarded-for': '127.0.0.1' } })
    r.nextUrl = new URL(r.url)
    r.cookies = { get: () => token ? { value: token } : undefined }
    return r
  }
  assert.equal((await POST(request('POST', 'https://other.test'))).status, 403)
  assert.equal(calls.length, 0)
  const response = await POST(request('POST'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.match(body.code, /^[A-F0-9]{8}$/)
  assert.equal(body.token, undefined)
  const cookie = response.cookies.values[0]
  assert.equal(cookie[0], 'riva-pairing-token')
  assert.match(cookie[1], /^[a-f0-9]{64}$/)
  assert.equal(cookie[2].httpOnly, true)
  assert.equal(cookie[2].secure, true)
  assert.equal(cookie[2].sameSite, 'lax')
  assert.equal(cookie[2].maxAge, 600)
  assert.equal(calls[0].args.p_token, cookie[1])
  assert.equal(calls[0].args.p_code, body.code)
  assert.equal(calls[0].key, env.SUPABASE_SERVICE_ROLE_KEY)
  assert.notEqual(calls[0].args.p_client_key, '127.0.0.1')
  assert.equal((await GET(request('GET'))).status, 410)
  const pending = await GET(request('GET', undefined, cookie[1]))
  assert.deepEqual(await pending.json(), { paired: false })
  assert.equal(pending.cookies.values.length, 0)
  for (const [role, destination] of [['kiosk','/match?mode=kiosk&courtId=7'], ['scoreboard','/scoreboard/7']]) {
    paired = [{ court_id: 7, available: true, device_role: role }]
    const result = await GET(request('GET', undefined, cookie[1]))
    assert.deepEqual(await result.json(), { paired: true, destination })
    assert.equal(result.cookies.values[0][0], 'riva-kiosk-device')
    assert.equal(result.cookies.values[0][1], cookie[1])
    assert.equal(result.cookies.values[0][2].httpOnly, true)
    assert.equal(calls.at(-1).key, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  }
  paired = [{ court_id: 0, device_role: 'scoreboard' }]
  assert.equal((await GET(request('GET', undefined, cookie[1]))).status, 503)
  failure = { code: 'P0001', message: 'Too many requests' }
  assert.equal((await POST(request('POST'))).status, 429)
})
