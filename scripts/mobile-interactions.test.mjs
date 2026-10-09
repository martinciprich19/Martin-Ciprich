import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import postcss from 'postcss'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'
import { renderToStaticMarkup } from 'react-dom/server'

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('detail button is localized, keyboard accessible and opens exactly once', async () => {
  await loadBindings()
  const source = (await readSource('../components/match-detail-button.tsx'))
    .replace("import { useLanguage } from '@/components/language-provider'", 'const useLanguage = () => ({ t: (sk, en) => globalThis.testMatchLanguage === "en" ? en : sk })')
  const { code } = await transform(source, {
    filename: 'match-detail-button.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' },
  })
  const compiled = code
    .replace('react/jsx-runtime', import.meta.resolve('react/jsx-runtime'))
    .replace('lucide-react', import.meta.resolve('lucide-react'))
  const { MatchDetailButton } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  try {
    for (const [language, label] of [['sk', 'Zobraziť detail zápasu'], ['en', 'View match details']]) {
      globalThis.testMatchLanguage = language
      const calls = []
      const button = MatchDetailButton({ matchId: '42', onOpen: (id) => calls.push(id) })
      const html = renderToStaticMarkup(button)
      assert.match(html, /<button type="button" aria-haspopup="dialog"/)
      assert.ok(html.includes(label))
      button.props.onClick({ stopPropagation: () => calls.push('stop') })
      assert.deepEqual(calls, ['stop', '42'])
    }
  } finally {
    delete globalThis.testMatchLanguage
  }
})

test('recent slide animations and vertical overscroll restrictions are removed', async () => {
  const css = postcss.parse(await readSource('../app/globals.css'))
  assert.doesNotMatch(css.toString(), /mobile-sidebar|match-detail-sheet|match-detail-slide-up/)
  const root = css.nodes.find((node) => node.type === 'rule' && node.selector === 'html, body')
  assert.ok(root)
  assert.ok(!root.nodes.some((node) => node.prop === 'overscroll-behavior-y' || node.prop === 'height' || node.prop === 'max-height'))
})

test('sidebar, recent matches and all histories use shared interactions', async () => {
  const [profile, publicProfile, modal] = await Promise.all([
    readSource('../app/profile/page.tsx'),
    readSource('../app/players/[id]/page.tsx'),
    readSource('../components/match-detail-modal.tsx'),
  ])
  assert.match(profile, /id="profile-navigation" className=\{`fixed/)
  assert.doesNotMatch(profile, /mobile-sidebar/)
  assert.match(profile, /menuOpen \? 'translate-x-0' : '-translate-x-full'/)
  assert.match(profile, /aria-expanded=\{menuOpen\} aria-controls="profile-navigation"/)
  assert.equal((profile.match(/<MatchDetailButton /g) || []).length, 3)
  assert.equal((publicProfile.match(/<MatchDetailButton /g) || []).length, 1)
  assert.match(modal, /fixed inset-0 z-\[60\] overflow-y-auto/)
  assert.doesNotMatch(modal, /match-detail-sheet|max-h-|document.body.style.overflow/)
  assert.match(modal, /event.key === 'Escape'/)
  assert.match(modal, /previousFocus\?\.focus/)
})
