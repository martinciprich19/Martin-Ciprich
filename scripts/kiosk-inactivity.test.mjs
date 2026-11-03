import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

test('live match never installs the selection inactivity redirect', () => {
  const source = readFileSync(new URL('../components/match-view.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /useKioskInactivity/)
  assert.match(source, /onClick=\{resetKiosk\}/)
  const parent = readFileSync(new URL('../components/match-start-view.tsx', import.meta.url), 'utf8')
  assert.match(parent, /useKioskInactivity\(matchId === null && \(isScanning \|\| choosingRules \|\| isCreating\), resetKioskFlow\)/)
  const condition = parent.match(/useKioskInactivity\((.+), resetKioskFlow\)/)?.[1]
  assert.ok(condition)
  for (const isScanning of [false, true]) {
    for (const choosingRules of [false, true]) {
      for (const isCreating of [false, true]) {
        assert.equal(vm.runInNewContext(condition, {
          matchId: 'active-match', isScanning, choosingRules, isCreating,
        }), false)
      }
    }
  }
})

test('match rendering failures offer recovery without navigating away from the match', () => {
  const source = readFileSync(new URL('../app/match/error.tsx', import.meta.url), 'utf8')
  assert.match(source, /onClick=\{retry\}/)
  assert.match(source, /window.location.reload\(\)/)
  assert.doesNotMatch(source, /router\.(push|replace)|location\.(assign|replace)/)
})

test('quick matches defer the initial serve draw and saved choice hides the draw action', () => {
  const start = readFileSync(new URL('../components/match-start-view.tsx', import.meta.url), 'utf8')
  assert.match(start, /serving_team: null,\s+initial_server_chosen: false/)
  assert.doesNotMatch(start, /serving_team: Math.random/)
  const match = readFileSync(new URL('../components/match-view.tsx', import.meta.url), 'utf8')
  assert.match(match, /\{!match.initial_server_chosen \? <div[^]*?onClick=\{drawServe\}[^]*?<\/div> : null\}/)
  assert.match(match, /current.initial_server_chosen \|\| writeInFlightRef.current/)
  assert.match(match, /persist\(\{ serving_team: servingTeam, serving_player: 1, initial_server_chosen: true \}\)/)
})

test('selection screens keep the 60-second timer and cancel it on unmount', () => {
  const selection = readFileSync(new URL('../components/kiosk-view.tsx', import.meta.url), 'utf8')
  assert.match(selection, /useKioskInactivity\(true, resetKiosk\)/)
  const source = readFileSync(new URL('../lib/use-kiosk-inactivity.ts', import.meta.url), 'utf8')
  const code = stripTypeScriptTypes(source.replace(/import .* from 'react'\r?\n/, '').replaceAll('export ', ''))
  let now = 0
  let nextId = 0
  let redirects = 0
  const timers = new Map()
  const listeners = new Map()
  const cleanups = []
  const context = {
    useRef: (value) => ({ current: value }),
    useEffect: (effect) => {
      const cleanup = effect()
      if (cleanup) cleanups.push(cleanup)
    },
    window: {
      setTimeout: (callback, delay) => {
        const id = ++nextId
        timers.set(id, { callback, at: now + delay })
        return id
      },
      clearTimeout: (id) => timers.delete(id),
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
    },
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  context.useKioskInactivity(true, () => redirects++)
  const advance = (ms) => {
    now += ms
    for (const [id, timer] of timers) {
      if (timer.at <= now) {
        timers.delete(id)
        timer.callback()
      }
    }
  }
  advance(59_999)
  assert.equal(redirects, 0)
  listeners.get('keydown')()
  advance(59_999)
  assert.equal(redirects, 0)
  advance(1)
  assert.equal(redirects, 1)
  listeners.get('pointerdown')()
  for (const cleanup of cleanups) cleanup()
  advance(120_000)
  assert.equal(redirects, 1)
  assert.equal(listeners.size, 0)
  context.useKioskInactivity(false, () => redirects++)
  advance(600_000)
  assert.equal(redirects, 1)
  assert.equal(timers.size, 0)
})
