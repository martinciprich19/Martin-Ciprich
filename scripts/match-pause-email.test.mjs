import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { sendPauseEmail } from '../lib/match-pause-email.ts'

test('pause email sends a private individual message with a stable retry key', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, ...init })
    return Response.json({ id: 'email-accepted' })
  }
  try {
    const job = { email_id: 'job-1', recipient: 'player@example.test', pin: '0042' }
    await sendPauseEmail(job, 'test-key', 'RIVA <matches@example.test>')
    await sendPauseEmail(job, 'test-key', 'RIVA <matches@example.test>')
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url, 'https://api.resend.com/emails')
    const firstHeaders = new Headers(requests[0].headers)
    const retryHeaders = new Headers(requests[1].headers)
    assert.equal(firstHeaders.get('idempotency-key'), 'match-pause-job-1')
    assert.equal(firstHeaders.get('idempotency-key'), retryHeaders.get('idempotency-key'))
    const message = JSON.parse(requests[0].body)
    assert.deepEqual(message.to, [job.recipient])
    assert.match(message.text, /0042/)
    assert.match(message.text, /Zadaj PIN kód/)
    assert.doesNotMatch(message.text, /Pokračovať v zápase/)
    assert.match(message.text, /až do ukončenia zápasu/)
    assert.ok(!message.text.includes('jednorazový'))
    assert.match(message.html, /font-size:48px/)
    assert.match(message.html, /0042/)
    assert.ok(!message.text.includes('test-key'))
    globalThis.fetch = async () => Response.json({ name: 'rate_limit_exceeded', message: 'Failure' }, { status: 429 })
    await assert.rejects(sendPauseEmail(job, 'test-key', 'sender'), /rate_limit_exceeded/)
    globalThis.fetch = async () => Response.json({})
    await assert.rejects(sendPauseEmail(job, 'test-key', 'sender'), /nepotvrdila/)
    globalThis.fetch = async () => { throw new Error('Network failure') }
    await assert.rejects(sendPauseEmail(job, 'test-key', 'sender'), /fetch|Network|request/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pause emails use each recipient language and preserve PIN semantics', async () => {
  const originalFetch = globalThis.fetch
  const messages = []
  globalThis.fetch = async (_url, init) => {
    messages.push(JSON.parse(init.body))
    return Response.json({ id: 'localized-email' })
  }
  try {
    const job = { email_id: 'localized', recipient: 'player@example.test', pin: '0042' }
    await sendPauseEmail(job, 'test-key', 'sender', 'nl')
    await sendPauseEmail(job, 'test-key', 'sender', 'en')
    assert.match(messages[0].subject, /wedstrijd onderbroken/)
    assert.match(messages[0].text, /Voer pincode in/)
    assert.match(messages[0].text, /totdat de wedstrijd is afgelopen/)
    assert.match(messages[0].html, /0042/)
    assert.doesNotMatch(messages[0].text, /Váš zápas/)
    assert.match(messages[1].text, /Enter PIN/)
    assert.match(messages[1].text, /until the match ends/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pause dispatch resolves the language of each registered recipient', async () => {
  const jobs = [
    { email_id: 'nl-job', recipient: 'nl@example.test', pin: '0042' },
    { email_id: 'en-job', recipient: 'en@example.test', pin: '0042' },
  ]
  const sent = []
  const marked = []
  const admin = {
    rpc: async (name, args) => {
      if (name === 'pending_match_pause_emails') return { data: jobs, error: null }
      if (name === 'mark_match_pause_email_sent') marked.push(args.p_email_id)
      return { data: null, error: null }
    },
    from: (table) => {
      assert.equal(table, 'proffiles')
      return { select: () => ({ in: async (_field, recipients) => {
        assert.deepEqual(recipients, jobs.map(job => job.recipient))
        return { data: [
          { email: 'nl@example.test', preferred_language: 'nl' },
          { email: 'en@example.test', preferred_language: 'en' },
        ], error: null }
      } }) }
    },
  }
  const source = stripTypeScriptTypes(readFileSync(new URL('../app/api/pause-match/route.ts', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '').replace(/\bexport /g, '')
  const environment = { SUPABASE_SERVICE_ROLE_KEY: 'test-service', RESEND_API_KEY: 'test-resend', MATCH_EMAIL_FROM: 'test-sender', NEXT_PUBLIC_SUPABASE_URL: 'https://example.test' }
  const post = new Function('createClient', 'delay', 'sendPauseEmail', 'isAppLanguage', 'process', `${source}\nreturn POST`)(
    () => admin, async () => {}, async (job, _key, _from, language) => sent.push([job.recipient, language]),
    language => ['sk', 'en', 'nl'].includes(language), { env: environment },
  )
  const response = await post(new Request('https://riva.example/api/pause-match', {
    method: 'POST', headers: { origin: 'https://riva.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pauseId: '00000000-0000-0000-0000-000000000001', dispatchToken: 'a'.repeat(64), matchId: '00000000-0000-0000-0000-000000000002', pinCode: '0042' }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(sent, [['nl@example.test', 'nl'], ['en@example.test', 'en']])
  assert.deepEqual(marked, ['nl-job', 'en-job'])
})
