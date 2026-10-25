import assert from 'node:assert/strict'
import test from 'node:test'
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
    assert.match(message.text, /Pokračovať v zápase/)
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
