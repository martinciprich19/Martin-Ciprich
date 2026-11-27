import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { sendChallengePinEmail } from '../lib/challenge-pin-email.ts'

test('PIN email is private, localized and idempotent', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_url, init) => { requests.push(init); return Response.json({ id: 'accepted' }) }
  try {
    const job = { id: 'job-1', recipient: 'player@example.test', pin: '0042' }
    for (const language of ['sk', 'en', 'nl']) await sendChallengePinEmail(job, language, 'key', 'sender')
    for (const request of requests) {
      assert.equal(new Headers(request.headers).get('idempotency-key'), 'challenge-pin-job-1')
      const body = JSON.parse(request.body)
      assert.deepEqual(body.to, [job.recipient])
      assert.match(body.text, /0042/)
    }
    assert.match(JSON.parse(requests[1].body).subject, /match confirmed/)
    assert.match(JSON.parse(requests[2].body).subject, /wedstrijd bevestigd/)
    globalThis.fetch = async () => Response.json({ name: 'rate_limit_exceeded', message: 'Failure' }, { status: 429 })
    await assert.rejects(sendChallengePinEmail(job, 'sk', 'key', 'sender'), /rate_limit_exceeded/)
  } finally { globalThis.fetch = originalFetch }
})

test('dispatch retries only unsent recipients and records success without hiding failures', async () => {
  const source = stripTypeScriptTypes(await readFile(new URL('../lib/challenge-pin-dispatch.ts', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '').replace(/\bexport /g, '')
  const jobs = [
    { id: 'first', recipient_profile_id: 1, sent_at: 'already-sent' },
    { id: 'second', recipient_profile_id: 2, sent_at: null },
    { id: 'third', recipient_profile_id: 3, sent_at: null },
  ]
  const sent = []
  let failure = true
  const admin = {
    from(table) {
      const q = {
        select() { return q }, eq() { return q }, is() { return q }, update(value) { q.value = value; return q },
        async order() { return { data: jobs, error: null } },
        async maybeSingle() { return { data: table === 'challenges' ? { status: 'accepted' } : { match_pin: '0042', ended_early_at: null, result_finalized_at: null, official_result_id: null }, error: null } },
        async in() { return { data: jobs.map(job => ({ id: job.recipient_profile_id, email: `${job.id}@test.invalid`, preferred_language: 'en' })), error: null } },
        then(resolve) {
          const job = jobs.find(item => item.id === q.id)
          if (job) job.sent_at = q.value.sent_at
          return Promise.resolve({ error: null }).then(resolve)
        },
      }
      q.eq = (column, value) => { if (column === 'id') q.id = value; return q }
      return q
    },
  }
  const dispatch = new Function('createPushAdminClient', 'delay', 'isAppLanguage', 'sendChallengePinEmail', 'process', `${source}\nreturn dispatchChallengePinEmails`)(
    () => admin, async () => {}, () => true,
    async job => { if (job.id === 'third' && failure) throw new Error('test failure'); sent.push(job.id) },
    { env: { RESEND_API_KEY: 'test', MATCH_EMAIL_FROM: 'sender' } },
  )
  await assert.rejects(dispatch('123'), /1 účastníkom/)
  assert.deepEqual(sent, ['second'])
  assert.ok(jobs[1].sent_at)
  assert.equal(jobs[2].sent_at, null)
  failure = false
  assert.deepEqual(await dispatch('123'), { sent: 1 })
  assert.deepEqual(sent, ['second', 'third'])
  assert.ok(jobs[2].sent_at)
})

test('retry API requires same origin and a verified challenge participant', async () => {
  const source = stripTypeScriptTypes(await readFile(new URL('../app/api/challenge-pin-email/route.ts', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '').replace(/\bexport /g, '')
  let allowed = false
  let calls = 0
  const post = new Function('createClient', 'dispatchChallengePinEmails', `${source}\nreturn POST`)(
    async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) },
      rpc: async () => ({ data: allowed ? [{ pin: '0042' }] : [], error: null }) }),
    async () => { calls++; return { sent: 1 } },
  )
  const request = (origin, challengeId = '123') => new Request('https://riva.example/api/challenge-pin-email', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ challengeId }),
  })
  assert.equal((await post(request('https://evil.example'))).status, 403)
  assert.equal((await post(request('https://riva.example', 'not-an-id'))).status, 400)
  assert.equal((await post(request('https://riva.example'))).status, 403)
  assert.equal(calls, 0)
  allowed = true
  assert.equal((await post(request('https://riva.example'))).status, 200)
  assert.equal(calls, 1)
})
