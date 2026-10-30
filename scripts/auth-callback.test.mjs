import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { safeNextPath } from '../lib/auth-redirect.ts'

async function callback(query, { exchangeError = null, verifyError = null, user = { email_confirmed_at: '2026-10-27' } } = {}) {
  const calls = []
  const auth = {
    verifyOtp: async (input) => { calls.push(['verify', input]); return { error: verifyError } },
    exchangeCodeForSession: async (code) => { calls.push(['exchange', code]); return { error: exchangeError } },
    getUser: async () => ({ data: { user } }),
    signOut: async () => {},
  }
  const context = vm.createContext({ URL, console: { error() {} } })
  const imports = {
    'next/server': { NextResponse: { redirect: (url, init) => new Response(null, { ...init, status: 307, headers: { ...init?.headers, Location: url.href } }) } },
    '@/lib/supabase/server': { createClient: async () => ({ auth }) },
    '@/lib/auth-redirect': { safeNextPath },
  }
  const source = await readFile(new URL('../app/auth/callback/route.ts', import.meta.url), 'utf8')
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context })
  await module.link(async (name) => {
    assert.ok(name in imports, `Unexpected import: ${name}`)
    const values = imports[name]
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  const response = await module.namespace.GET(new Request(`https://www.rivapadel.app/auth/callback?${query}`))
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  return { destination: new URL(response.headers.get('Location')), calls }
}

test('recovery token opens the new-password screen even with a conflicting next path', async () => {
  const { destination, calls } = await callback('token_hash=test-token&type=recovery&next=/profile')
  assert.equal(destination.pathname, '/auth/update-password')
  assert.equal(calls[0][0], 'verify')
  assert.equal(calls[0][1].type, 'recovery')
})

test('PKCE recovery exchanges the code before opening the new-password screen', async () => {
  const { destination, calls } = await callback('code=test-code&next=%2Fauth%2Fupdate-password')
  assert.equal(destination.pathname, '/auth/update-password')
  assert.deepEqual(calls, [['exchange', 'test-code']])
})

test('failed and expired recovery links show recovery errors rather than signup notices', async () => {
  for (const [query, options, expected] of [
    ['token_hash=expired&type=recovery', { verifyError: { code: 'otp_expired' } }, 'expired'],
    ['code=invalid&next=/auth/update-password', { exchangeError: { code: 'invalid_grant' } }, 'failed'],
    ['error_code=otp_expired&next=/auth/update-password', {}, 'expired'],
    ['next=/auth/update-password', {}, 'failed'],
    ['code=valid&next=/auth/update-password', { user: null }, 'failed'],
  ]) {
    const { destination } = await callback(query, options)
    assert.equal(destination.pathname, '/auth/update-password')
    assert.equal(destination.searchParams.get('recovery'), expected)
  }
})

test('signup callback still opens the verified profile and rejects external redirects', async () => {
  const { destination } = await callback('token_hash=signup-token&type=signup&next=https://evil.example')
  assert.equal(destination.origin, 'https://www.rivapadel.app')
  assert.equal(destination.pathname, '/profile')
  assert.equal(destination.searchParams.get('verified'), '1')
})
