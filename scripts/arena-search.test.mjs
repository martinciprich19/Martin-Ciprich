import assert from 'node:assert/strict'
import test from 'node:test'
import { filterArenas } from '../lib/arena-search.ts'

const arenas = [
  { name: 'RIVA Padel', city: 'Žilina', address: 'Športová 1' },
  { name: 'Padel Centrum', city: 'Bratislava', address: 'Dlhá 2' },
]
test('arena search lists all arenas and matches names, cities and addresses without accents', () => {
  assert.deepEqual(filterArenas(arenas, ''), arenas)
  assert.deepEqual(filterArenas(arenas, '  ZILIN  '), [arenas[0]])
  assert.deepEqual(filterArenas(arenas, 'riva zilina'), [arenas[0]])
  assert.deepEqual(filterArenas(arenas, 'sportova'), [arenas[0]])
  assert.deepEqual(filterArenas(arenas, 'CENTRUM'), [arenas[1]])
  assert.deepEqual(filterArenas(arenas, 'nenajdene'), [])
  assert.deepEqual(filterArenas(arenas, 'riva bratislava'), [])
})
