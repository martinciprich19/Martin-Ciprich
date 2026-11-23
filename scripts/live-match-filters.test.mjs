import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { arenasForRegion, matchInRegion } from '../lib/live-match-filters.ts'

const arenas = [
  { id: '1', name: 'Arena A', country_code: 'SK', subdivision_code: 'SK-BL', region: 'Bratislavský kraj' },
  { id: '2', name: 'Arena B', country_code: 'SK', subdivision_code: 'SK-ZI', region: 'Žilinský kraj' },
  { id: '3', name: 'Legacy arena', country_code: 'SK', subdivision_code: null, region: 'Bratislavský kraj' },
  { id: '4', name: 'Unclassified', country_code: 'SK', subdivision_code: null, region: null },
]

test('arena filter includes active directory arenas even without live matches', () => {
  assert.deepEqual(arenasForRegion(arenas, null, null).map((arena) => arena.id), ['1', '2', '3', '4'])
  assert.deepEqual(arenasForRegion(arenas, 'Bratislavský kraj', 'SK-BL').map((arena) => arena.id), ['1', '3'])
  assert.deepEqual(arenasForRegion(arenas, 'Žilinský kraj', 'SK-ZI').map((arena) => arena.id), ['2'])
  assert.deepEqual(arenasForRegion(arenas, 'Trnavský kraj', 'SK-TA'), [])
})

test('region filter uses the arena classification and preserves unmatched match regions', () => {
  assert.equal(matchInRegion({ arena_id: 1, region: null }, arenas, 'Bratislavský kraj', 'SK-BL'), true)
  assert.equal(matchInRegion({ arena_id: 2, region: 'Bratislavský kraj' }, arenas, 'Bratislavský kraj', 'SK-BL'), false)
  assert.equal(matchInRegion({ arena_id: null, region: 'Bratislavský kraj' }, arenas, 'Bratislavský kraj', 'SK-BL'), true)
  assert.equal(matchInRegion({ arena_id: null, region: null }, arenas, 'Bratislavský kraj', 'SK-BL'), false)
  assert.equal(matchInRegion({ arena_id: null, region: null }, arenas, null, null), true)
})

test('live directory loads active arenas for the selected country independently of matches', async () => {
  const view = await readFile(new URL('../components/live-matches-view.tsx', import.meta.url), 'utf8')
  const source = await readFile(new URL('../lib/arenas.ts', import.meta.url), 'utf8')
  assert.match(view, /fetchArenas\(country\)/)
  assert.match(view, /arenasForRegion\(allArenas, region, subdivision\)/)
  assert.match(view, /String\(match\.arena_id\) === selectedArena/)
  assert.match(view, /setSelectedArena\(ALL_ARENAS\)/)
  assert.match(source, /\.eq\('is_active', true\)/)
  assert.match(source, /\.eq\('country_code', country\)/)
})
