import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

async function setup({ challenges, matches, now, challengeError = null, matchError = null }) {
  await loadBindings()
  const { code } = await transform(await readFile(new URL('../lib/pair-challenges.ts', import.meta.url), 'utf8'), {
    filename: 'pair-challenges.ts',
    jsc: { parser: { syntax: 'typescript' } },
    module: { type: 'commonjs' },
  })
  const calls = []
  class Clock extends Date {
    static now() { return now }
  }
  const client = {
    from(table) {
      const query = {
        select(value) { calls.push([table, 'select', value]); return query },
        gt(field, value) { calls.push([table, 'gt', field, value]); return query },
        or(value) { calls.push([table, 'or', value]); return query },
        order() { return query },
        in(field, values) { calls.push([table, 'in', field, values]); return query },
        then(resolve) {
          return Promise.resolve(table === 'challenges'
            ? { data: challenges, error: challengeError }
            : { data: matches, error: matchError }).then(resolve)
        },
      }
      return query
    },
  }
  const exports = {}
  vm.runInNewContext(code, {
    exports, Date: Clock,
    require(name) {
      if (name === '@/lib/supabase/client') return { createClient: () => client }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  return { fetch: exports.fetchUpcomingPairChallenges, calls }
}

test('upcoming list includes unstarted challenges for exactly 24 hours after the scheduled time', async () => {
  const date = '2026-11-27T13:45:00.000Z'
  const scheduled = Date.parse(date)
  const day = 24 * 60 * 60 * 1000
  for (const [offset, expected] of [[-1, true], [0, true], [day - 1, true], [day, false], [day + 1, false]]) {
    const { fetch, calls } = await setup({
      now: scheduled + offset, challenges: [{ id: '1', match_date: date }],
      matches: [{ challenge_id: '1', match_pin: '0042', is_pin_activated: false }],
    })
    const result = await fetch('1')
    assert.equal(result.length, Number(expected), `offset ${offset}`)
    if (expected) assert.equal(result[0].match_pin, '0042')
    assert.equal(calls.find(([table, op]) => table === 'challenges' && op === 'gt')[3],
      new Date(scheduled + offset - day).toISOString())
    assert.match(calls.find(([table, op]) => table === 'challenges' && op === 'or')[2], /challenged_2_id\.eq\.1/)
  }
})

test('started, completed and ended matches disappear while unstarted or missing matches remain', async () => {
  const now = Date.parse('2026-11-27T13:45:00Z')
  const challenges = Array.from({ length: 8 }, (_, index) => ({ id: String(index + 1), match_date: '2026-11-27T14:45:00Z' }))
  const matches = [
    { challenge_id: '1', is_pin_activated: true },
    { challenge_id: '2', started_at: '2026-11-27T13:00:00Z' },
    { challenge_id: '3', finished_at: '2026-11-27T13:00:00Z' },
    { challenge_id: '4', ended_early_at: '2026-11-27T13:00:00Z' },
    { challenge_id: '5', result_finalized_at: '2026-11-27T13:00:00Z' },
    { challenge_id: '6', official_result_id: 'result' },
    { challenge_id: '7', is_pin_activated: false, match_pin: '0123' },
  ]
  const { fetch } = await setup({ now, challenges, matches })
  const result = await fetch('4')
  assert.deepEqual(Array.from(result, (match) => match.id), ['7', '8'])
  assert.equal(result[0].match_pin, '0123')
  assert.equal(result[1].match_pin, null)
})

test('loading errors and invalid dates are surfaced', async () => {
  const now = Date.now()
  const challengeError = new Error('Challenge query failed')
  await assert.rejects((await setup({ now, challenges: [], matches: [], challengeError })).fetch('1'), /Challenge query failed/)
  const matchError = new Error('Match query failed')
  await assert.rejects((await setup({ now, challenges: [{ id: '1', match_date: new Date(now).toISOString() }], matches: [], matchError })).fetch('1'), /Match query failed/)
  await assert.rejects((await setup({ now, challenges: [{ id: '1', match_date: 'invalid' }], matches: [] })).fetch('1'), /neplatný termín/)
})
