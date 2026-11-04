import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

test('TV scoreboard fits the viewport with large scores in every display state', { timeout: 90000 }, async (t) => {
  const browserPath = process.env.SCOREBOARD_TEST_BROWSER
    ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (!existsSync(browserPath)) {
    t.skip('Set SCOREBOARD_TEST_BROWSER to a Chromium browser executable.')
    return
  }
  const chunks = new URL('../.next/static/chunks/', import.meta.url)
  assert.ok(existsSync(chunks), 'Run npm run build before this browser layout test.')
  const css = readdirSync(chunks).filter(name => name.endsWith('.css'))
    .map(name => readFileSync(new URL(name, chunks), 'utf8')).join('\n')
  await loadBindings()
  const { code } = await transform(readFileSync(new URL('../components/scoreboard-view.tsx', import.meta.url), 'utf8'), {
    filename: 'scoreboard-view.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  })
  const court = {
    court_id: 1, arena_id: 1, court_name: 'Kurt 1', match_id: 'match',
    team_a_player1_name: 'Martin Ciprich', team_a_player2_name: 'Hráč číslo dva',
    team_b_player1_name: 'Hráč číslo tri', team_b_player2_name: 'Hráč číslo štyri',
    team_a_sets: 2, team_b_sets: 1, team_a_games: 6, team_b_games: 5,
    team_a_game_score: 40, team_b_game_score: 30,
  }
  function render(state) {
    let stateIndex = 0
    const exports = {}
    vm.runInNewContext(code, { exports, require: name => {
      if (name === 'react/jsx-runtime') return jsxRuntime
      if (name === 'react') return {
        useState: () => [state[stateIndex++], () => {}],
        useRef: value => ({ current: value }), useEffect() {}, useCallback: callback => callback,
      }
      if (name === 'lucide-react') return { LoaderCircle: 'i', Radio: 'i', WifiOff: 'i' }
      if (name === '@/components/page-reload-button') return {
        PageReloadButton: () => React.createElement('button', { style: { width: 44, height: 44 }, 'aria-label': 'Reload' }, '↻'),
      }
      if (name === '@/lib/supabase/client') return { createClient: () => ({
        storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4000" height="3000"/%3E' } }) }) },
      }) }
      throw new Error(`Unexpected import: ${name}`)
    } })
    return renderToStaticMarkup(React.createElement(exports.ScoreboardView, { courtId: '1' }))
  }
  const profile = mkdtempSync(join(tmpdir(), 'riva-scoreboard-'))
  const browser = spawn(browserPath, ['--headless', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  let socket
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = ''
      const timer = setTimeout(() => reject(new Error('Headless browser startup timed out')), 20000)
      browser.once('error', error => { clearTimeout(timer); reject(error) })
      browser.stderr.on('data', data => {
        stderr += data
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) { clearTimeout(timer); resolve(match[1]) }
      })
    })
    const origin = new URL(endpoint).origin.replace('ws:', 'http:')
    const targets = await (await fetch(`${origin}/json/list`)).json()
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let id = 0
    const pending = new Map()
    socket.onmessage = event => {
      const reply = JSON.parse(event.data)
      if (!pending.has(reply.id)) return
      const { resolve, reject } = pending.get(reply.id)
      pending.delete(reply.id)
      if (reply.error) reject(new Error(reply.error.message))
      else resolve(reply.result)
    }
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`Browser command timed out: ${method}`))
      }, 10000)
      pending.set(requestId, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) },
      })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    await send('Page.enable')
    const states = {
      live: [court, false, false, [], 0],
      paused: [{ ...court, paused_at: 'now', advantage_team: 'TEAM_A' }, false, false, [], 0],
      tiebreak: [{ ...court, tiebreak_score: { a: 12, b: 11 } }, false, false, [], 0],
      idle: [{ ...court, match_id: null }, false, false, [], 0],
      sponsor: [{ ...court, match_id: null }, false, false, [{ id: 'ad', sponsor_name: 'Sponsor', image_path: 'ad' }], 0],
      'sponsor-slide': [{ ...court, match_id: null }, false, false, [
        { id: 'ad1', sponsor_name: 'Sponsor 1', image_path: 'ad1' },
        { id: 'ad2', sponsor_name: 'Sponsor 2', image_path: 'ad2' },
      ], 1],
      loading: [null, true, false, [], 0],
      error: [court, false, true, [], 0],
      missing: [null, false, false, [], 0],
    }
    for (const [width, height] of [[1920, 1080], [1280, 720], [960, 540], [800, 450], [3840, 2160], [390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      for (const [name, state] of Object.entries(states)) {
        const html = `<html style="--font-inter:Arial"><head><style>${css}</style></head><body>${render(state)}</body></html>`
        await send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` })
        const { result, exceptionDetails } = await send('Runtime.evaluate', {
          expression: `Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime)).map(animation => animation.finished)).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
            const main = document.querySelector('main');
            const rect = main.getBoundingClientRect();
            const elements = [...main.querySelectorAll('header, footer, .court-scoreboard-team, .court-scoreboard-columns, .court-scoreboard-players p, .court-scoreboard-points, .court-scoreboard-number, img:not([aria-hidden="true"])')];
            resolve({
              scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, main.scrollWidth, main.scrollHeight],
              bounds: [rect.width, rect.height],
              clipped: elements.filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1; }).map(el => ({ className: el.className, box: [el.clientWidth, el.clientHeight], scroll: [el.scrollWidth, el.scrollHeight] })),
              points: [...main.querySelectorAll('.court-scoreboard-points')].map(el => parseFloat(getComputedStyle(el).fontSize))
            });
          }))))`,
          awaitPromise: true, returnByValue: true,
        })
        assert.equal(exceptionDetails, undefined)
        const metrics = result.value
        assert.deepEqual(metrics.bounds, [width, height], `${name} ${width}x${height}`)
        assert.ok(metrics.scroll[0] <= width && metrics.scroll[1] <= height
          && metrics.scroll[2] <= width && metrics.scroll[3] <= height, `No scrolling: ${name} ${width}x${height}`)
        assert.deepEqual(metrics.clipped, [], `No clipped content: ${name} ${width}x${height}`)
        if (width >= 800 && ['live', 'paused', 'tiebreak'].includes(name)) {
          assert.ok(metrics.points.every(size => size >= height * .2), `Large points: ${width}x${height}`)
        }
      }
    }
    await send('Browser.close')
  } finally {
    socket?.close()
    if (browser.exitCode === null) {
      await new Promise(resolve => {
        browser.once('exit', resolve)
        setTimeout(() => { if (browser.exitCode === null) browser.kill(); resolve() }, 3000).unref()
      })
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
})
