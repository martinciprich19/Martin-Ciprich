import assert from 'node:assert/strict'
import test from 'node:test'
import { connectFullyClicker, FULLY_CLICKER_EVENT, getFullyBroadcastApi, getFullyClickerActions } from '../lib/fully-clicker.ts'

const code = 'a'.repeat(32)
function fixture() {
  const target = new EventTarget()
  const registrations = new Set()
  const presses = []
  const bindings = []
  const api = {
    bind: (...args) => bindings.push(args),
    registerBroadcastReceiver: (action) => registrations.add(action),
    unregisterBroadcastReceiver: (action) => registrations.delete(action),
  }
  const emit = (detail) => target.dispatchEvent(new CustomEvent(FULLY_CLICKER_EVENT, { detail }))
  return { target, registrations, presses, bindings, api, emit }
}

test('pairing code is strictly validated and incomplete Fully APIs are rejected', () => {
  for (const value of ['', 'a'.repeat(31), 'x'.repeat(32), 'a'.repeat(33), '";alert(1)//']) {
    assert.throws(() => getFullyClickerActions(value), /32/)
  }
  assert.equal(getFullyBroadcastApi(null), null)
  assert.equal(getFullyBroadcastApi({ bind() {} }), null)
  const { api } = fixture()
  assert.equal(getFullyBroadcastApi(api), api)
})

test('Fully broadcasts route only paired team actions and disconnect cleanly', () => {
  const h = fixture()
  const disconnect = connectFullyClicker(h.api, code, key => h.presses.push(key), h.target)
  const actions = getFullyClickerActions(code)
  assert.deepEqual([...h.registrations], actions)
  assert.equal(h.bindings[0][0], 'broadcastReceived')
  assert.ok(!h.bindings[0][1].includes('$extras'))
  h.emit(actions[0])
  h.emit(actions[1])
  h.emit(getFullyClickerActions('b'.repeat(32))[0])
  h.emit({ team: 'TEAM_A' })
  h.target.dispatchEvent(new Event(FULLY_CLICKER_EVENT))
  assert.deepEqual(h.presses, ['F13', 'F14'])
  disconnect()
  assert.equal(h.registrations.size, 0)
  h.emit(actions[0])
  assert.equal(h.presses.length, 2)
})

test('failed registration cleans partial registrations and does not leave a scoring listener', () => {
  const h = fixture()
  let attempts = 0
  const register = h.api.registerBroadcastReceiver
  h.api.registerBroadcastReceiver = action => {
    if (++attempts === 2) throw new Error('registration failed')
    register(action)
  }
  assert.throws(() => connectFullyClicker(h.api, code, key => h.presses.push(key), h.target), /registration failed/)
  assert.equal(h.registrations.size, 0)
  h.emit(getFullyClickerActions(code)[0])
  assert.deepEqual(h.presses, [])
})

test('disconnect removes all registrations even when one cleanup fails', () => {
  const h = fixture()
  const disconnect = connectFullyClicker(h.api, code, key => h.presses.push(key), h.target)
  const removed = []
  h.api.unregisterBroadcastReceiver = action => {
    removed.push(action)
    if (removed.length === 1) throw new Error('cleanup failed')
  }
  assert.throws(disconnect, AggregateError)
  assert.equal(removed.length, 2)
  h.emit(getFullyClickerActions(code)[0])
  assert.deepEqual(h.presses, [])
})
