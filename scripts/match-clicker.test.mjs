import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const source = stripTypeScriptTypes(await readFile(new URL('../lib/match-clicker.ts', import.meta.url), 'utf8'))
  .replace('export function', 'function')

class Element {
  constructor(selector = '', editable = false) {
    this.selector = selector
    this.isContentEditable = editable
  }
  closest(selectors) {
    return selectors.split(',').some(selector => this.matches(selector.trim())) ? this : null
  }
  matches(selector) {
    return selector === this.selector
      || (selector === 'input' && this.selector.startsWith('input['))
  }
}

function setup() {
  let now = 0
  let enabled = true
  let helperMode = false
  let busy = false
  let timerId = 0
  const timers = new Map()
  const calls = []
  const logs = []
  const diagnostics = []
  const document = { visibilityState: 'visible' }
  const factory = vm.runInNewContext(`${source}\ncreateMatchClickerHandler`, {
    HTMLElement: Element, document, performance: { now: () => now },
    console: { log: (...args) => logs.push(args) },
    setTimeout: (callback, delay) => {
      const id = ++timerId
      timers.set(id, { callback, at: now + delay })
      return id
    },
    clearTimeout: id => timers.delete(id),
  })
  const handler = factory({
    isEnabled: () => enabled,
    isHelperMode: () => helperMode,
    isBusy: () => busy,
    onDiagnostic: (key, code, status) => diagnostics.push({ key, code, status }),
    onTeamAPoint: () => calls.push('A'),
    onTeamBPoint: () => calls.push('B'),
    onTeamUndo: team => calls.push(`undo-${team}`),
    onUndo: () => calls.push('undo'),
    onReset: () => calls.push('reset'),
  })
  return {
    calls, logs, diagnostics, document,
    advance: ms => {
      const end = now + ms
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = next[1].at
        timers.delete(next[0])
        next[1].callback()
      }
      now = end
    },
    busy: value => { busy = value },
    cancel: () => handler.cancelPending(),
    enable: value => { enabled = value },
    helper: value => { helperMode = value },
    press(key, overrides = {}) {
      const event = {
        key, code: '', target: new Element(), defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true },
        ...overrides,
      }
      handler(event)
      return event
    },
  }
}

test('all shutter/media mappings and existing shortcuts select the correct action', () => {
  const env = setup()
  for (const key of ['VolumeUp', 'AudioVolumeUp', ' ', 'Space', 'a', 'A']) {
    assert.equal(env.press(key).defaultPrevented, true)
    env.advance(350)
    assert.equal(env.calls.at(-1), 'A')
    env.advance(400)
  }
  for (const key of ['VolumeDown', 'AudioVolumeDown', 'MediaPlayPause', 'Enter', 'l', 'L']) {
    assert.equal(env.press(key).defaultPrevented, true)
    env.advance(350)
    assert.equal(env.calls.at(-1), 'B')
    env.advance(400)
  }
  env.press('Unidentified', { code: 'Space' })
  env.advance(350)
  assert.equal(env.calls.at(-1), 'A')
  env.press('z')
  env.press('m')
  assert.deepEqual(env.calls.slice(-2), ['undo', 'reset'])
  assert.deepEqual(env.logs[0], ['Stlačený kláves:', 'VolumeUp', ''])
})

test('A/L retain the 400 ms immediate guard across teams and disabled intervals', () => {
  const env = setup()
  env.press('a')
  env.advance(399)
  assert.equal(env.press('l').defaultPrevented, true)
  assert.deepEqual(env.calls, ['A'])
  env.advance(1)
  env.press('l')
  assert.deepEqual(env.calls, ['A', 'B'])
  env.enable(false)
  env.advance(100)
  env.press('a')
  env.enable(true)
  env.press('a')
  assert.deepEqual(env.calls, ['A', 'B'])
  env.advance(300)
  env.press('a')
  assert.deepEqual(env.calls, ['A', 'B', 'A'])
})

test('held keys are suppressed without scrolling or consuming the next legitimate press', () => {
  const env = setup()
  assert.equal(env.press(' ', { repeat: true }).defaultPrevented, true)
  env.press(' ')
  env.advance(350)
  assert.deepEqual(env.calls, ['A'])
  env.advance(1000)
  assert.equal(env.press('MediaPlayPause', { repeat: true }).defaultPrevented, true)
  env.press('MediaPlayPause')
  env.advance(350)
  assert.deepEqual(env.calls, ['A', 'B'])
})

