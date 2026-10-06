import test from 'node:test'
import assert from 'node:assert/strict'
import { safeNextPath, emailRedirectUrl } from '../lib/auth-redirect.ts'

test('safeNextPath keeps same-origin relative paths', () => {
  assert.equal(safeNextPath('/profile'), '/profile')
  assert.equal(safeNextPath('/profile?tab=matches#x'), '/profile?tab=matches#x')
  assert.equal(safeNextPath('/players/9'), '/players/9')
})

test('safeNextPath rejects open redirects and falls back', () => {
  for (const value of [null, undefined, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'profile', 'javascript:alert(1)']) {
    assert.equal(safeNextPath(value), '/profile', String(value))
  }
  assert.equal(safeNextPath('//evil.com', '/auth/update-password'), '/auth/update-password')
})

test('emailRedirectUrl points to the auth callback with an encoded next path', () => {
  assert.equal(emailRedirectUrl('http://localhost:3000'), 'http://localhost:3000/auth/callback?next=%2Fprofile')
  assert.equal(emailRedirectUrl('https://spl.sk', '//evil.com'), 'https://spl.sk/auth/callback?next=%2Fprofile')
})
