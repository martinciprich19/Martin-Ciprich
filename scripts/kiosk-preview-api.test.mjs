import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

test('screen preview API protects admin reads and validates device uploads', async () => {
  const code = stripTypeScriptTypes(await readFile(new URL('../app/api/kiosk-preview/route.ts', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '').replace(/\bexport /g, '')
  const calls = []
  let user = null
  let rpcError = null
  const db = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'kiosk_preview_requested' ? true : [], error: rpcError } },
  }
  const { GET, POST } = new Function('NextResponse', 'createDatabaseClient', 'createClient', 'process', 'Buffer', 'console',
    `${code};return {GET,POST}`)({ json: Response.json }, () => db, async () => db,
    { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://db.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test' } }, Buffer, { error() {} })
  const request = (method = 'GET', query = '', token = null, body = null, origin = null) => {
    const r = new Request(`https://riva.test/api/kiosk-preview${query}`, {
      method, ...(body ? { body } : {}),
      headers: { 'content-type': 'image/jpeg', ...(origin ? { origin } : {}) },
    })
    r.nextUrl = new URL(r.url)
    r.cookies = { get: () => token ? { value: token } : undefined }
    return r
  }
  assert.equal((await GET(request('GET', '?courtId=7'))).status, 401)
  assert.equal(calls.length, 0)
  user = { id: 'manager' }
  rpcError = { code: '42501' }
  assert.equal((await GET(request('GET', '?courtId=7'))).status, 403)
  rpcError = null
  assert.equal((await GET(request('GET', '?courtId=bad'))).status, 400)
  assert.equal((await GET(request('GET', '?courtId=7'))).headers.get('Cache-Control'), 'no-store')
  assert.equal((await POST(request('POST'))).status, 401)
  const token = 'a'.repeat(64)
  assert.equal((await POST(request('POST', '', token, 'jpeg', 'https://other.test'))).status, 403)
  assert.equal((await POST(request('POST', '', token, Buffer.alloc(400001)))).status, 413)
  const jpeg = Buffer.from([255, 216, 255, 224])
  assert.equal((await POST(request('POST', '', token, jpeg))).status, 200)
  assert.equal(calls.at(-1).args.p_image, jpeg.toString('base64'))
  rpcError = { code: '42501' }
  assert.equal((await POST(request('POST', '', token, jpeg))).status, 403)
  rpcError = { code: '55000' }
  assert.equal((await POST(request('POST', '', token, jpeg))).status, 409)
})

test('native screen capture is on demand, foreground only and includes the clicker setup root', async () => {
  const source = await readFile(new URL('../android/riva-app/src/sk/rivapadel/apptest/ScreenPreview.java', import.meta.url), 'utf8')
  assert.match(source, /optBoolean\("requested"\)/)
  assert.match(source, /!active \|\| !AppPolicy.trusted\(web.getUrl\(\)\)/)
  assert.match(source, /findViewById\(android.R.id.content\)/)
  assert.match(source, /root.draw\(canvas\)/)
  assert.match(source, /setInstanceFollowRedirects\(false\)/)
  assert.match(source, /worker.shutdownNow\(\)/)
  const activity = await readFile(new URL('../android/riva-app/src/sk/rivapadel/apptest/MainActivity.java', import.meta.url), 'utf8')
  assert.match(activity, /web.onResume\(\);\s+screenPreview.start\(\)/)
  assert.match(activity, /onPause\(\)[^{]*\{\s+foreground = false;\s+if \(screenPreview != null\) screenPreview.stop\(\)/)
})
