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
test('QR arena fetcher uses the selected country, not the SWR key or all countries', async () => {
  const source = readFileSync(new URL('../components/riva-qr-scanner.tsx', import.meta.url), 'utf8')
  assert.match(source, /useLeague\(\)/)
  const fetcher = source.match(/useSWR\(leagueLoading \? null : \['arenas', country\], (\(\[, selectedCountry\]\) => fetchArenas\(selectedCountry\))\)/)?.[1]
  assert.ok(fetcher)
  const directory = [{ name: 'Žilina', country_code: 'SK' }, { name: 'Lelystad', country_code: 'NL' }]
  const calls = []
  const callback = vm.runInNewContext(fetcher, {
    fetchArenas: (country) => {
      calls.push(country)
      return directory.filter(arena => arena.country_code === country)
    },
  })
  for (const country of ['SK', 'NL', 'SK']) {
    const result = await callback(['arenas', country])
    assert.deepEqual(result, directory.filter(arena => arena.country_code === country))
  }
  assert.deepEqual(calls, ['SK', 'NL', 'SK'])
  const parent = readFileSync(new URL('../components/match-start-view.tsx', import.meta.url), 'utf8')
  assert.match(parent, /<RivaQrScanner key=\{country\}/)
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