test('inactive matches, hidden pages, editors, dialogs and modified keys do not score', () => {
  for (const target of [
    new Element('input'), new Element('textarea'), new Element('select'),
    new Element('[role="textbox"]'), new Element('[role="dialog"]'), new Element('', true),
  ]) {
    const env = setup()
    env.press('VolumeUp', { target })
    env.advance(350)
    assert.deepEqual(env.calls, [])
  }
  for (const override of [
    { altKey: true }, { ctrlKey: true }, { metaKey: true },
    { isComposing: true }, { defaultPrevented: true },
  ]) {
    const env = setup()
    env.press('VolumeUp', override)
    env.advance(350)
    assert.deepEqual(env.calls, [])
  }
  const env = setup()
  env.enable(false)
  env.press('VolumeUp')
  env.enable(true)
  env.document.visibilityState = 'hidden'
  env.press('VolumeDown')
  env.document.visibilityState = 'visible'
  assert.equal(env.press('ArrowDown').defaultPrevented, false)
  env.advance(350)
  assert.deepEqual(env.calls, [])
})

test('focused controls keep Enter/Space activation but do not block media keys or A/L', () => {
  for (const selector of ['button', 'a', '[role="button"]', 'summary']) {
    const env = setup()
    const target = new Element(selector)
    for (const key of ['Enter', ' ', 'Space']) {
      assert.equal(env.press(key, { target }).defaultPrevented, false)
    }
    assert.deepEqual(env.calls, [])
    assert.equal(env.press('AudioVolumeDown', { target }).defaultPrevented, true)
    env.advance(400)
    env.press('a', { target })
    assert.deepEqual(env.calls, ['B', 'A'])
  }
})

test('Windows helper mode uses F13/F14 and ignores original shutter signals without consuming debounce', () => {
  const env = setup()
  env.press('F13')
  env.press('F14')
  assert.deepEqual(env.calls, [])
  env.helper(true)
  for (const key of ['VolumeUp', 'AudioVolumeUp', 'VolumeDown', 'AudioVolumeDown', 'MediaPlayPause', 'Enter', ' ', 'Space']) {
    assert.equal(env.press(key).defaultPrevented, true)
  }
  assert.deepEqual(env.calls, [])
  assert.equal(env.press('F13').defaultPrevented, true)
  assert.deepEqual(env.calls, [])
  env.advance(350)
  assert.deepEqual(env.calls, ['A'])
  env.press('F14')
  assert.deepEqual(env.calls, ['A'])
  env.advance(350)
  assert.deepEqual(env.calls, ['A', 'B'])
  env.advance(400)
  env.press('F13', { repeat: true })
  assert.deepEqual(env.calls, ['A', 'B'])
  env.enable(false)
  env.press('F13')
  assert.deepEqual(env.calls, ['A', 'B'])
  env.helper(false)
  env.enable(true)
  env.press('VolumeUp')
  env.advance(350)
  assert.deepEqual(env.calls, ['A', 'B', 'A'])
})

test('helper diagnostics distinguish received media, focus blocks, disabled scoring and forwarded points', () => {
  const env = setup()
  env.helper(true)
  env.press('AudioVolumeUp')
  assert.equal(env.diagnostics.at(-1).status, 'media-ignored')
  env.press('F13', { target: new Element('input') })
  assert.equal(env.diagnostics.at(-1).status, 'context')
  env.enable(false)
  env.press('F14')
  assert.equal(env.diagnostics.at(-1).status, 'disabled')
  env.enable(true)
  env.press('F14')
  assert.equal(env.diagnostics.at(-1).status, 'waiting')
  env.press('F14')
  assert.equal(env.diagnostics.at(-1).status, 'debounce')
  env.advance(350)
  assert.deepEqual(env.calls, ['B'])
  assert.equal(env.diagnostics.filter(item => item.status === 'received').length, 5)
})

