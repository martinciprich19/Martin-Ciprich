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
  assert.match(layout, /\{children\}<PageReloadButton \/>/)
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
    assert.match(button.props.className, /z-40/)
    assert.match(button.props.style.bottom, /safe-area-inset-bottom/)
    assert.match(button.props.style.right, /safe-area-inset-right/)
    button.props.onClick()
    assert.equal(location.href, initialUrl)
  }
  assert.equal(reloads, 3)
})
