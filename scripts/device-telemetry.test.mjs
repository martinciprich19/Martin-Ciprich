import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

test('connection state uses exact 90-second threshold and unknown is not offline', async () => {
  const source = stripTypeScriptTypes(await readFile(new URL('../lib/device-telemetry.ts', import.meta.url), 'utf8')).replace(/\bexport /g, '')
  const state = new Function(`${source};return deviceConnectionState`)()
  const now = Date.parse('2026-11-05T00:00:00Z')
  assert.equal(state(null, now), 'unknown')
  assert.equal(state('invalid', now), 'unknown')
  assert.equal(state(new Date(now - 90000).toISOString(), now), 'online')
  assert.equal(state(new Date(now - 90001).toISOString(), now), 'offline')
})

test('heartbeat endpoint requires device identity and validates all telemetry fields', async () => {
  const source = stripTypeScriptTypes(await readFile(new URL('../app/api/device-heartbeat/route.ts', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '').replace(/\bexport /g, '')
  const calls = []
  let failure = null
  const POST = new Function('NextResponse', 'createClient', 'process', 'console', `${source};return POST`)(
    { json: Response.json },
    () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error: failure } } }),
    { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://db.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test' } }, { error() {} },
  )
  function request(headers = {}, token = 'a'.repeat(64)) {
    const r = new Request('https://riva.test/api/device-heartbeat', { method: 'POST', headers })
    r.nextUrl = new URL(r.url)
    r.cookies = { get: () => token === null ? undefined : { value: token } }
    return r
  }
  assert.deepEqual(await (await POST(request({}, null))).json(), { paired: false })
  assert.equal((await POST(request({}, 'invalid'))).status, 401)
  for (const headers of [
    { 'x-riva-source': 'android', 'x-riva-battery': '101' },
    { 'x-riva-source': 'android', 'x-riva-battery': '-1' },
    { 'x-riva-source': 'browser', 'x-riva-version': '1.11' },
    { 'x-riva-source': 'android', 'x-riva-charging': 'yes' },
    { 'x-riva-source': 'android', 'x-riva-version': '<script>' },
    { 'x-riva-source': 'invalid' },
  ]) assert.equal((await POST(request(headers))).status, 400)
  assert.equal(calls.length, 0)
  assert.equal((await POST(request({ origin: 'https://other.test', 'x-riva-source': 'browser' }))).status, 403)
  const result = await POST(request({ 'x-riva-source': 'android', 'x-riva-battery': '0', 'x-riva-charging': 'false', 'x-riva-version': '1.11' }))
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(calls.at(-1), { name: 'report_device_heartbeat', args: {
    p_token: 'a'.repeat(64), p_source: 'android', p_battery: 0, p_charging: false, p_version: '1.11',
  } })
  assert.equal((await POST(request({ 'x-riva-source': 'browser' }))).status, 200)
  assert.equal(calls.at(-1).args.p_battery, null)
  failure = { code: '42501' }
  assert.equal((await POST(request({ 'x-riva-source': 'browser' }))).status, 403)
  failure = { code: 'PGRST202' }
  assert.equal((await POST(request({ 'x-riva-source': 'browser' }))).status, 503)
})
