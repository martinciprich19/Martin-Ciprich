import assert from 'node:assert/strict'
import test from 'node:test'
import { getRivaProfilePath } from '../lib/riva-qr.ts'

test('profile URLs and player identifiers always resolve to a local player profile', () => {
  const origin = 'https://riva.example'
  for (const value of [
    `${origin}/players/4829`,
    'https://another-deployment.example/players/4829',
    'http://192.168.1.10:3000/players/4829/',
    '/players/4829',
    'players/4829',
    'riva.example/players/4829',
    ' 4829 ',
    'RIVA:4829',
    'riva:player:4829',
    'riva/players/4829',
    '//another-deployment.example/players/4829?ignored=true#details',
  ]) {
    assert.equal(getRivaProfilePath(value, origin), '/players/4829')
  }
  assert.equal(getRivaProfilePath(`${origin}/players/7?ignored=true#details`, origin), '/players/7')
})

test('unrelated content and unsafe navigation targets are rejected', () => {
  const origin = 'https://riva.example'
  for (const value of [
    '',
    'not a URL',
    'javascript:alert(1)',
    `${origin}/players/0`,
    `${origin}/players/abc`,
    `${origin}/auth/login`,
    'https://user:password@riva.example/players/4829',
    'data:text/plain,/players/4829',
    '0',
    'riva:0',
    '/players/4829/extra',
  ]) {
    assert.throws(() => getRivaProfilePath(value, origin))
  }
})
