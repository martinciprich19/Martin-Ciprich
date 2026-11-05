import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { stripTypeScriptTypes } from 'node:module'

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
          navigationTapFeedback: () => calls.push(['haptic']),
          setMenuOpen: value => calls.push(['menu', value]),
          setBottomNavigationTab: value => calls.push(['animation', value]),
          setActiveTab: value => calls.push(['tab', value]),
          window: { scrollTo: options => calls.push(['scroll', options.top, options.behavior]) },
        })
        assert.deepEqual(calls, [
          ['haptic'],
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

test('native haptics take priority; browser fallback and unsupported devices preserve navigation', () => {
  const source = stripTypeScriptTypes(readFileSync(new URL('../lib/haptics.ts', import.meta.url), 'utf8'))
    .replace('export function', 'function')
  for (const mode of ['native', 'browser', 'blocked', 'unsupported', 'server']) {
    const calls = []
    const context = {
      navigator: mode === 'unsupported' ? {} : { vibrate: ms => { calls.push(['browser', ms]); return mode !== 'blocked' } },
      ...(mode === 'server' ? {} : { window: mode === 'native' ? { RivaNativeHaptics: { tap: () => calls.push(['native']) } } : {} }),
    }
    vm.runInNewContext(`${source}; navigationTapFeedback()`, context)
    assert.deepEqual(calls, mode === 'native' ? [['native']] : ['browser', 'blocked'].includes(mode) ? [['browser', 15]] : [])
  }
  const native = readFileSync(new URL('../android/riva-app/src/sk/rivapadel/apptest/MainActivity.java', import.meta.url), 'utf8')
  assert.match(native, /addJavascriptInterface\(new NativeHapticsBridge\(\), "RivaNativeHaptics"\)/)
  assert.match(native, /!foreground \|\| web == null \|\| !AppPolicy.trusted\(web.getUrl\(\)\)/)
  assert.match(native, /performHapticFeedback\(HapticFeedbackConstants.KEYBOARD_TAP\)/)
  assert.doesNotMatch(native, /FLAG_IGNORE_GLOBAL_SETTING|FLAG_IGNORE_VIEW_SETTING/)
})

test('Android grants the normal vibration permission without requiring a runtime prompt', () => {
  const manifest = readFileSync(new URL('../android/riva-app/AndroidManifest.xml', import.meta.url), 'utf8')
  assert.match(manifest, /<uses-permission android:name="android\.permission\.VIBRATE"\s*\/>/)
})

test('bottom screen animation matches the side menu timing and respects reduced motion', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
  assert.match(css, /@keyframes profile-bottom-screen-in\s*\{\s*from \{ transform: translateY\(100svh\); \}\s*to \{ transform: translateY\(0\); \}/)
  assert.match(css, /@media \(max-width: 767px\) and \(prefers-reduced-motion: no-preference\)\s*\{\s*\.profile-bottom-screen-enter \{ animation: profile-bottom-screen-in 860ms cubic-bezier\(0.22,1,0.36,1\); \}/)
})
