import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import * as jsxRuntime from 'react/jsx-runtime'
import { createElement, useRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

async function load(path, imports, tsx = false) {
  await loadBindings()
  const { code } = await transform(await readFile(new URL(path, import.meta.url), 'utf8'), {
    filename: path, jsc: { parser: { syntax: 'typescript', tsx }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  })
  const exports = {}
  vm.runInNewContext(code, { exports, console, require: (name) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`)
    return imports[name]
  } })
  return exports
}

test('detail fetch selects the challenge and its exact arena and propagates errors', async () => {
  const calls = []
  let arenaError = null
  const client = {
    from(table) {
      const query = {
        select(columns) { calls.push([table, 'select', columns]); return query },
        eq(column, value) { calls.push([table, column, value]); return query },
        async single() { return { data: { id: 'challenge-1', arena_id: 23 }, error: null } },
        async maybeSingle() { return { data: { name: 'RIVA', city: 'Žilina', address: 'Ulica 1' }, error: arenaError } },
      }
      return query
    },
  }
  const { fetchChallengeDetails } = await load('../lib/pair-challenges.ts', { '@/lib/supabase/client': { createClient: () => client } })
  const result = await fetchChallengeDetails('challenge-1')
  assert.equal(result.challenge.id, 'challenge-1')
  assert.equal(result.arena.name, 'RIVA')
  assert.ok(calls.some(([table, column, value]) => table === 'challenges' && column === 'id' && value === 'challenge-1'))
  assert.ok(calls.some(([table, column, value]) => table === 'arenas' && column === 'id' && value === 23))
  assert.equal(calls.some(([table]) => table === 'live_matches'), false)
  arenaError = new Error('Arena unavailable')
  await assert.rejects(fetchChallengeDetails('challenge-1'), /Arena unavailable/)
})

test('detail displays four profile links, localized date and venue, and a retryable error', async () => {
  let state = {
    data: {
      challenge: {
        challenger_1_id: '1', challenger_2_id: '2', challenged_1_id: '3', challenged_2_id: '4',
        challenger_1: { full_name: 'Alice' }, challenger_2: [{ full_name: 'Bob' }],
        challenged_1: { full_name: 'Carol' }, challenged_2: { full_name: 'Dan' },
        match_date: '2026-11-27T10:00:00Z',
      },
      arena: { name: 'RIVA', city: 'Žilina', address: 'Ulica 1' },
    },
    isLoading: false, error: null, mutate() {},
  }
  const { ChallengeDetailModal } = await load('../components/challenge-detail-modal.tsx', {
    'react/jsx-runtime': jsxRuntime,
    react: { useRef, useEffect() {} },
    'next/link': ({ href, children, ...props }) => createElement('a', { href, ...props }, children),
    swr: () => state,
    'lucide-react': { X: () => null },
    '@/components/language-provider': { useLanguage: () => ({ language: 'en', t: (sk, en) => en ?? sk }) },
    '@/lib/errors': { getErrorMessage: (error) => error.message },
    '@/lib/pair-challenges': { fetchChallengeDetails() {} },
    '@/components/challenge-pin': { ChallengePin: () => null },
  }, true)
  const render = () => renderToStaticMarkup(createElement(ChallengeDetailModal, { challengeId: 'challenge-1', onClose() {} }))
  const html = render()
  for (const [id, name] of [['1', 'Alice'], ['2', 'Bob'], ['3', 'Carol'], ['4', 'Dan']]) {
    assert.match(html, new RegExp(`href="/players/${id}"[^>]*>${name}</a>`))
  }
  assert.match(html, /27 Nov 2026/)
  assert.match(html, /RIVA · Žilina · Ulica 1/)
  state = { data: undefined, isLoading: false, error: new Error('Load failed'), mutate() {} }
  assert.match(render(), /Load failed/)
  assert.match(render(), /Try again/)
})

test('notification opens the selected challenge detail', async () => {
  const source = await readFile(new URL('../app/profile/page.tsx', import.meta.url), 'utf8')
  assert.match(source, /setDetailChallengeId\(notification\.challenge_id\)/)
  assert.match(source, /<ChallengeDetailModal challengeId=\{detailChallengeId\}/)
})

test('challenge form labels the proposed time and explains that no court is reserved', async () => {
  const source = await readFile(new URL('../components/pair-challenge-view.tsx', import.meta.url), 'utf8')
  assert.match(source, /t\('Orientačný čas zápasu'\)[\s\S]*?<input type="time" required/)
  assert.match(source, /Vytvorením výzvy sa kurt nerezervuje\. Rezerváciu si vybav priamo v aréne\./)
})
