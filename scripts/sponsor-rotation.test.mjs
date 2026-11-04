import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

test('sponsors rotate in order with configured durations and refreshing does not restart rotation', async () => {
  await loadBindings()
  const { code } = await transform(await readFile(new URL('../components/scoreboard-view.tsx', import.meta.url), 'utf8'), {
    filename: 'scoreboard-view.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  })
  const ads = [5, 20, 60].map((seconds, index) => ({
    id: String(index), sponsor_name: `Sponsor ${index}`, image_path: `1/${index}.png`,
    display_seconds: seconds, sort_order: index,
  }))
  let state, position, effects, timeout, interval
  const query = {
    select: () => query, eq: () => query, order: () => query,
    then: resolve => Promise.resolve(resolve({ data: structuredClone(ads), error: null })),
  }
  const exports = {}
  vm.runInNewContext(code, {
    exports, console,
    window: {
      setTimeout: (callback, delay) => { timeout = { callback, delay }; return 1 },
      clearTimeout() {},
      setInterval: callback => { interval = callback; return 1 }, clearInterval() {},
    },
    require: name => {
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      if (name === 'react') return {
        useState: () => {
          const index = position++
          return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
        },
        useRef: value => ({ current: value }), useCallback: callback => callback,
        useEffect: callback => effects.push(callback),
      }
      if (name === 'lucide-react') return { LoaderCircle: 'i', Radio: 'i', WifiOff: 'i' }
      if (name === '@/components/page-reload-button') return { PageReloadButton: 'button' }
      if (name === '@/lib/supabase/client') return { createClient: () => ({
        from: () => query, storage: { from: () => ({ getPublicUrl: path => ({ data: { publicUrl: path } }) }) },
      }) }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  function render(index, match = null, sponsors = ads) {
    state = [{ court_id: 1, arena_id: 1, court_name: 'Court', match_id: match }, false, false, sponsors, index]
    position = 0
    effects = []
    timeout = null
    return exports.ScoreboardView({ courtId: '1' })
  }
  for (const [index, seconds] of [[0, 5], [1, 20], [2, 60], [3, 5]]) {
    render(index)
    effects[2]()
    assert.equal(timeout.delay, seconds * 1000)
    timeout.callback()
    assert.equal(state[4], index + 1)
  }
  render(0, 'active-match')
  effects[2]()
  assert.equal(timeout, null)
  function nodes(tree) {
    if (!tree || typeof tree !== 'object') return []
    const children = tree.props?.children
    return [tree, ...[children].flat(Infinity).flatMap(nodes)]
  }
  for (const team of ['TEAM_A', 'TEAM_B']) {
    for (const player of [1, 2]) {
      render(0, 'active-match')
      state[0] = { ...state[0], serving_team: team, serving_player: player,
        team_a_player1_name: 'A1', team_a_player2_name: 'A2',
        team_b_player1_name: 'B1', team_b_player2_name: null }
      position = 0
      const tree = exports.ScoreboardView({ courtId: '1' })
      const servers = nodes(tree).filter(node => node.props?.className === 'court-scoreboard-server')
      assert.equal(servers.length, 1)
      const name = servers[0].props.children[1].props.children
      assert.equal(name, team === 'TEAM_A' ? `A${player}` : player === 1 ? 'B1' : 'Hráč 2')
      assert.equal(nodes(tree).filter(node => node.props?.['aria-label'] === 'Podávajúci hráč').length, 1)
    }
  }
  render(0, null, ads.slice(0, 1))
  effects[2]()
  assert.equal(timeout, null)

  render(2)
  const cleanup = effects[1]()
  await new Promise(resolve => setImmediate(resolve))
  const firstAds = state[3]
  state[4] = 2
  await interval()
  assert.equal(state[3], firstAds, 'Identical refreshed ads preserve the timer dependency')
  assert.equal(state[4], 2, 'Polling does not jump back to the first sponsor')
  cleanup()
})
