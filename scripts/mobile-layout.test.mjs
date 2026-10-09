import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import postcss from 'postcss'

test('root viewport requests a device-width page without zoom', async () => {
  const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8')
  const viewport = layout.match(/export const viewport: Viewport = \{([^}]+)\}/)?.[1]
  assert.ok(viewport)
  assert.match(viewport, /width: 'device-width'/)
  assert.match(viewport, /initialScale: 1/)
  assert.match(viewport, /maximumScale: 1/)
  assert.match(viewport, /userScalable: false/)
  assert.match(viewport, /viewportFit: 'cover'/)
})

test('page bounds block sideways movement without disabling nested scrolling', async () => {
  const css = postcss.parse(await readFile(new URL('../app/globals.css', import.meta.url), 'utf8'))
  const root = css.nodes.find((node) => node.type === 'rule' && node.selector === 'html, body')
  assert.ok(root)
  const declarations = Object.fromEntries(root.nodes.map((node) => [node.prop, node.value]))
  assert.equal(declarations.width, '100%')
  assert.equal(declarations['max-width'], '100%')
  assert.equal(declarations['overflow-x'], 'hidden')
  assert.equal(declarations['overscroll-behavior-x'], 'none')
  assert.equal(declarations['touch-action'], 'pan-x pan-y')
  assert.equal(declarations['overflow-y'], undefined)
  assert.equal(declarations.position, undefined)

  const body = css.nodes.find((node) => node.type === 'rule' && node.selector === 'body')
  assert.ok(body.nodes.some((node) => node.prop === 'overflow-wrap' && node.value === 'anywhere'))
  const mobile = css.nodes.find((node) => node.type === 'atrule' && node.name === 'media' && node.params === '(max-width: 767px)')
  assert.ok(mobile)
  const controls = mobile.nodes.find((node) => node.type === 'rule' && node.selector.includes('select, textarea'))
  assert.ok(controls.nodes.some((node) => node.prop === 'font-size' && node.value === '16px'))
})
