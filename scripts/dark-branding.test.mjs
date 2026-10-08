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
  assert.match(layout, /statusBarStyle: 'black'/)
  assert.match(layout, /themeColor: '#0b0f17'/)
  assert.match(layout, /colorScheme: 'dark'/)
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
  assert.equal(result.theme_color, '#0b0f17')
  assert.equal(result.background_color, '#0b0f17')
  assert.deepEqual(result.icons.map((icon) => [icon.src, icon.sizes]), [
    ['/images/riva-padel-play-together-compact-icon-192.png', '192x192'],
    ['/images/riva-padel-play-together-compact-icon-512.png', '512x512'],
  ])
})

test('browser, Apple and PWA assets use the same new logo without cropping', async () => {
  const logo = await readFile(new URL('../public/images/riva-padel-play-together-compact-logo.png', import.meta.url))
  const { data, info } = await sharp(logo).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width
  let right = -1
  let top = info.height
  let bottom = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels
      if (Math.max(data[offset], data[offset + 1], data[offset + 2]) <= 150) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  assert.ok((right - left + 1) / info.width >= 0.8, 'Artwork should occupy at least 80% of the logo width')
  assert.ok(left > 0 && top > 0 && right < info.width - 1 && bottom < info.height - 1, 'Entire artwork must retain padding')
  for (const [size, name] of [
    [192, 'riva-padel-play-together-compact-icon-192.png'],
    [512, 'riva-padel-play-together-compact-icon-512.png'],
    [180, 'riva-padel-play-together-compact-apple-touch-icon.png'],
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
  assert.match(layout, /riva-padel-play-together-compact-icon-192\.png/)
  assert.match(layout, /riva-padel-play-together-compact-apple-touch-icon\.png/)
  assert.match(component, /riva-padel-play-together-compact-logo\.png/)
})
