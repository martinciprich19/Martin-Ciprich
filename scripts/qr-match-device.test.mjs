import assert from 'node:assert/strict'
import test from 'node:test'
import { createQrDeviceToken, saveQrDeviceToken, getQrDeviceToken, createQrDeviceClient } from '../lib/qr-match-device.ts'

test('QR device keys survive reloads, stay match-specific and never enter account storage', async () => {
  const previousWindow = globalThis.window
  const previousFetch = globalThis.fetch
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  globalThis.window = { localStorage: storage }
  try {
    const token = createQrDeviceToken()
    assert.match(token, /^[a-f0-9]{64}$/)
    assert.notEqual(token, createQrDeviceToken())
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    saveQrDeviceToken(id, token)
    globalThis.window = { localStorage: storage }
    assert.equal(getQrDeviceToken(id), token)
    assert.equal(getQrDeviceToken('another-match'), null)
    assert.throws(() => saveQrDeviceToken(id, 'bad'), /Neplatný/)
    storage.setItem('riva-qr-match-corrupt', 'invalid')
    assert.throws(() => getQrDeviceToken('corrupt'), /poškodený/)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://qr.test.invalid'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-publishable-key'
    let headers
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).pathname, '/rest/v1/live_matches')
      headers = new Headers(options.headers)
      return new Response(JSON.stringify([{ id }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const client = createQrDeviceClient(token)
    const { error } = await client.from('live_matches').update({ team_a_game_score: 15 }).eq('id', id).select('id')
    assert.equal(error, null)
    assert.equal(headers.get('x-riva-qr-device'), token)
    assert.equal(headers.get('authorization'), 'Bearer test-publishable-key')
    assert.equal((await client.auth.getSession()).data.session, null)
    assert.ok([...values.keys()].every((key) => key.startsWith('riva-qr-match-')))
    globalThis.window = { localStorage: { setItem: () => { throw new Error('Storage disabled') } } }
    assert.throws(() => saveQrDeviceToken(id, token), /Storage disabled/)
  } finally {
    globalThis.window = previousWindow
    globalThis.fetch = previousFetch
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey
  }
})
