import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const swc = require('next/dist/build/swc')
await swc.loadBindings()

function load(file, mocks) {
  const module = { exports: {} }
  const code = swc.transformSync(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    filename: file,
    jsc: { parser: { syntax: 'typescript', tsx: file.endsWith('.tsx') }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    require: name => {
      if (name === 'react/jsx-runtime') return require(name)
      if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`)
      return mocks[name]
    },
  })
  return module.exports
}

function links(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(links)
  return [...(tree.type === 'link' ? [tree.props.href] : []), ...links(tree.props?.children)]
}

const componentMocks = {
  react: { useState: initial => [initial, () => {}] },
  'next/link': 'link',
  'lucide-react': Object.fromEntries(['ArrowRight', 'Globe2', 'Gauge', 'Medal', 'Menu', 'ShieldCheck', 'Trophy', 'X'].map(name => [name, 'icon'])),
  '@/components/riva-logo': { RivaLogo: 'logo' },
  '@/components/league-selector': { LeagueSelector: 'selector' },
  '@/components/language-provider': { useLanguage: () => ({ t: key => key }) },
}

for (const [file, name] of [
  ['components/public-shell.tsx', 'PublicShell'],
  ['components/how-it-works-view.tsx', 'default'],
]) {
  const component = load(file, componentMocks)[name]
  test(`${file}: signed-in logo returns to overview and all registration links are hidden`, () => {
    const destinations = links(component({ kioskMode: false, signedIn: true }))
    assert.equal(destinations[0], '/profile')
    assert.ok(!destinations.includes('/auth/login'))
    assert.ok(!destinations.includes('/auth/sign-up'))
  })
  test(`${file}: guest and kiosk navigation keep their existing destinations`, () => {
    const guest = links(component({ kioskMode: false, signedIn: false }))
    assert.equal(guest[0], '/')
    assert.ok(guest.includes('/auth/login'))
    assert.ok(guest.includes('/auth/sign-up'))
    const kiosk = links(component({ kioskMode: true, signedIn: true }))
    assert.equal(kiosk[0], '/match')
    assert.ok(!kiosk.includes('/auth/login'))
    assert.ok(!kiosk.includes('/auth/sign-up'))
  })
}

test('server navigation verifies confirmed user and skips authentication for kiosks', async () => {
  let kiosk = false
  let user = { email_confirmed_at: '2026-10-27' }
  let authCalls = 0
  const { getPublicNavigation } = load('lib/public-navigation.ts', {
    'next/headers': { cookies: async () => ({ get: () => kiosk ? { value: '1' } : undefined }) },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => {
      authCalls++
      return { data: { user }, error: null }
    } } }) },
  })
  assert.equal((await getPublicNavigation()).signedIn, true)
  user = { email_confirmed_at: null }
  assert.equal((await getPublicNavigation()).signedIn, false)
  user = null
  assert.equal((await getPublicNavigation()).signedIn, false)
  kiosk = true
  const result = await getPublicNavigation()
  assert.equal(result.kioskMode, true)
  assert.equal(result.signedIn, false)
  assert.equal(authCalls, 3)
})

for (const route of ['how-it-works', 'rankings', 'tournaments', 'live-matches']) {
  test(`${route} passes verified navigation state to its header`, async () => {
    const navigation = { signedIn: true, kioskMode: false }
    const page = load(`app/${route}/page.tsx`, {
      '@/lib/public-navigation': { getPublicNavigation: async () => navigation },
      '@/components/public-shell': { PublicShell: 'shell' },
      '@/components/how-it-works-view': { default: 'how-it-works', __esModule: true },
      '@/components/rankings-view': { RankingsView: 'rankings' },
      '@/components/tournaments-view': { TournamentsView: 'tournaments' },
      '@/components/live-matches-view': { LiveMatchesView: 'live-matches' },
    }).default
    const tree = await page()
    assert.equal(tree.props.signedIn, true)
    assert.equal(tree.props.kioskMode, false)
  })
}
