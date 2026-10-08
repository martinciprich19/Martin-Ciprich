import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('settings and layout no longer switch themes; dark colors are unconditional', async () => {
  const [layout, profile, css] = await Promise.all([
    readSource('../app/layout.tsx'),
    readSource('../app/profile/page.tsx'),
    readSource('../app/globals.css'),
  ])
  assert.doesNotMatch(layout + profile, /ThemeProvider|ThemeToggle|useTheme|riva-theme/)
  assert.match(layout, /className=\{`\$\{inter.variable\} dark`\}/)
  assert.match(css, /:root \{[^}]*--ink: #061016;[^}]*--foreground: #f5f7f6;[^}]*color-scheme: dark;/)
  assert.doesNotMatch(css, /color-scheme: light/)
})

test('manifest references the new artwork in correctly sized standalone app icons', async () => {
  await loadBindings()
  const { code } = await transform(await readSource('../app/manifest.ts'), {
    filename: 'manifest.ts',
    jsc: { parser: { syntax: 'typescript' } },
    module: { type: 'es6' },
  })
  const { default: manifest } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  const result = manifest()
  assert.equal(result.name, 'RIVA Padel')
  assert.equal(result.short_name, 'RIVA Padel')
  assert.equal(result.display, 'standalone')
  assert.deepEqual(result.icons.map((icon) => [icon.src, icon.sizes]), [
    ['/images/riva-padel-play-together-icon-192.png', '192x192'],
    ['/images/riva-padel-play-together-icon-512.png', '512x512'],
  ])
})

test('browser, Apple and PWA assets use the same new logo without cropping', async () => {
  const logo = await readFile(new URL('../public/images/riva-padel-play-together-logo.png', import.meta.url))
  for (const [size, name] of [
    [192, 'riva-padel-play-together-icon-192.png'],
    [512, 'riva-padel-play-together-icon-512.png'],
    [180, 'riva-padel-play-together-apple-touch-icon.png'],
  ]) {
    const icon = await readFile(new URL(`../public/images/${name}`, import.meta.url))
    const metadata = await sharp(icon).metadata()
    assert.equal(metadata.width, size)
    assert.equal(metadata.height, size)
    assert.deepEqual(
      await sharp(icon).raw().toBuffer(),
      await sharp(logo).resize(size, size, { fit: 'contain', background: '#0b0f19' }).raw().toBuffer(),
    )
  }
  const [layout, component] = await Promise.all([
    readSource('../app/layout.tsx'),
    readSource('../components/riva-logo.tsx'),
  ])
  assert.match(layout, /riva-padel-play-together-icon-192\.png/)
  assert.match(layout, /riva-padel-play-together-apple-touch-icon\.png/)
  assert.match(component, /riva-padel-play-together-logo\.png/)
})
