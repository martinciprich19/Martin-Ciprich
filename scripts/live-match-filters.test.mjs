import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { arenasForRegion, matchInRegion } from '../lib/live-match-filters.ts'
import { matchHasPlayerName } from '../lib/match-players.ts'

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

test('player search matches any of the four player names as the user types', () => {
  const match = {
    team_a_player1_name: 'Martin Ciprich',
    team_a_player2_name: 'Patrik Lukuvka',
    team_b_player1_name: 'Lukáš Hruštinec',
    team_b_player2_name: 'The kong',
  }
  for (const search of ['', '  ', 'mart', 'CIPRICH', 'luku', 'hrust', 'KONG', '  lukáš hruš  ']) {
    assert.equal(matchHasPlayerName(match, search), true, search)
  }
  for (const search of ['unknown', 'ciprich patrik', 'flevopadel']) {
    assert.equal(matchHasPlayerName(match, search), false, search)
  }
  assert.equal(matchHasPlayerName({ ...match, team_a_player1_name: null }, 'martin'), false)
})

test('player search combines with region and arena filters', () => {
  const players = { team_a_player1_name: 'Martin Ciprich', team_a_player2_name: 'Patrik', team_b_player1_name: 'Lukáš', team_b_player2_name: 'Peter' }
  const matches = [
    { ...players, arena_id: 1, region: null },
    { ...players, arena_id: 2, region: null },
    { ...players, team_a_player1_name: 'Jana', arena_id: 1, region: null },
  ]
  const filter = (query, selectedArena) => matches.filter((match) =>
    matchInRegion(match, arenas, 'Bratislavský kraj', 'SK-BL') &&
    String(match.arena_id) === selectedArena &&
    matchHasPlayerName(match, query))
  assert.equal(filter('cip', '1').length, 1)
  assert.equal(filter('cip', '2').length, 0)
  assert.equal(filter('jana', '1').length, 1)
  assert.equal(filter('', '1').length, 2)
})

test('live directory loads active arenas for the selected country independently of matches', async () => {
  const view = await readFile(new URL('../components/live-matches-view.tsx', import.meta.url), 'utf8')
  const source = await readFile(new URL('../lib/arenas.ts', import.meta.url), 'utf8')
  assert.match(view, /fetchArenas\(country\)/)
  assert.match(view, /arenasForRegion\(allArenas, region, subdivision\)/)
  assert.match(view, /String\(match\.arena_id\) === selectedArena/)
  assert.match(view, /matchHasPlayerName\(match, playerSearch\)/)
  assert.match(view, /type="search" value=\{playerSearch\} onChange=\{\(event\) => setPlayerSearch\(event\.target\.value\)\}/)
  assert.match(view, /visibleMatches\.length/)
  assert.match(view, /<Link href="\/profile\?view=overview"[\s\S]*?t\('Späť na prehľad', 'Back to overview'\)/)
  assert.match(view, /setSelectedArena\(ALL_ARENAS\)/)
  assert.match(source, /\.eq\('is_active', true\)/)
  assert.match(source, /\.eq\('country_code', country\)/)
})
