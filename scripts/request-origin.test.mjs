import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedRequestOrigin } from '../lib/request-origin.ts'

test('origin uses external Host instead of Next internal listener and rejects cross-origin requests', () => {
  const check = (origin, host, url = 'http://localhost:51000/api/test', extra = {}) => {
    const headers = { ...extra }
    if (origin !== null) headers.origin = origin
    if (host !== null) headers.host = host
    return isAllowedRequestOrigin(new Request(url, { method: 'POST', headers }))
  }
  assert.equal(check('http://localhost:3000', 'localhost:3000'), true)
  assert.equal(check('http://192.168.1.3:3000', '192.168.1.3:3000'), true)
  assert.equal(check('https://riva.test', 'riva.test', 'https://localhost:51000/api/test'), true)
  assert.equal(check('http://evil.test', 'localhost:3000'), false)
  assert.equal(check('https://localhost:3000', 'localhost:3000'), false)
  assert.equal(check('http://localhost:3001', 'localhost:3000'), false)
  assert.equal(check('null', 'localhost:3000'), false)
  assert.equal(check('http://localhost:3000', 'localhost:3000@evil.test'), false)
  assert.equal(check('http://evil.test', 'localhost:3000', undefined, { 'x-forwarded-host': 'evil.test' }), false)
  assert.equal(check(null, 'localhost:3000'), true)
  assert.equal(isAllowedRequestOrigin(new Request('http://localhost:3000'), true), false)
})
