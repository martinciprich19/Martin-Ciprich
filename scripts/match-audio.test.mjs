import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { MatchAudio } from '../lib/match-audio.ts'
import { getWinnerAnnouncement } from '../lib/live-match-scoring.ts'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('audio respects mute, cleans up URLs and falls back only for current announcements', async () => {
  const original = { fetch: globalThis.fetch, Audio: globalThis.Audio, create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  let muted = false
  let requests = 0
  let stopFallback = 0
  const fallbacks = []
  const statuses = []
  const audios = []
  const revoked = []
  const deferred = []
  class AudioMock {
    paused = false
    constructor(url) { this.url = url; audios.push(this) }
    async play() { this.played = true }
    pause() { this.paused = true }
    removeAttribute() {}
    load() {}
  }
  globalThis.Audio = AudioMock
  URL.createObjectURL = () => `blob:test-${audios.length}`
  URL.revokeObjectURL = (url) => revoked.push(url)
  globalThis.fetch = async (url, options) => {
    requests++
    assert.equal(url, '/api/match-speech')
    assert.equal(JSON.parse(options.body).matchId, id)
    return new Response('mp3', { headers: { 'Content-Type': 'audio/mpeg' } })
  }
  const speech = new MatchAudio({
    matchId: id,
    isMuted: () => muted,
    onStatus: (status) => statuses.push(status),
    fallback: (text, language) => fallbacks.push({ text, language }),
    stopFallback: () => stopFallback++,
  })
  try {
    muted = true
    await speech.speak('Muted', 'sk')
    assert.equal(requests, 0)
    muted = false
    await speech.speak('Podáva Tím 1.', 'sk')
    assert.equal(audios[0].played, true)
    assert.equal(statuses.at(-1), 'ready')
    audios[0].onended()
    assert.equal(revoked.length, 1)
    await speech.speak('Point for Team 1.', 'en')
    muted = true
    speech.stop()
    assert.equal(audios[1].paused, true)
    assert.equal(revoked.length, 2)
    muted = false
    globalThis.fetch = async () => new Response('failed', { status: 502 })
    await speech.speak('Bod pre tím jedna.', 'sk')
    assert.deepEqual(fallbacks.at(-1), { text: 'Bod pre tím jedna.', language: 'sk' })
    globalThis.fetch = async () => { throw new TypeError('Network offline') }
    await speech.speak('Game score reset.', 'en')
    assert.equal(fallbacks.at(-1).language, 'en')
    globalThis.fetch = () => new Promise((resolve) => deferred.push(resolve))
    const stale = speech.speak('old', 'sk')
    const current = speech.speak('new', 'en')
    deferred[0](new Response('mp3', { headers: { 'Content-Type': 'audio/mpeg' } }))
    await stale
    assert.equal(audios.length, 2)
    muted = true
    speech.stop()
    deferred[1](new Response('mp3', { headers: { 'Content-Type': 'audio/mpeg' } }))
    await current
    assert.equal(audios.length, 2)
    assert.equal(fallbacks.length, 2)
    muted = false
    globalThis.fetch = async () => new Response('mp3', { headers: { 'Content-Type': 'audio/mpeg' } })
    AudioMock.prototype.play = async function () {
      this.onerror()
      throw new Error('Playback denied')
    }
    await speech.speak('Podáva Tím 2.', 'sk')
    assert.equal(fallbacks.length, 3)
    assert.equal(revoked.length, 3)
    assert.ok(stopFallback > 0)
  } finally {
    speech.stop()
    globalThis.fetch = original.fetch
    globalThis.Audio = original.Audio
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
  }
})

async function loadRoute() {
  const calls = []
  const errors = []
  let visible = true
  let providerFailure = null
  let match = {
    id, team_a_sets: 0, team_b_sets: 0,
    team_a_player1_name: 'Martin', team_a_player2_name: 'Peter',
    team_b_player1_name: 'Jana', team_b_player2_name: 'Eva',
  }
  const supabase = {
    from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: visible ? match : null, error: null }),
    }) }) }),
  }
  const context = vm.createContext({
    Request, Response, URL, AbortSignal, Date,
    console: { error: (...args) => errors.push(args), log: () => {} },
    process: { env: { ELEVENLABS_API_KEY: 'server-secret-test', ELEVENLABS_VOICE_ID: '2bNrEsM0omyhLiEyOwqY' } },
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (providerFailure) return new Response(providerFailure.text, { status: providerFailure.status })
      return new Response('mock-mp3', { headers: { 'Content-Type': 'audio/mpeg' } })
    },
  })
  const source = await readFile(new URL('../app/api/match-speech/route.ts', import.meta.url), 'utf8')
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context })
  await module.link(async (name) => {
    if (name === '@/lib/live-match-scoring') {
      return new vm.SyntheticModule(['getWinnerAnnouncement'], function () {
        this.setExport('getWinnerAnnouncement', getWinnerAnnouncement)
      }, { context })
    }
    if (name === 'node:crypto') {
      return new vm.SyntheticModule(['createHash'], function () {
        this.setExport('createHash', createHash)
      }, { context })
    }
    assert.equal(name, '@/lib/supabase/server')
    const dependency = new vm.SyntheticModule(['createClient'], function () {
      this.setExport('createClient', async () => supabase)
    }, { context })
    return dependency
  })
  await module.evaluate()
  const post = (text, { origin = 'https://riva.test', matchId = id, host = 'riva.test', url = 'https://riva.test/api/match-speech' } = {}) => module.namespace.POST(new Request(url, {
    method: 'POST',
    headers: { Origin: origin, Host: host, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, matchId }),
  }))
  return { post, calls, errors, context, setVisible: (value) => { visible = value },
    setMatch: (value) => { match = { ...match, ...value } },
    setFailure: (status = 401, text = 'Provider rejected key server-secret-test') => { providerFailure = { status, text } } }
}

