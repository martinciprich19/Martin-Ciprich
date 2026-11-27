import assert from 'node:assert/strict'
import test from 'node:test'
import { assignQrPair, assignQrPlayer } from '../lib/qr-roster.ts'

test('manual assignment preserves the requested slot and QR fills the first empty slot', () => {
  const empty = [null, null, null, null]
  let roster = assignQrPlayer(empty, { id: '4', name: 'Fourth' }, 3)
  assert.equal(roster[3].id, '4')
  assert.deepEqual(empty, [null, null, null, null])
  roster = assignQrPlayer(roster, { id: '1', name: 'First' })
  roster = assignQrPlayer(roster, { id: '3', name: 'Third' }, 2)
  assert.equal(roster[1], null)
  roster = assignQrPlayer(roster, { id: '2', name: 'Second' })
  assert.deepEqual(roster.map(player => player.id), ['1', '2', '3', '4'])
  assert.throws(() => assignQrPlayer(roster, { id: '5', name: 'Fifth' }))
})

test('a pair fills one whole empty team atomically without replacing players', () => {
  const pair = [{ id: '1', name: 'One' }, { id: '2', name: 'Two' }]
  const empty = [null, null, null, null]
  const first = assignQrPair(empty, pair)
  assert.deepEqual(first.slots, [0, 1])
  assert.deepEqual(first.roster.map((p) => p?.id ?? null), ['1', '2', null, null])
  assert.deepEqual(empty, [null, null, null, null])
  const second = assignQrPair([null, { id: '3', name: 'Three' }, null, null], pair)
  assert.deepEqual(second.slots, [2, 3])
  assert.throws(() => assignQrPair([{ id: '1', name: 'One' }, null, null, null], pair), /už v zápase/)
  assert.throws(() => assignQrPair([null, { id: '3', name: 'Three' }, null, { id: '4', name: 'Four' }], pair), /voľný celý tím/)
  assert.throws(() => assignQrPair(empty, [pair[0], pair[0]]), /už v zápase/)
})

test('duplicate and occupied slots are rejected without replacing players', () => {
  const roster = assignQrPlayer([null, null, null, null], { id: '1', name: 'One' }, 2)
  assert.throws(() => assignQrPlayer(roster, { id: '1', name: 'Duplicate' }, 0), /už v zápase/)
  assert.throws(() => assignQrPlayer(roster, { id: '2', name: 'Two' }, 2), /nie je dostupné/)
  for (const index of [-1, 4, 1.5]) assert.throws(() => assignQrPlayer(roster, { id: '2', name: 'Two' }, index))
  assert.equal(roster[2].name, 'One')
})
