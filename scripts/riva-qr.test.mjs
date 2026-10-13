import assert from 'node:assert/strict'
import test from 'node:test'
import { getRivaProfilePath } from '../lib/riva-qr.ts'

test('RIVA QR codes resolve only to a local player profile', () => {
  const origin = 'https://riva.example'
  assert.equal(getRivaProfilePath(`${origin}/players/4829`, origin), '/players/4829')
  assert.equal(getRivaProfilePath(`${origin}/players/7?ignored=true#details`, origin), '/players/7')
  for (const value of [
    'not a URL',
    'javascript:alert(1)',
    `${origin}/players/0`,
    `${origin}/players/abc`,
    `${origin}/auth/login`,
    'https://untrusted.example/players/4829',
    'https://user:password@riva.example/players/4829',
  ]) {
    assert.throws(() => getRivaProfilePath(value, origin))
  }
})
