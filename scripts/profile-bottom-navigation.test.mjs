import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

test('every bottom navigation destination slides in without restarting the selected tab', () => {
  const page = readFileSync(new URL('../app/profile/page.tsx', import.meta.url), 'utf8')
  const bottomNav = page.slice(page.indexOf('aria-label="Mobilná navigácia"'))
  const handler = bottomNav.match(/onClick=\{\(\) => \{ (.*?) \}\}/)?.[1]
  assert.ok(handler)
  for (const tab of ['rankings', 'opponents', 'matches', 'messages', 'profile']) {
    for (const active of [false, true]) {
      const calls = []
      vm.runInNewContext(handler, {
        tab, active,
        setMenuOpen: value => calls.push(['menu', value]),
        setBottomNavigationTab: value => calls.push(['animation', value]),
        setActiveTab: value => calls.push(['tab', value]),
        window: { scrollTo: options => calls.push(['scroll', options.top, options.behavior]) },
      })
      assert.deepEqual(calls, [
        ['menu', false], ...(!active ? [['animation', tab]] : []),
        ['tab', tab], ['scroll', 0, 'instant'],
      ])
    }
  }
  assert.match(page, /key=\{activeTab\} className=\{bottomNavigationTab === activeTab \? 'profile-bottom-screen-enter' : undefined\}/)
  assert.match(page, /event.target === event.currentTarget\) setBottomNavigationTab\(null\)/)
  const wrapper = page.indexOf("className={bottomNavigationTab === activeTab")
  assert.ok(wrapper > page.indexOf('</header>', page.indexOf('className="profile-toolbar')))
  assert.ok(wrapper < page.indexOf('Zadať výsledok</button>'))
})

test('bottom screen animation matches the side menu timing and respects reduced motion', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
  assert.match(css, /@keyframes profile-bottom-screen-in\s*\{\s*from \{ transform: translateY\(100svh\); \}\s*to \{ transform: translateY\(0\); \}/)
  assert.match(css, /@media \(max-width: 767px\) and \(prefers-reduced-motion: no-preference\)\s*\{\s*\.profile-bottom-screen-enter \{ animation: profile-bottom-screen-in 860ms cubic-bezier\(0.22,1,0.36,1\); \}/)
})
