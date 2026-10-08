import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { playerAccentColor } from '../lib/player-accent.ts'
import { installationPlatform } from '../lib/pwa-installation.ts'
import { withProfileGender } from '../lib/profile-gender-query.ts'
import { buildMatchDetail } from '../lib/match-detail-model.ts'

test('female accents are pink; male and legacy profiles stay lime', () => {
  assert.equal(playerAccentColor('female'), '#f472b6')
  assert.equal(playerAccentColor('male'), '#ccff00')
  assert.equal(playerAccentColor(null), '#ccff00')
  assert.equal(playerAccentColor(undefined), '#ccff00')
})

test('shared avatar renders the same gender accent for initials and photos', async () => {
  await loadBindings()
  const source = await readFile(new URL('../components/player-avatar.tsx', import.meta.url), 'utf8')
  const { code } = await transform(source, {
    filename: 'player-avatar.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' },
  })
  const compiled = code
    .replace('react/jsx-runtime', import.meta.resolve('react/jsx-runtime'))
    .replace('@/lib/player-accent', new URL('../lib/player-accent.ts', import.meta.url).href)
  const { PlayerAvatar } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  for (const [gender, accent] of [['female', '#f472b6'], ['male', '#ccff00'], [null, '#ccff00']]) {
    for (const src of [null, '/images/riva-padel-play-together-logo.png']) {
      const html = renderToStaticMarkup(createElement(PlayerAvatar, { name: 'Test', gender, src }))
      assert.ok(html.includes(`background-color:${accent}`))
      assert.ok(html.includes(`--player-accent:${accent}`))
      assert.ok(html.includes('ring-2'))
      assert.equal(html.includes('<img'), src !== null)
      if (!src) assert.ok(html.includes('>T</span>'))
    }
  }
})

test('installation guide distinguishes Safari, other iOS browsers and desktop-mode iPads', () => {
  assert.deepEqual(installationPlatform('iPhone Version/18 Mobile Safari/604', 'iPhone', 5), { isIOS: true, isSafari: true })
  assert.deepEqual(installationPlatform('iPhone CriOS/140 Mobile Safari/604', 'iPhone', 5), { isIOS: true, isSafari: false })
  assert.deepEqual(installationPlatform('iPhone FxiOS/140 Mobile Safari/604', 'iPhone', 5), { isIOS: true, isSafari: false })
  assert.deepEqual(installationPlatform('Macintosh Version/18 Safari/604', 'MacIntel', 5), { isIOS: true, isSafari: true })
  assert.deepEqual(installationPlatform('Macintosh Version/18 Safari/604', 'MacIntel', 0), { isIOS: false, isSafari: true })
  assert.deepEqual(installationPlatform('iPhone Mobile', 'iPhone', 5), { isIOS: true, isSafari: false })
  assert.equal(installationPlatform('Android Chrome/140 Safari/537', 'Linux', 5).isIOS, false)
})

test('gender query keeps data and only retries an explicitly missing gender column', async () => {
  const calls = []
  const data = [{ id: 1, gender: 'female' }]
  assert.deepEqual(await withProfileGender(async (columns) => {
    calls.push(columns)
    return { data, error: null }
  }, 'id, gender'), { data, error: null })
  assert.deepEqual(calls, ['id, gender'])

  calls.length = 0
  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => warnings.push(message)
  try {
    const result = await withProfileGender(async (columns) => {
      calls.push(columns)
      return columns.includes('gender')
        ? { data: null, error: { code: '42703', message: 'column gender does not exist' } }
        : { data: [{ id: 1 }], error: null }
    }, 'id, gender')
    assert.deepEqual(result.data, [{ id: 1 }])
    assert.deepEqual(calls, ['id, gender', 'id'])
    assert.match(warnings[0], /028_profile_gender.sql/)
  } finally {
    console.warn = originalWarn
  }
  for (const error of [
    { code: '42501', message: 'permission denied' },
    { code: '42703', message: 'column avatar_url does not exist' },
  ]) {
    calls.length = 0
    const result = await withProfileGender(async (columns) => {
      calls.push(columns)
      return { data: null, error }
    }, 'id, gender')
    assert.equal(result.error, error)
    assert.equal(calls.length, 1)
  }
})

test('match detail preserves each participant gender independently', () => {
  const detail = buildMatchDetail({ id: 1, player1_id: 1, player2_id: 2, status: 'pending' }, [
    { id: 1, full_name: 'Player One', gender: 'female' },
    { id: 2, full_name: 'Player Two', gender: 'male' },
  ])
  assert.equal(detail.teams[0].players[0].gender, 'female')
  assert.equal(detail.teams[1].players[0].gender, 'male')
})
