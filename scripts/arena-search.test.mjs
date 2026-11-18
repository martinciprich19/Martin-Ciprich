import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { filterArenas } from '../lib/arena-search.ts'

const arenas = [
  { name: 'RIVA Padel', city: 'Žilina', address: 'Športová 1' },
  { name: 'Padel Centrum', city: 'Bratislava', address: 'Dlhá 2' },
]
test('match detail fetches all arenas without passing the SWR key as a country', async () => {
  for (const component of ['match-detail-modal']) {
    const source = readFileSync(new URL(`../components/${component}.tsx`, import.meta.url), 'utf8')
    const fetcher = source.match(/useSWR\('arenas', (\(\) => fetchArenas\(\))\)/)?.[1]
    assert.ok(fetcher, `${component} must wrap the optional-country fetcher`)
    const calls = []
    const callback = vm.runInNewContext(fetcher, {
      fetchArenas: (...args) => { calls.push(args); return arenas },
    })
    assert.deepEqual(await callback('arenas'), arenas)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].length, 0)
  }
})
test('QR arena fetcher loads active arenas across countries without passing the SWR key', async () => {
  const source = readFileSync(new URL('../components/riva-qr-scanner.tsx', import.meta.url), 'utf8')
  assert.match(source, /useLeague\(\)/)
  const fetcher = source.match(/useSWR\(leagueLoading \? null : \['arenas', 'all'\], (\(\) => fetchArenas\(\))\)/)?.[1]
  assert.ok(fetcher)
  const directory = [{ name: 'Žilina', country_code: 'SK' }, { name: 'Lelystad', country_code: 'NL' }]
  const calls = []
  const callback = vm.runInNewContext(fetcher, {
    fetchArenas: (...args) => {
      calls.push(args)
      return directory
    },
  })
  assert.deepEqual(await callback(), directory)
  assert.deepEqual(calls, [[]])
  const parent = readFileSync(new URL('../components/match-start-view.tsx', import.meta.url), 'utf8')
  assert.match(parent, /<RivaQrScanner key=\{country\}/)
})
test('QR match setup requires selecting any active arena regardless of league', () => {
  const source = readFileSync(new URL('../components/riva-qr-scanner.tsx', import.meta.url), 'utf8')
  assert.match(source, /<select id="qr-match-arena" required value=\{selectedArenaId\}/)
  assert.match(source, /arenas\.map\(\(item\) => <option key=\{item\.id\} value=\{item\.id\}\>/)
  assert.match(source, /const selectedArena = arenas\.find\(\(item\) => item\.id === selectedArenaId\)/)
  assert.match(source, /arenaRef\.current = selectedArena\.name/)
  assert.match(source, /arenas\.length === 0 \|\| !selectedArenaId/)
  assert.match(source, /Vyber aktívnu arénu/)
  assert.match(source, /Select any active arena/)
  assert.doesNotMatch(source, /Vyber zo zoznamu alebo zadaj vlastnú arénu/)
})
test('arena search lists all arenas and matches names, cities and addresses without accents', () => {
  assert.deepEqual(filterArenas(arenas, ''), arenas)
  assert.deepEqual(filterArenas(arenas, '  ZILIN  '), [arenas[0]])
  assert.deepEqual(filterArenas(arenas, 'riva zilina'), [arenas[0]])
  assert.deepEqual(filterArenas(arenas, 'sportova'), [arenas[0]])
  assert.deepEqual(filterArenas(arenas, 'CENTRUM'), [arenas[1]])
  assert.deepEqual(filterArenas(arenas, 'nenajdene'), [])
  assert.deepEqual(filterArenas(arenas, 'riva bratislava'), [])
})
