import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { pointSuccess } from '../lib/match-statistics.ts'

const require = createRequire(import.meta.url)
const source = await readFile(new URL('../components/profile-serve-statistics.tsx', import.meta.url), 'utf8')
const { transformSync } = require('next/dist/compiled/babel/core')
const compiled = transformSync(source, {
  filename: 'profile-serve-statistics.tsx',
  presets: [[require.resolve('next/babel'), { 'preset-env': { modules: 'commonjs' } }]],
  babelrc: false,
  configFile: false,
}).code

function render(state, language = 'sk') {
  const module = { exports: {} }
  const mocks = {
    swr: () => ({ mutate() {}, ...state }),
    '@/components/language-provider': { useLanguage: () => ({ t: (sk, en) => language === 'sk' ? sk : en }) },
    '@/lib/supabase/client': { createClient: () => { throw new Error('Unexpected network request during render') } },
    '@/lib/match-statistics': { pointSuccess },
  }
  vm.runInNewContext(compiled, {
    exports: module.exports,
    require: (name) => mocks[name] ?? require(name.startsWith('@babel/runtime/')
      ? `next/dist/compiled/${name}` : name),
  })
  const html = renderToStaticMarkup(createElement(module.exports.ProfileServeStatistics, { profileId: 1 }))
  return [...html.matchAll(/<article\b[^>]*>(.*?)<\/article>/gs)].map(([, card]) => ({
    html: card,
    label: card.match(/<h3\b[^>]*>(.*?)<\/h3>/s)[1],
    value: card.match(/<p\b[^>]*>(.*?)<\/p>/s)[1],
  }))
}

test('serve and return point counts have their own cards, separate from percentage rates', () => {
  const data = { serve: pointSuccess(9, 3), receive: pointSuccess(4, 6), recorded: 2, confirmed: 3 }
  const cards = render({ data, isLoading: false })
  assert.deepEqual(cards.map(({ label, value }) => ({ label, value })), [
    { label: 'Úspešnosť vlastného podania', value: '75%' },
    { label: 'Úspešnosť súperovho podania', value: '40%' },
    { label: 'Vyhraté body z podania', value: '9' },
    { label: 'Vyhraté body zo súperovho podania', value: '4' },
  ])
  assert.ok(cards.every(card => !card.html.includes('Zaznamenané zápasy') && !card.html.includes('2/3')))
  assert.ok(cards.every(card => !card.html.includes('9/12') && !card.html.includes('4/10')))
  const english = render({ data }, 'en')
  assert.equal(english[2].label, 'Points won on own serve')
  assert.equal(english[3].label, 'Points won on opponents’ serve')
  assert.ok(english.every(card => !card.html.includes('Recorded matches') && !card.html.includes('role="status"')))
})

test('zero counts are distinct from unavailable rates, and loading/errors remain visible', () => {
  const data = { serve: pointSuccess(0, 0), receive: pointSuccess(0, 0), recorded: 0, confirmed: 1 }
  assert.deepEqual(render({ data }).map(card => card.value), ['—', '—', '0', '0'])
  const loading = render({ data, isLoading: true })
  assert.ok(loading.every(card => card.value === '—' && card.html.includes('Načítavam')))
  const failed = render({ data, error: new Error('RPC unavailable') })
  assert.ok(failed.every(card => card.value === '—' && card.html.includes('role="alert"') && card.html.includes('Skúsiť znova')))
})
