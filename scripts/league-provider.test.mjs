import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const swc = require('next/dist/build/swc')
await swc.loadBindings()

function providerHarness(initialUser = null, stored = null, deferProfiles = false) {
  const states = []
  const effects = []
  const queries = []
  const pendingProfiles = new Map()
  const storage = new Map(stored ? [['riva-browsing-country', stored]] : [])
  const memberships = new Map([['nl@example.test', 'NL'], ['sk@example.test', 'SK']])
  let stateIndex = 0
  let authListener
  let unsubscribed = false
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useState(initial) {
      const index = stateIndex++
      if (!(index in states)) states[index] = initial
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useCallback: (callback) => callback,
    useMemo: (callback) => callback(),
    useEffect(effect) { if (!effects.length) effects.push(effect) },
  }
  const client = {
    auth: {
      onAuthStateChange(listener) {
        authListener = listener
        return { data: { subscription: { unsubscribe() { unsubscribed = true } } } }
      },
      getUser: async () => ({ data: { user: initialUser }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: (_column, email) => ({
          maybeSingle: async () => {
            queries.push(email)
            if (deferProfiles) await new Promise(resolve => pendingProfiles.set(email, resolve))
            return { data: { country_code: memberships.get(email) }, error: null }
          },
        }),
      }),
    }),
  }
  const mocks = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@/lib/countries': {
      browserCountry: () => 'NL',
      isCountryCode: (value) => value === 'NL' || value === 'SK',
      regionsForCountry: (country) => country === 'NL' ? ['Utrecht'] : ['Bratislavský kraj'],
    },
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/errors': { getErrorMessage: (error) => String(error) },
    '@/components/language-provider': { useLanguage: () => ({ t: (key) => key }) },
  }
  const module = { exports: {} }
  const filename = new URL('../components/league-provider.tsx', import.meta.url)
  const code = swc.transformSync(readFileSync(filename, 'utf8'), {
    filename: filename.pathname,
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code
  vm.runInNewContext(code, {
    module, exports: module.exports, require: (name) => {
      if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`)
      return mocks[name]
    },
    console, navigator: { languages: ['nl-NL'] },
    window: { localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }, setTimeout },
  })
  const render = () => {
    stateIndex = 0
    return module.exports.LeagueProvider({ children: 'child' }).props.value
  }
  render()
  const cleanup = effects[0]()
  return {
    render, queries, storage, cleanup, pendingProfiles,
    get unsubscribed() { return unsubscribed },
    auth: (user, event = 'SIGNED_IN') => authListener(event, user ? { user } : null),
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 15))

test('guest browsing defaults to Dutch browser and does not create membership', async () => {
  const harness = providerHarness()
  await settle()
  const league = harness.render()
  assert.equal(league.country, 'NL')
  assert.equal(league.profileCountry, null)
  assert.equal(league.isLoading, false)
  league.setCountry('SK')
  assert.equal(harness.storage.get('riva-browsing-country'), 'SK')
  assert.equal(harness.queries.length, 0)
  harness.cleanup()
  assert.equal(harness.unsubscribed, true)
})

test('browsing never changes membership and token refresh does not reset the directory', async () => {
  const user = { id: 'nl-user', email: 'nl@example.test' }
  const harness = providerHarness(user, 'SK')
  await settle()
  assert.equal(harness.render().profileCountry, 'NL')
  harness.render().setCountry('SK')
  harness.auth(user, 'TOKEN_REFRESHED')
  await settle()
  assert.equal(harness.render().country, 'SK')
  assert.equal(harness.render().profileCountry, 'NL')
  assert.equal(harness.queries.length, 1)
  harness.auth({ id: 'sk-user', email: 'sk@example.test' })
  await settle()
  assert.equal(harness.render().profileCountry, 'SK')
  assert.equal(harness.render().country, 'SK')
  harness.auth(null, 'SIGNED_OUT')
  await settle()
  assert.equal(harness.render().profileCountry, null)
  harness.cleanup()
})

test('a late response from the previous account cannot restore its membership', async () => {
  const harness = providerHarness({ id: 'nl-user', email: 'nl@example.test' }, null, true)
  await settle()
  harness.auth({ id: 'sk-user', email: 'sk@example.test' })
  await settle()
  assert.equal(harness.render().isLoading, true)
  assert.equal(harness.render().profileCountry, null)
  harness.pendingProfiles.get('sk@example.test')()
  await settle()
  assert.equal(harness.render().profileCountry, 'SK')
  harness.pendingProfiles.get('nl@example.test')()
  await settle()
  assert.equal(harness.render().profileCountry, 'SK')
  assert.equal(harness.render().country, 'SK')
  harness.cleanup()
})
