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

test('slide animations respect reduced motion and use only transforms', async () => {
  const css = postcss.parse(await readSource('../app/globals.css'))
  const motion = css.nodes.find((node) => node.type === 'atrule' && node.name === 'media' && node.params === '(prefers-reduced-motion: no-preference)')
  assert.ok(motion)
  const sidebar = motion.nodes.find((node) => node.selector === '.mobile-sidebar')
  assert.ok(sidebar.nodes.some((node) => node.prop === 'transition' && node.value.startsWith('transform 300ms')))
  const sheet = motion.nodes.find((node) => node.selector === '.match-detail-sheet')
  assert.ok(sheet.nodes.some((node) => node.prop === 'animation' && node.value.startsWith('match-detail-slide-up 350ms')))
  const keyframes = css.nodes.find((node) => node.type === 'atrule' && node.name === 'keyframes' && node.params === 'match-detail-slide-up')
  assert.ok(keyframes)
  assert.equal(keyframes.nodes[0].nodes[0].value, 'translateY(100dvh)')
  assert.equal(keyframes.nodes[1].nodes[0].value, 'translateY(0)')
})

test('sidebar, recent matches and all histories use shared interactions', async () => {
  const [profile, publicProfile, modal] = await Promise.all([
    readSource('../app/profile/page.tsx'),
    readSource('../app/players/[id]/page.tsx'),
    readSource('../components/match-detail-modal.tsx'),
  ])
  assert.match(profile, /id="profile-navigation" className=\{`mobile-sidebar/)
  assert.match(profile, /menuOpen \? 'translate-x-0' : '-translate-x-full'/)
  assert.match(profile, /aria-expanded=\{menuOpen\} aria-controls="profile-navigation"/)
  assert.equal((profile.match(/<MatchDetailButton /g) || []).length, 3)
  assert.equal((publicProfile.match(/<MatchDetailButton /g) || []).length, 1)
  assert.match(modal, /className="match-detail-sheet relative max-h-\[94dvh\]/)
  assert.match(modal, /event.key === 'Escape'/)
  assert.match(modal, /document.body.style.overflow = previousOverflow/)
  assert.match(modal, /previousFocus\?\.focus/)
})
