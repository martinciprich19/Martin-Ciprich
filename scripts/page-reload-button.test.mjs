import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

test('global reload button reloads the current URL and is accessible in all languages', async () => {
  await loadBindings()
  const source = await readFile(new URL('../components/page-reload-button.tsx', import.meta.url), 'utf8')
  const { code } = await transform(source, {
    filename: 'page-reload-button.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  })
  const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /<PageReloadToolbar \/>\{children\}/)
  let reloads = 0
  const location = { href: 'https://www.rivapadel.app/match?id=test&mode=kiosk', reload: () => reloads++ }
  const initialUrl = location.href
  for (const label of ['Obnoviť stránku', 'Reload page', 'Pagina vernieuwen']) {
    const exports = {}
    vm.runInNewContext(code, {
      exports,
      window: { location },
      require: (name) => {
        if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) }
        if (name === 'lucide-react') return { RefreshCw: 'RefreshCw' }
        if (name === 'next/navigation') return { usePathname: () => '/auth/login' }
        if (name === '@/components/language-provider') return { useLanguage: () => ({ t: () => label }) }
        throw new Error(`Unexpected import: ${name}`)
      },
    })
    const button = exports.PageReloadButton()
    assert.equal(button.type, 'button')
    assert.equal(button.props.type, 'button')
    assert.equal(button.props['aria-label'], label)
    assert.equal(button.props.title, label)
    assert.equal(button.props.children.props['aria-hidden'], 'true')
    assert.match(button.props.className, /h-11 w-11/)
    assert.match(button.props.className, /shrink-0/)
    assert.doesNotMatch(button.props.className, /fixed|absolute/)
    assert.equal(button.props.style, undefined)
    button.props.onClick()
    assert.equal(location.href, initialUrl)
  }
  assert.equal(reloads, 3)
})

test('reload is inside existing top headers with a non-overlapping fallback on other pages', async () => {
  const headers = ['../app/profile/page.tsx', '../app/page.tsx',
    '../components/public-shell.tsx', '../components/how-it-works-view.tsx']
  for (const file of headers) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    const header = source.slice(source.indexOf('<header'), source.indexOf('</header>'))
    assert.match(header, /<PageReloadButton \/>/, file)
    assert.match(header, /flex-wrap/, 'Small screens must allow header controls to wrap')
  }
  const source = await readFile(new URL('../components/page-reload-button.tsx', import.meta.url), 'utf8')
  const { code } = await transform(source, {
    filename: 'page-reload-button.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  })
  let pathname
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) }
    if (name === 'next/navigation') return { usePathname: () => pathname }
    if (name === 'lucide-react') return { RefreshCw: 'RefreshCw' }
    if (name === '@/components/language-provider') return { useLanguage: () => ({ t: () => 'Reload page' }) }
    throw new Error(`Unexpected import: ${name}`)
  } })
  for (pathname of ['/', '/profile', '/how-it-works', '/match', '/live-matches', '/rankings', '/tournaments', '/scoreboard/1']) {
    assert.equal(exports.PageReloadToolbar(), null, `No duplicate toolbar on ${pathname}`)
  }
  const scoreboard = await readFile(new URL('../components/scoreboard-view.tsx', import.meta.url), 'utf8')
  assert.match(scoreboard.slice(scoreboard.indexOf('<header'), scoreboard.indexOf('</header>')), /<PageReloadButton \/>/)
  for (pathname of ['/auth/login', '/auth/sign-up', '/kiosk', '/arena-admin', '/players/1', '/find-player']) {
    const toolbar = exports.PageReloadToolbar()
    assert.equal(toolbar.type, 'div')
    assert.doesNotMatch(toolbar.props.className, /fixed|absolute/)
    assert.equal(toolbar.props.children.type, exports.PageReloadButton)
  }
})
