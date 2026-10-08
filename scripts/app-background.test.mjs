import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'

test('shared background covers the viewport independently of page length', async () => {
  await loadBindings()
  const source = await readFile(new URL('../components/app-background.tsx', import.meta.url), 'utf8')
  const { code } = await transform(source, {
    filename: 'app-background.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' },
  })
  const compiled = code.replace('react/jsx-runtime', import.meta.resolve('react/jsx-runtime'))
  const { AppBackground } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  const html = renderToStaticMarkup(createElement(AppBackground))
  assert.match(html, /fixed inset-0/)
  assert.match(html, /bg-cover bg-center bg-no-repeat/)
  assert.doesNotMatch(html, /bg-contain|100svh|100vh|100dvh/)
  const image = await readFile(new URL('../public/images/padel-bg.jpg', import.meta.url))
  const { width, height } = await sharp(image).metadata()
  assert.ok(width && height)
  for (const [viewportWidth, viewportHeight] of [[1440, 900], [390, 844], [412, 915], [844, 390]]) {
    const scale = Math.max(viewportWidth / width, viewportHeight / height)
    assert.ok(width * scale >= viewportWidth - 0.001)
    assert.ok(height * scale >= viewportHeight - 0.001)
  }
  const [profile, publicProfile] = await Promise.all([
    readFile(new URL('../app/profile/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/players/[id]/page.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(profile, /<AppBackground \/>/)
  assert.match(publicProfile, /<AppBackground \/>/)
})
