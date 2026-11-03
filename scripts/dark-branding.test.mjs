import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('settings and layout no longer switch themes; dark colors are unconditional', async () => {
  const [layout, profile, globals, themeCss] = await Promise.all([
    readSource('../app/layout.tsx'),
    readSource('../app/profile/page.tsx'),
    readSource('../app/globals.css'),
    readSource('../app/themes.css'),
  ])
  assert.doesNotMatch(layout + profile + globals + themeCss, /ThemeProvider|ThemeToggle|useTheme|riva-theme|html\.light|color-scheme: light/)
  assert.match(layout, /className=\{`\$\{inter.variable\} dark`\}/)
  assert.match(layout, /statusBarStyle: 'black'/)
  assert.match(layout, /themeColor: '#0b0f17'/)
  assert.match(layout, /colorScheme: 'dark'/)
  assert.match(themeCss, /:root \{[^}]*--ink: var\(--app-ink\);[^}]*--foreground: #f5f7f6;[^}]*color-scheme: dark;/)
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
    ['/images/riva-padel-play-together-compact-icon-192.png?v=2', '192x192'],
    ['/images/riva-padel-play-together-compact-icon-512.png?v=2', '512x512'],
  ])
})

test('browser, Apple and PWA assets use the same new logo without cropping', async () => {
  const logo = await readFile(new URL('../public/images/riva-padel-play-together-compact-logo.png', import.meta.url))
  const approved = await readFile(new URL('../public/images/riva-approved-logo.png', import.meta.url))
  assert.deepEqual(await sharp(logo).raw().toBuffer(), await sharp(approved).resize(768, 768).raw().toBuffer())
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
  assert.ok((right - left + 1) / info.width >= 0.45, 'Approved artwork must remain visible without cropping its original padding')
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

test('Android adaptive icon enlarges the approved artwork without cropping and retains legacy support', async () => {
  const approved = await readFile(new URL('../public/images/riva-approved-logo.png', import.meta.url))
  const { data, info } = await sharp(approved).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width, right = -1, top = info.height, bottom = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels
      if (Math.max(data[offset], data[offset + 1], data[offset + 2]) <= 150) continue
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
  }
  const size = Math.ceil(Math.max(right - left + 1, bottom - top + 1) / 0.83)
  const crop = { left: Math.floor((left + right + 1 - size) / 2),
    top: Math.floor((top + bottom + 1 - size) / 2), width: size, height: size }
  assert.ok(crop.left < left && crop.top < top && crop.left + size > right && crop.top + size > bottom)
  const icon = await readFile(new URL('../android/riva-app/res/drawable/app_icon.png', import.meta.url))
  assert.deepEqual(await sharp(icon).raw().toBuffer(), await sharp(approved).extract(crop).resize(512, 512).raw().toBuffer())
  const rendered = await sharp(icon).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = 512, maxX = -1
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const offset = (y * 512 + x) * rendered.info.channels
    if (Math.max(...rendered.data.subarray(offset, offset + 3)) <= 150) continue
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    // Android's guaranteed 66dp safe circle within the visible 72dp icon.
    assert.ok(Math.hypot((x + 0.5 - 256) * 72 / 512, (y + 0.5 - 256) * 72 / 512) < 33,
      'Visible logo must remain inside the adaptive icon safe circle')
  }
  assert.ok((maxX - minX + 1) / 512 >= 0.82, 'Launcher logo must use at least 82% of the visible icon width')
  const [manifest, adaptive, legacy, colors] = await Promise.all([
    readSource('../android/riva-app/AndroidManifest.xml'),
    readSource('../android/riva-app/res/mipmap-anydpi-v26/app_icon.xml'),
    readSource('../android/riva-app/res/mipmap/app_icon.xml'),
    readSource('../android/riva-app/res/values/icon_colors.xml'),
  ])
  assert.match(manifest, /android:icon="@mipmap\/app_icon"/)
  assert.match(adaptive, /<adaptive-icon/)
  for (const side of ['Left', 'Top', 'Right', 'Bottom']) assert.ok(adaptive.includes(`android:inset${side}="16.6667%"`))
  assert.match(adaptive, /android:src="@drawable\/app_icon" android:gravity="fill"/)
  assert.match(legacy, /android:src="@drawable\/app_icon"/)
  assert.match(colors, /name="riva_icon_background">#091223</)
})
