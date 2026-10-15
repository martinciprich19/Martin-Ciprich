import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { createElement } from 'react'

const require = createRequire(import.meta.url)
const { transformSync } = require('next/dist/compiled/babel/core')
const source = await readFile(new URL('../components/qr-player-search.tsx', import.meta.url), 'utf8')
const compiled = transformSync(source, {
  filename: 'qr-player-search.tsx',
  presets: [[require.resolve('next/babel'), { 'preset-env': { modules: 'commonjs' } }]],
  babelrc: false, configFile: false,
}).code

function harness() {
  const states = [], effects = [], timers = new Map(), requests = [], selections = []
  let cursor = 0, timerId = 0
  const react = {
    createElement,
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useRef: () => ({ current: null }),
    useId: () => 'search-test',
    useEffect(callback, deps) {
      const index = cursor++
      const previous = effects[index]
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.()
        effects[index] = { deps, pending: callback }
      }
    },
  }
  const client = {
    from(table) {
      const query = { table }
      const builder = {}
      for (const method of ['select', 'ilike', 'order', 'limit']) {
        builder[method] = (...args) => { query[method] = args; return builder }
      }
      builder.abortSignal = signal => new Promise(resolve => { requests.push({ ...query, signal, resolve }) })
      return builder
    },
  }
  const module = { exports: {} }
  const mocks = {
    react,
    '@/components/language-provider': { useLanguage: () => ({ t: (sk) => sk }) },
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/errors': { getErrorMessage: (error) => error.message },
    '@/components/player-avatar': { PlayerAvatar: () => null },
  }
  vm.runInNewContext(compiled, {
    exports: module.exports, console: { error() {} }, AbortController,
    document: { getElementById: () => null },
    window: { setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id) },
    require: name => mocks[name] ?? require(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name),
  })
  let props = { excludedIds: [], disabled: false, onSelect: player => selections.push(player) }
  function render(overrides = {}) {
    props = { ...props, ...overrides }
    cursor = 0
    const tree = module.exports.QrPlayerSearch(props)
    for (const effect of effects) {
      if (effect?.pending) {
        const callback = effect.pending
        effect.pending = null
        effect.cleanup = callback()
      }
    }
    return tree
  }
  function nodes(tree, predicate) {
    if (!tree || typeof tree !== 'object') return []
    if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate))
    return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)]
  }
  const input = tree => nodes(tree, node => node.type === 'input')[0]
  const options = tree => nodes(tree, node => node.props?.role === 'option')
  function change(value) {
    input(render()).props.onChange({ target: { value } })
    return render()
  }
  function flush() {
    for (const [id, fn] of timers) { timers.delete(id); void fn() }
  }
  return { render, change, flush, requests, selections, input, options, nodes }
}

const tick = () => new Promise(resolve => setImmediate(resolve))
test('manual search requires two characters, escapes wildcards and excludes selected players', async () => {
  const h = harness()
  h.change('M'); h.flush()
  assert.equal(h.requests.length, 0)
  h.change('Ma'); h.flush()
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].table, 'proffiles')
  assert.equal(h.requests[0].select[0], 'id, full_name, avatar_url')
  assert.equal(h.requests[0].limit[0], 20)
  h.requests[0].resolve({ data: [
    { id: 1, full_name: 'Martin', avatar_url: null }, { id: 2, full_name: 'Maria', avatar_url: '/avatar.png' },
  ], error: null })
  await tick()
  const tree = h.render({ excludedIds: ['1'] })
  assert.equal(h.options(tree).length, 1)
  h.options(tree)[0].props.onClick()
  assert.equal(h.selections[0].id, '2')
  assert.equal(h.input(h.render()).props.value, '')
  h.change('Ma%_'); h.flush()
  assert.equal(h.requests[1].ilike[1], '%Ma\\%\\_%')
})

test('stale results are aborted/ignored; failures offer retry and disabled search does not query', async () => {
  const h = harness()
  h.change('Ma'); h.flush()
  h.change('Pe'); h.flush()
  assert.equal(h.requests[0].signal.aborted, true)
  h.requests[1].resolve({ data: [{ id: 2, full_name: 'Peter', avatar_url: null }], error: null })
  await tick()
  h.requests[0].resolve({ data: [{ id: 1, full_name: 'Martin', avatar_url: null }], error: null })
  await tick()
  const tree = h.render()
  assert.equal(h.options(tree).length, 1)
  h.options(tree)[0].props.onClick()
  assert.equal(h.selections[0].name, 'Peter')
  h.change('Ja'); h.flush()
  h.requests[2].resolve({ data: null, error: { message: 'Search unavailable' } })
  await tick()
  const failed = h.render()
  assert.equal(h.nodes(failed, node => node.props?.role === 'alert').length, 1)
  h.nodes(failed, node => node.type === 'button')[0].props.onClick()
  h.render(); h.flush()
  assert.equal(h.requests.length, 4)
  h.render({ disabled: true }); h.change('Ev'); h.flush()
  assert.equal(h.requests.length, 4)
})