test('helper toggle focus allows F13/F14 without enabling shortcuts in other inputs or dialogs', () => {
  const env = setup()
  env.helper(true)
  const target = new Element('input[type="checkbox"][data-match-clicker-helper]')
  env.press('F13', { target })
  assert.equal(env.diagnostics.at(-1).status, 'waiting')
  env.advance(350)
  assert.equal(env.diagnostics.at(-1).status, 'accepted')
  env.advance(400)
  env.press('F14', { target })
  env.advance(350)
  assert.deepEqual(env.calls, ['A', 'B'])
  env.advance(400)
  for (const key of ['a', 'l', 'Enter', ' ', 'AudioVolumeUp']) {
    env.press(key, { target })
  }
  for (const selector of ['input', 'input[type="checkbox"]', 'textarea', '[role="dialog"]']) {
    env.press('F13', { target: new Element(selector) })
    assert.equal(env.diagnostics.at(-1).status, 'context')
  }
  const inDialog = new Element('input[type="checkbox"][data-match-clicker-helper]')
  const closest = inDialog.closest.bind(inDialog)
  inDialog.closest = selectors => selectors.includes('[role="dialog"]') ? new Element('[role="dialog"]') : closest(selectors)
  env.press('F14', { target: inDialog })
  assert.equal(env.diagnostics.at(-1).status, 'context')
  assert.deepEqual(env.calls, ['A', 'B'])
})

test('one click waits exactly 350 ms; a released double-click removes only that team point', () => {
  for (const [key, team] of [['F13', 'TEAM_A'], ['F14', 'TEAM_B'], ['AudioVolumeUp', 'TEAM_A'], ['Enter', 'TEAM_B']]) {
    const env = setup()
    env.helper(key.startsWith('F'))
    env.press(key)
    env.advance(349)
    assert.deepEqual(env.calls, [])
    env.press(key)
    assert.deepEqual(env.calls, [`undo-${team}`])
    env.advance(1000)
    assert.deepEqual(env.calls, [`undo-${team}`], 'neither press may add a temporary point')
  }
  const env = setup()
  env.helper(true)
  env.press('F13')
  env.advance(349)
  assert.deepEqual(env.calls, [])
  env.advance(1)
  assert.deepEqual(env.calls, ['A'])
  env.press('F13')
  env.advance(350)
  assert.deepEqual(env.calls, ['A', 'A'], 'a new click at the boundary starts a separate single click')
})

test('clickers track double-clicks independently and ignore repeats, bounce and original media', () => {
  const env = setup()
  env.helper(true)
  env.press('F13')
  env.press('F14')
  env.advance(59)
  env.press('F13')
  env.press('F14', { repeat: true })
  env.press('AudioVolumeUp')
  env.advance(41)
  env.press('F13')
  assert.deepEqual(env.calls, ['undo-TEAM_A'])
  env.advance(250)
  assert.deepEqual(env.calls, ['undo-TEAM_A', 'B'])
  env.press('F14')
  env.advance(100)
  env.press('F14')
  env.advance(350)
  assert.deepEqual(env.calls, ['undo-TEAM_A', 'B', 'undo-TEAM_B'])
})

test('queued clicker actions wait for saves, retain order and cancel on lost context or unmount', () => {
  const env = setup()
  env.helper(true)
  env.busy(true)
  env.press('F13')
  env.press('F14')
  env.advance(500)
  assert.deepEqual(env.calls, [])
  env.busy(false)
  env.advance(50)
  assert.deepEqual(env.calls, ['A'])
  env.busy(true)
  env.advance(100)
  assert.deepEqual(env.calls, ['A'])
  env.busy(false)
  env.advance(50)
  assert.deepEqual(env.calls, ['A', 'B'])
  for (const reason of ['disabled', 'hidden', 'cancel']) {
    const cancelled = setup()
    cancelled.helper(true)
    cancelled.press('F13')
    if (reason === 'disabled') cancelled.enable(false)
    else if (reason === 'hidden') cancelled.document.visibilityState = 'hidden'
    else cancelled.cancel()
    cancelled.advance(1000)
    assert.deepEqual(cancelled.calls, [])
  }
  const queued = setup()
  queued.helper(true)
  queued.busy(true)
  queued.press('F14')
  queued.advance(350)
  queued.cancel()
  queued.busy(false)
  queued.advance(1000)
  assert.deepEqual(queued.calls, [])
})
