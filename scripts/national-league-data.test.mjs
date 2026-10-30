import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { stripTypeScriptTypes } from 'node:module'

function dataLayer(rows = {}) {
  const calls = []
  const client = {
    from(table) {
      const call = { table, operations: [] }
      calls.push(call)
      const query = new Proxy({}, {
        get(_, key) {
          if (key === 'then') return (resolve) => {
            const value = rows[table] ?? []
            const data = call.operations.some(op => op[0] === 'maybeSingle') || Array.isArray(value) ? value : [value]
            resolve({ data, error: null, count: 0 })
          }
          return (...args) => { call.operations.push([key, ...args]); return query }
        },
      })
      return query
    },
  }
  const cache = new Map()
  function load(name) {
    if (name === '@/lib/supabase/client') return { createClient: () => client }
    if (name === '@/lib/friendships') return {}
    if (name === '@/lib/profile-gender-query') return { withProfileGender: (run, columns) => run(columns) }
    if (cache.has(name)) return cache.get(name)
    const source = readFileSync(new URL(`../${name.replace('@/', '')}.ts`, import.meta.url), 'utf8')
    const javascript = stripTypeScriptTypes(source)
    const names = [...javascript.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(match => match[1])
    const outputText = javascript
      .replace(/import\s+\{([^}]+)\}\s+from\s+'([^']+)'/g, (_, bindings, path) => `const {${bindings}} = require('${path}')`)
      .replace(/\bexport\s+/g, '') + `\nObject.assign(exports, {${names.join(',')}})`
    const exports = {}
    cache.set(name, exports)
    new Function('require', 'exports', outputText)(load, exports)
    return exports
  }
  return { calls, load }
}

test('national directories accept optional country without changing legacy all-country calls', async () => {
  const { calls, load } = dataLayer()
  for (const [module, fn, table] of [
    ['profiles', 'fetchPlayerProfiles', 'proffiles'],
    ['players', 'fetchLeaguePlayers', 'proffiles'],
    ['pairs', 'fetchPairs', 'pairs'],
    ['arenas', 'fetchArenas', 'arenas'],
  ]) {
    const api = load(`@/lib/${module}`)
    calls.length = 0
    await api[fn]('NL')
    assert.ok(calls.find(call => call.table === table)?.operations.some(op => op[0] === 'eq' && op[1] === 'country_code' && op[2] === 'NL'), fn)
    calls.length = 0
    await api[fn]()
    assert.equal(calls.some(call => call.operations.some(op => op[0] === 'eq' && op[1] === 'country_code')), false, fn)
  }
})

test('profile league metadata loads, persists and does not become a directory-side mutation', async () => {
  const profile = { id: 5, email: 'nl@test.invalid', country_code: 'NL', preferred_language: 'en', subdivision_code: 'NL-NH' }
  const { calls, load } = dataLayer({ proffiles: profile })
  const api = load('@/lib/profiles')
  const loaded = await api.fetchPlayerProfile(profile.email)
  assert.equal(loaded.country_code, 'NL')
  assert.equal(loaded.preferred_language, 'en')
  assert.equal(loaded.subdivision_code, 'NL-NH')
  await api.createPlayerProfile(profile)
  assert.deepEqual(calls.at(-1).operations.find(op => op[0] === 'insert')[1], profile)
  await api.updatePlayerProfile(profile.email, { preferred_language: 'nl', subdivision_code: 'NL-UT' })
  assert.deepEqual(calls.at(-1).operations.find(op => op[0] === 'update')[1],
    { preferred_language: 'nl', subdivision_code: 'NL-UT' })
  const metadataQuery = calls[0].operations.find(op => op[0] === 'select')[1]
  for (const field of ['country_code', 'preferred_language', 'subdivision_code']) assert.ok(metadataQuery.includes(field))
})

test('personal match history keeps cross-directory access and deleted participant names', async () => {
  const { calls, load } = dataLayer()
  const profiles = load('@/lib/profiles')
  await profiles.fetchPlayerProfiles({ includeDeleted: true })
  assert.equal(calls[0].operations.some(op => op[0] === 'not' && op[1] === 'email'), false)
  calls.length = 0
  const matches = load('@/lib/profile-matches')
  await matches.fetchProfileMatches('5')
  await matches.fetchParticipantMatches('5')
  assert.equal(calls.some(call => call.operations.some(op => op[0] === 'eq' && op[1] === 'country_code')), false)
})