test('server uses private key, configured voice settings, audio caching and input/access validation', async () => {
  const route = await loadRoute()
  assert.equal((await route.post('Podáva Tím 1.', { origin: 'https://evil.test' })).status, 403)
  route.errors.length = 0
  assert.equal((await route.post('arbitrary paid synthesis')).status, 400)
  assert.equal((await route.post('Podáva Tím 1.', { matchId: 'bad' })).status, 400)
  route.setVisible(false)
  assert.equal((await route.post('Podáva Tím 1.')).status, 404)
  assert.equal(route.calls.length, 0)
  assert.equal((await route.post('Podáva Tím 1.', {
    url: 'http://0.0.0.0:3000/api/match-speech',
    host: 'localhost:3000',
    origin: 'http://localhost:3000',
  })).status, 404)
  route.setVisible(true)
  const response = await route.post('Podáva Tím 1.')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'audio/mpeg')
  assert.equal(await response.text(), 'mock-mp3')
  assert.equal(route.calls[0].url, 'https://api.elevenlabs.io/v1/text-to-speech/2bNrEsM0omyhLiEyOwqY')
  assert.equal(route.calls[0].options.headers['xi-api-key'], 'server-secret-test')
  assert.deepEqual(JSON.parse(route.calls[0].options.body), {
    text: 'Podáva Tím 1.',
    model_id: 'eleven_multilingual_v2',
    voice_settings: { stability: 0.95, similarity_boost: 0.75, speed: 0.80, style: 0 },
  })
  await route.post('Podáva Tím 1.')
  assert.equal(route.calls.length, 1)
  const repeated = await Promise.all(Array.from({ length: 4 }, () => route.post('Point for Team 1.')))
  assert.ok(repeated.every((r) => r.status === 200))
  assert.equal(route.calls.length, 2)
  route.setFailure()
  const failed = await route.post('Game score reset.')
  assert.equal(failed.status, 502)
  assert.deepEqual(await failed.json(), {
    error: 'Provider rejected key [REDACTED]',
    provider: 'ElevenLabs',
    providerStatus: 401,
  })
  assert.equal(failed.headers.get('cache-control'), 'no-store')
  assert.equal(route.errors.length, 1)
  assert.equal(route.errors[0][0], 'ElevenLabs API error:')
  assert.equal(route.errors[0][1], 401)
  assert.equal(route.errors[0][2], 'Provider rejected key [REDACTED]')
  assert.ok(!JSON.stringify(route.errors).includes('server-secret-test'))
  route.context.process.env.ELEVENLABS_API_KEY = ''
  assert.equal((await route.post('Podáva Tím 1.')).status, 503)
})

