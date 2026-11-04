import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

const source = stripTypeScriptTypes(await readFile(new URL('../lib/arenas.ts', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '')
  .replace(/\bexport /g, '')

function arenaClient(rows, error = null) {
  const filters = []
  return {
    from(table) {
      assert.equal(table, 'arenas')
      return {
        select() { return this },
        eq(column, value) { filters.push([column, value]); return this },
        async order(column, options) {
          assert.equal(column, 'name')
          assert.equal(options.ascending, true)
          return {
            data: error ? null : rows
              .filter((row) => filters.every(([key, value]) => row[key] === value))
              .sort((a, b) => a.name.localeCompare(b.name)),
            error,
          }
        },
      }
    },
  }
}

const rows = [
  { id: 1, name: 'Active SK', is_active: true, country_code: 'SK', courts_count: 3 },
  { id: 2, name: 'Paused SK', is_active: false, country_code: 'SK', courts_count: 2 },
  { id: 3, name: 'Active NL', is_active: true, country_code: 'NL', courts_count: 4 },
  { id: 4, name: 'Unknown status', is_active: null, country_code: 'SK', courts_count: 1 },
]

test('player arena lists exclude paused arenas even when database permissions return all arenas', async () => {
  const fetchArenas = new Function('createClient', `${source}; return fetchArenas`)(() => arenaClient(rows))
  const all = await fetchArenas()
  assert.deepEqual(all.map((arena) => arena.id), ['3', '1'])
  const sk = await fetchArenas('SK')
  assert.deepEqual(sk.map((arena) => arena.id), ['1'])
  assert.equal(sk[0].courtsCount, 3)
  assert.deepEqual((await fetchArenas('NL')).map((arena) => arena.id), ['3'])
})

test('pausing and reactivating an arena changes the next player query without affecting other arenas', async () => {
  const mutableRows = rows.map((row) => ({ ...row }))
  const fetchArenas = new Function('createClient', `${source}; return fetchArenas`)(() => arenaClient(mutableRows))
  assert.equal((await fetchArenas('SK')).length, 1)
  mutableRows[0].is_active = false
  assert.deepEqual(await fetchArenas('SK'), [])
  assert.equal((await fetchArenas('NL')).length, 1)
  mutableRows[0].is_active = true
  assert.deepEqual((await fetchArenas('SK')).map((arena) => arena.id), ['1'])
})

test('arena query failures are propagated rather than returned as an empty successful list', async () => {
  const error = new Error('Database unavailable')
  const fetchArenas = new Function('createClient', `${source}; return fetchArenas`)(() => arenaClient([], error))
  await assert.rejects(fetchArenas('SK'), (reason) => reason === error)
})
