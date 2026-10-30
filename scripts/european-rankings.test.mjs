import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const swc = require('next/dist/build/swc')
await swc.loadBindings()
const code = swc.transformSync(readFileSync(new URL('../components/rankings-view.tsx', import.meta.url), 'utf8'), {
  filename: 'rankings-view.tsx',
  jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
  module: { type: 'commonjs' },
}).code

const profiles = [
  { id: 1, full_name: 'Slovak Player', country_code: 'SK', region: 'Bratislavský kraj', elo_rating: 1200, matches_won: 5 },
  { id: 2, full_name: 'Dutch Player', country_code: 'NL', region: 'Utrecht', elo_rating: 1400, matches_won: 4 },
  { id: 3, full_name: 'Dutch Tied Player', country_code: 'NL', region: 'Drenthe', elo_rating: 1200, matches_won: 6 },
].map(profile => ({ matches_played: 10, level: 'Expert', avatar_url: null, gender: null, auto_venue_id: null, home_venue_id: null, ...profile }))

function harness(country = 'SK', deferred = false) {
  let cursor = 0
  const states = [], effects = [], requests = []
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useMemo: fn => fn(),
    useEffect(callback, deps) {
      const index = cursor++
      const previous = effects[index]
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.()
        effects[index] = { deps, pending: callback }
      }
    },
  }
  const mocks = {
    react,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': { MapPin: 'icon', Search: 'icon', UserRound: 'icon' },
    'next/link': 'link',
    'next/navigation': { useRouter: () => ({ push() {} }) },
    swr: () => ({ data: [], error: null }),
    '@/components/language-provider': { useLanguage: () => ({ t: key => key }) },
    '@/components/league-provider': { useLeague: () => ({ country, regions: country === 'SK' ? ['Bratislavský kraj'] : ['Utrecht', 'Drenthe'], isLoading: false }) },
    '@/lib/arenas': { fetchArenas: async () => [] },
    '@/lib/supabase/client': { createClient: () => { throw new Error('Public rankings must not query a session') } },
    '@/lib/profiles': {
      fetchPlayerProfiles: selectedCountry => new Promise(resolve => {
        const request = { country: selectedCountry, resolve: rows => resolve(rows ?? profiles.filter(profile => !selectedCountry || profile.country_code === selectedCountry)) }
        requests.push(request)
        if (!deferred) request.resolve()
      }),
    },
    '@/lib/errors': { getErrorMessage: error => error.message },
    '@/components/player-avatar': { PlayerAvatar: 'avatar' },
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    exports: module.exports, console,
    require: name => {
      if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`)
      return mocks[name]
    },
  })
  const render = () => {
    cursor = 0
    const wrapper = module.exports.RankingsView({ publicView: true })
    const tree = wrapper.type(wrapper.props)
    for (const effect of effects) {
      if (!effect?.pending) continue
      effect.cleanup = effect.pending()
      effect.pending = null
    }
    return tree
  }
  return { render, requests }
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type))
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)]
}
function text(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return ''
  if (typeof tree !== 'object') return String(tree)
  return Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children)
}
const settle = () => new Promise(resolve => setImmediate(resolve))
function tab(tree, label) {
  return nodes(tree, 'button').find(button => text(button) === label)
}

for (const country of ['SK', 'NL']) {
  test(`European rankings combine countries from ${country} without inheriting subdivision filters`, async () => {
    const view = harness(country)
    view.render()
    await settle()
    let tree = view.render()
    assert.deepEqual(nodes(tree, 'button').filter(button => button.props.role === 'tab').map(text), ['Európsky rebríček', 'Národný rebríček', 'Rebríček arén'])
    assert.equal(view.requests[0].country, country)
    assert.ok(nodes(tree, 'select').length === 1)
    assert.ok(!text(tree).includes('Krajský rebríček'))
    assert.ok(!text(tree).includes('Provinčný rebríček'))
    nodes(tree, 'select')[0].props.onChange({ target: { value: country === 'SK' ? 'Bratislavský kraj' : 'Utrecht' } })
    tab(tree, 'Európsky rebríček').props.onClick()
    tree = view.render()
    assert.equal(nodes(tree, 'li').length, 0, 'old country data must not flash in European results')
    assert.equal(view.requests.at(-1).country, undefined)
    await settle()
    tree = view.render()
    assert.equal(nodes(tree, 'select').length, 0)
    const rows = nodes(tree, 'li').map(text)
    assert.equal(rows.length, 3)
    assert.match(rows[0], /^01Dutch Player/)
    assert.match(rows[1], /^02Dutch Tied Player/)
    assert.match(rows[2], /^03Slovak Player/)
    assert.match(rows[0], /NL/)
    assert.match(rows[2], /SK/)
    nodes(tree, 'input')[0].props.onChange({ target: { value: 'Slovak' } })
    assert.equal(nodes(view.render(), 'li').length, 1, 'European name search still works')
    nodes(tree, 'input')[0].props.onChange({ target: { value: '' } })
    tab(tree, 'Národný rebríček').props.onClick()
    view.render()
    await settle()
    tree = view.render()
    assert.equal(view.requests.at(-1).country, country)
    assert.equal(nodes(tree, 'select')[0].props.value, country === 'SK' ? 'Bratislavský kraj' : 'Utrecht')
    assert.equal(nodes(tree, 'li').length, 1, 'national subdivision filter is preserved')
  })
}

test('a late national response cannot overwrite the European leaderboard', async () => {
  const view = harness('SK', true)
  let tree = view.render()
  tab(tree, 'Európsky rebríček').props.onClick()
  view.render()
  view.requests[1].resolve()
  await settle()
  assert.equal(nodes(view.render(), 'li').length, 3)
  view.requests[0].resolve()
  await settle()
  assert.equal(nodes(view.render(), 'li').length, 3)
})