test('Slovak point announcements use exact team wording and require a final period', async () => {
  const route = await loadRoute()
  for (const team of ['tím jedna', 'tím dva']) {
    for (const suffix of ['', `, gem pre ${team}`]) {
      const text = `Bod pre ${team}${suffix}.`
      assert.equal((await route.post(text)).status, 200)
      assert.equal(JSON.parse(route.calls.at(-1).options.body).text, text)
      assert.equal((await route.post(text.slice(0, -1))).status, 400)
      assert.equal((await route.post(`${text.slice(0, -1)}?`)).status, 400)
    }
  }
  assert.equal(route.calls.length, 4)
  assert.ok(route.calls.every(({ options }) => JSON.parse(options.body).text.endsWith('.')))
  for (const team of ['prvý tím', 'druhý tím', 'tím jeden']) {
    assert.equal((await route.post(`Bod pre ${team}.`)).status, 400)
    assert.equal((await route.post(`Bod pre ${team}, gem pre ${team}.`)).status, 400)
  }
  assert.equal(route.calls.length, 4)
})

test('speech text is trimmed before validation, synthesis and cache lookup', async () => {
  const route = await loadRoute()
  const text = 'Bod pre tím jedna.'
  assert.equal((await route.post(` \t\n\uFEFF\u00A0${text}\u00A0\r\n `)).status, 200)
  assert.deepEqual(JSON.parse(route.calls[0].options.body), {
    text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: { stability: 0.95, similarity_boost: 0.75, speed: 0.80, style: 0 },
  })
  assert.equal((await route.post(text)).status, 200)
  assert.equal(route.calls.length, 1)
  assert.equal((await route.post(' \t\n ')).status, 400)
  assert.equal((await route.post(`\u200B${text}`)).status, 400)
  assert.equal(route.calls.length, 1)
})

test('standalone Slovak scores are spoken as words with a final period', async () => {
  const route = await loadRoute()
  for (const [input, text] of [
    ['0', 'Nula.'], ['15', 'Pätnásť.'], ['30', 'Tridsať.'], ['40', 'Štyridsať.'],
    ['Zhoda', 'Zhoda.'], ['Výhoda', 'Výhoda.'],
  ]) {
    assert.equal((await route.post(` ${input} `)).status, 200)
    assert.equal(JSON.parse(route.calls.at(-1).options.body).text, text)
    assert.equal((await route.post(`${input}.`)).status, 200)
    assert.equal((await route.post(text)).status, 200)
    assert.equal((await route.post(text.slice(0, -1))).status, 200)
  }
  assert.equal(route.calls.length, 6)
  for (const text of ['Gem pre tím jedna.', 'Gem pre tím dva.']) {
    assert.equal((await route.post(text)).status, 200)
    assert.equal(JSON.parse(route.calls.at(-1).options.body).text, text)
  }
  for (const text of ['45', '45.', 'Pätnásť?', 'Výhoda!', 'Gem pre tím jedna']) {
    assert.equal((await route.post(text)).status, 400)
  }
  assert.equal(route.calls.length, 8)
  assert.ok(route.calls.every(({ options }) => {
    const body = JSON.parse(options.body)
    return body.text.endsWith('.') && body.voice_settings.stability === 0.95
      && body.voice_settings.style === 0
  }))
})

test('winner speech names only the actual winning pair of a finished match', async () => {
  const route = await loadRoute()
  const first = 'Zápas vyhral tím jedna. Víťazná dvojica: Martin a Peter.'
  const second = 'Zápas vyhral tím dva. Víťazná dvojica: Jana a Eva.'
  assert.equal((await route.post(first)).status, 400)
  route.setMatch({ team_a_sets: 2, team_b_sets: 1 })
  assert.equal((await route.post(first)).status, 200)
  assert.equal(JSON.parse(route.calls.at(-1).options.body).text, first)
  assert.equal((await route.post(second)).status, 400)
  assert.equal((await route.post(first.replace('Martin', 'Someone else'))).status, 400)
  assert.equal((await route.post('Team 1 won the match. The winning pair: Martin and Peter.')).status, 200)
  route.setMatch({ team_a_sets: 1, team_b_sets: 2 })
  assert.equal((await route.post(second)).status, 200)
  assert.equal(JSON.parse(route.calls.at(-1).options.body).text, second)
  assert.equal(route.calls.length, 3)
})

test('provider 403 returns the entire original error body and status without truncation', async () => {
  const route = await loadRoute()
  const details = JSON.stringify({
    detail: { status: 'permission_denied', message: `Voice access denied.\n${'Details '.repeat(600)}` },
  })
  route.setFailure(403, details)
  const response = await route.post('Podáva Tím 2.')
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), {
    error: details, provider: 'ElevenLabs', providerStatus: 403,
  })
  assert.deepEqual(route.errors[0], ['ElevenLabs API error:', 403, details])
})
