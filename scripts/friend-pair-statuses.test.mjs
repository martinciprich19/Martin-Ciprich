import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/pairs.ts', import.meta.url), 'utf8')
const view = readFileSync(new URL('../components/friends-view.tsx', import.meta.url), 'utf8')
const functionText = source.slice(source.indexOf('export async function fetchFriendPairStatuses'), source.indexOf('export async function sendPairInvitation'))
const executable = stripTypeScriptTypes(functionText).replace('export async function', 'async function')

function fixture(tables, errors = {}) {
  const calls = []
  const client = {
    from(table) {
      const query = {
        select() { return query },
        eq(...args) { calls.push([table, 'eq', ...args]); return query },
        or(value) { calls.push([table, 'or', value]); return query },
        order(value) { calls.push([table, 'order', value]); return query },
        async range(start, end) {
          calls.push([table, 'range', start, end])
          return { data: (tables[table] ?? []).slice(start, end + 1), error: errors[table] ?? null }
        },
      }
      return query
    },
  }
  const context = { createClient: () => client, PAIR_INVITATIONS_SCHEMA_CODES: new Set(['42P01']), PAIR_INVITATIONS_SCHEMA_MESSAGE: 'missing schema' }
  return { run: (id) => vm.runInNewContext(`${executable}; fetchFriendPairStatuses(${id})`, context), calls }
}

test('statuses reflect both directions, give existing pairs precedence, and load all pages', async () => {
  const many = Array.from({ length: 501 }, (_, i) => ({ player_1_id: 1, player_2_id: i + 10 }))
  const { run, calls } = fixture({
    pair_invitations: [{ inviter_id: 1, invitee_id: 2 }, { inviter_id: 3, invitee_id: 1 }, { inviter_id: 1, invitee_id: 10 }],
    pairs: [...many, { player_1_id: 4, player_2_id: 1 }],
  })
  const result = await run(1)
  assert.equal(result['2'], 'invited')
  assert.equal(result['3'], 'incoming')
  assert.equal(result['4'], 'paired')
  assert.equal(result['10'], 'paired')
  assert.equal(result['510'], 'paired')
  assert.ok(calls.some((call) => call.join(':') === 'pairs:range:500:999'))
  assert.ok(calls.some((call) => call.join(':') === 'pair_invitations:eq:status:pending'))
})

test('failure to load either status source is surfaced and invalid profile rejected', async () => {
  for (const table of ['pairs', 'pair_invitations']) {
    const { run } = fixture({}, { [table]: { code: 'other', message: 'failed' } })
    await assert.rejects(run(1), (error) => error.message === 'failed')
  }
  await assert.rejects(fixture({}).run(0), /Neplatné ID/)
})

test('friends invitation uses existing RPC and disables duplicates or pending invitations', () => {
  assert.match(view, /await sendPairInvitation\(friend\.id\)/)
  assert.match(view, /pairStatuses\.data\?\.\[friend\.id\] === 'paired'/)
  assert.match(view, /pairStatuses\.data\?\.\[friend\.id\] === 'invited'/)
  assert.match(view, /pairStatuses\.data\?\.\[friend\.id\] === 'incoming'/)
  assert.match(view, /pairStatuses\.data && !pairStatuses\.error/)
  assert.match(view, /disabled=\{invitingId !== null\}/)
  assert.match(view, /Dvojica vznikne po jej prijatí/)
  assert.match(source, /rpc\('create_pair_invitation'/)
})
