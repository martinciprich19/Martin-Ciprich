import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const swc = require('next/dist/build/swc')
await swc.loadBindings()
const root = path.resolve(import.meta.dirname, '..')

function loadModule(relative, mocks = {}, globals = {}) {
  const cache = new Map()
  const context = vm.createContext({ console, setTimeout, clearTimeout, WeakRef, ...globals })
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const source = swc.transformSync(fs.readFileSync(filename, 'utf8'), {
      filename,
      jsc: { parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') }, transform: { react: { runtime: 'automatic' } } },
      module: { type: 'commonjs' },
    }).code
    const localRequire = (name) => {
      if (name in mocks) return mocks[name]
      if (!name.startsWith('@/')) return require(name)
      const base = path.join(root, name.slice(2))
      const resolved = ['.ts', '.tsx', '.js'].map((ext) => base + ext).find(fs.existsSync)
      assert.ok(resolved, `Missing module ${name}`)
      return load(resolved)
    }
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename })(localRequire, module, module.exports)
    return module.exports
  }
  return load(path.join(root, relative))
}

const provider = loadModule('components\\language-provider.tsx')
const { browserLanguage } = loadModule('lib\\i18n\\language.ts')
const { createTranslator, startDomTranslation } = loadModule('lib\\i18n\\dom-translator.ts')
const { dutchVocabulary } = loadModule('lib\\i18n\\dutch-translations.ts')

test('Dutch explicitly covers every existing English dictionary entry', () => {
  const missing = []
  for (const [key, en] of Object.entries(provider.translations.en)) {
    if (!provider.translations.nl[key]) missing.push(`${key}: ${en}`)
  }
  for (const name of ['ui', 'arena', 'players', 'pair-challenge']) {
    const exports = loadModule(`lib\\i18n\\${name}-translations.ts`)
    for (const value of Object.values(exports)) {
      if (Array.isArray(value)) continue
      for (const [key, en] of Object.entries(value.en ?? value)) {
        if (!dutchVocabulary[en] && !provider.translations.nl[key]) missing.push(`${key}: ${en}`)
      }
    }
  }
  assert.deepEqual(missing, [])
})

test('guest preference uses browser language order and locale variants', () => {
  assert.equal(browserLanguage(['nl-NL', 'en-GB']), 'nl')
  assert.equal(browserLanguage(['fr-BE', 'nl-BE', 'sk']), 'nl')
  assert.equal(browserLanguage(['en-US', 'nl']), 'en')
  assert.equal(browserLanguage(['sk-SK', 'nl']), 'sk')
  assert.equal(browserLanguage(['de-DE']), 'sk')
  assert.equal(browserLanguage([]), 'sk')
})

test('Dutch covers exact signup vocabulary, including conditional labels and validation messages', () => {
  const expected = {
    'Krajina národnej ligy': 'Land van de nationale competitie',
    'Pohlavie': 'Geslacht', 'Vyber pohlavie': 'Kies je geslacht',
    'Vyber pohlavie.': 'Kies je geslacht.', 'Muž': 'Man', 'Žena': 'Vrouw',
    'Provincia': 'Provincie', 'Vyber svoju provinciu': 'Kies je provincie',
    'Vyber svoju provinciu.': 'Kies je provincie.', 'Vyber svoj kraj.': 'Kies je regio.',
    'Už máš účet?': 'Heb je al een account?',
  }
  for (const [key, dutch] of Object.entries(expected)) assert.equal(provider.translate('nl', key), dutch)
  const source = fs.readFileSync(path.join(root, 'app\\auth\\sign-up\\page.tsx'), 'utf8')
  const calls = [...source.matchAll(/\bt\(([^)\n]+)\)/g)]
  assert.ok(calls.length > 20)
  for (const [, args] of calls) {
    // Include both branches of conditional calls, not just literal first arguments.
    const keys = [...args.matchAll(/'([^']+)'/g)].map((match) => match[1])
    for (const key of keys.filter((key) => key !== 'NL' && key !== 'SK' && key !== 'National league country')) {
      assert.notEqual(provider.translate('nl', key), key, `Signup key lacks Dutch: ${key}`)
    }
  }
  for (const key of ['Začiatočník', 'Mierne pokročilý', 'Pokročilý', 'Expert', 'Slovensko', 'Holandsko']) {
    assert.ok(provider.translations.nl[key], `Dynamic signup key lacks Dutch: ${key}`)
  }
})

test('Dutch translates auth recovery, scoring, errors and parameterized strings', () => {
  assert.equal(provider.translate('nl', 'Toto heslo ste použili v minulosti, zadajte nové.'), 'Je hebt dit wachtwoord eerder gebruikt. Kies een nieuw wachtwoord.')
  assert.equal(provider.translate('nl', 'Výhoda'), 'Voordeel')
  assert.equal(provider.translate('nl', 'Body vyhraté na podaní'), 'Gewonnen servicepunten')
  assert.equal(provider.translate('nl', 'Invalid login credentials'), 'Onjuist e-mailadres of wachtwoord.')
  assert.equal(provider.translate('nl', 'Poslať znova o 32 s'), 'Opnieuw versturen over 32 s')
  assert.equal(provider.translate('nl', 'Overovací e-mail sme znova odoslali na test@example.nl.'), 'We hebben de verificatiemail opnieuw verstuurd naar test@example.nl.')
  assert.equal(provider.translate('en', 'Hraj.'), 'Play.')
  assert.equal(provider.translate('sk', 'Hraj.'), 'Hraj.')
  assert.equal(provider.translate('en', 'unmapped', 'English fallback'), 'English fallback')
  assert.equal(createTranslator({}, 'nl').translateString('  3 / 8 dvojíc  '), '  3 / 8 duo’s  ')
  assert.equal(createTranslator({}, 'sk').translateString('Prehľad'), null)
})

test('owned auth and public pages contain no untranslated Slovak JSX text or attributes', () => {
  for (const relative of [
    'app\\auth\\login\\page.tsx', 'app\\auth\\forgot-password\\page.tsx', 'app\\auth\\update-password\\page.tsx',
    'app\\auth\\verify\\page.tsx', 'app\\auth\\sign-up-success\\page.tsx', 'app\\page.tsx', 'components\\how-it-works-view.tsx',
  ]) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8')
    assert.doesNotMatch(source, />[^<>{}]*[áčďéíľňóôŕšťúýž][^<>{}]*</i, relative)
    assert.doesNotMatch(source, /(?:placeholder|aria-label|title)="[^"]*[áčďéíľňóôŕšťúýž]/i, relative)
    for (const match of source.matchAll(/\bt\('([^']+)'\)/g)) {
      assert.ok(provider.translations.nl[match[1]] || createTranslator(provider.translations.nl, 'nl').translateString(match[1]), `${relative}: ${match[1]}`)
    }
  }
})

function fakeDom() {
  class Element {
    nodeType = 1
    parentElement = null
    children = []
    attributes = new Map()
    constructor(tagName, attributes = {}) {
      this.tagName = tagName
      this.attributes = new Map(Object.entries(attributes))
    }
    append(node) { node.parentElement = this; this.children.push(node); return node }
    getAttribute(name) { return this.attributes.get(name) ?? null }
    hasAttribute(name) { return this.attributes.has(name) }
    setAttribute(name, value) { this.attributes.set(name, value) }
  }
  class Text {
    nodeType = 3
    parentElement = null
    constructor(data) { this.data = data }
  }
  let observer
  class MutationObserver {
    constructor(callback) { this.callback = callback; observer = this }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  const body = new Element('BODY')
  const document = {
    body,
    createTreeWalker(element) {
      const nodes = []
      const visit = (node) => { for (const child of node.children ?? []) { nodes.push(child); visit(child) } }
      visit(element)
      let index = 0
      return { nextNode: () => nodes[index++] ?? null }
    },
  }
  return { Element, Text, document, MutationObserver, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1 }, getObserver: () => observer }
}

test('legacy DOM restores SK when switching EN → NL → SK, preserves option values and React updates', () => {
  const dom = fakeDom()
  const module = loadModule('lib\\i18n\\dom-translator.ts', {}, dom)
  const text = dom.document.body.append(new dom.Text('Prehľad'))
  const input = dom.document.body.append(new dom.Element('INPUT', { placeholder: 'Hľadať hráča...' }))
  const option = dom.document.body.append(new dom.Element('OPTION'))
  const optionText = option.append(new dom.Text('Pravák'))
  const ignored = dom.document.body.append(new dom.Element('DIV', { translate: 'no' })).append(new dom.Text('Prehľad'))
  const stopEnglish = module.startDomTranslation(module.createTranslator({}).translateString)
  assert.equal(text.data, 'Overview')
  assert.equal(optionText.data, 'Right-handed')
  assert.equal(option.getAttribute('value'), 'Pravák')
  assert.equal(ignored.data, 'Prehľad')
  stopEnglish()
  assert.equal(dom.getObserver().disconnected, true)
  assert.equal(text.data, 'Prehľad')
  const stopDutch = module.startDomTranslation(module.createTranslator({}, 'nl').translateString)
  assert.equal(text.data, 'Overzicht')
  assert.equal(input.getAttribute('placeholder'), 'Speler zoeken...')
  assert.equal(optionText.data, 'Rechtshandig')
  text.data = 'Zápasy'
  dom.getObserver().callback([{ type: 'characterData', target: text }])
  assert.equal(text.data, 'Wedstrijden')
  stopDutch()
  assert.equal(text.data, 'Zápasy')
  assert.equal(input.getAttribute('placeholder'), 'Hľadať hráča...')
  assert.equal(optionText.data, 'Pravák')
  const stop = module.startDomTranslation(module.createTranslator({}, 'nl').translateString)
  text.data = 'React updated this text'
  stop()
  assert.equal(text.data, 'React updated this text')
})

function languageHarness({ saved, locales = ['nl-NL'], email = null, profile = 'en', profileResult, storageError = false, profileError = null, updateError = null, authError = null } = {}) {
  const slots = []
  const pendingEffects = []
  let index = 0
  let changed = false
  let listener
  let unsubscribed = 0
  let profileReads = 0
  const writes = []
  const warnings = []
  const storage = new Map(saved ? [['spl-language', saved]] : [])
  const equalDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useContext: () => null,
    useState(initial) {
      const id = index++
      if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial
      return [slots[id], (value) => { slots[id] = typeof value === 'function' ? value(slots[id]) : value; changed = true }]
    },
    useRef(initial) { const id = index++; return slots[id] ??= { current: initial } },
    useMemo(fn, deps) {
      const id = index++
      if (!slots[id] || !equalDeps(slots[id].deps, deps)) slots[id] = { deps, value: fn() }
      return slots[id].value
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
    useEffect(fn, deps) {
      const id = index++
      if (!slots[id] || !equalDeps(slots[id].deps, deps)) {
        pendingEffects.push(() => { slots[id]?.cleanup?.(); slots[id] = { deps, cleanup: fn() } })
      }
    },
  }
  const client = {
    auth: {
      getUser: async () => ({ data: { user: email ? { email } : null }, error: authError }),
      onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() { unsubscribed++ } } } } },
    },
    from(table) {
      assert.equal(table, 'proffiles')
      return {
        select(column) {
          assert.equal(column, 'preferred_language')
          return { eq(key, value) {
            assert.equal(key, 'email')
            assert.ok(value)
            profileReads++
            return { maybeSingle: () => profileResult ?? Promise.resolve({ data: { preferred_language: profile }, error: profileError }) }
          } }
        },
        update(value) { return { eq: async (key, address) => { writes.push({ key, address, ...value }); return { error: updateError } } } },
      }
    },
  }
  const document = { documentElement: { lang: '' } }
  const module = loadModule('components\\language-provider.tsx', {
    react,
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/i18n/dom-translator': { createTranslator, startDomTranslation: () => () => {} },
  }, {
    document,
    navigator: { languages: locales, language: locales[0] },
    window: { alert() {}, localStorage: {
      getItem: (key) => { if (storageError) throw new Error('Storage unavailable'); return storage.get(key) ?? null },
      setItem: (key, value) => { if (storageError) throw new Error('Storage unavailable'); storage.set(key, value) },
    } },
    console: { warn: (...args) => warnings.push(args), error: console.error },
  })
  let value
  function render() {
    index = 0
    changed = false
    value = module.LanguageProvider({ children: null }).props.value
    pendingEffects.splice(0).forEach((fn) => fn())
  }
  render()
  return {
    get value() { return value },
    get reads() { return profileReads },
    get unsubscribed() { return unsubscribed },
    storage, writes, warnings, document,
    emit(session) { return listener('SIGNED_IN', session) },
    async flush() {
      for (let i = 0; i < 4; i++) { await new Promise((resolve) => setTimeout(resolve, 5)); if (changed) render() }
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()) },
  }
}

test('provider loads profile preference by email, persists manual changes and cleans auth subscription', async () => {
  const harness = languageHarness({ saved: 'nl', email: 'player@example.nl', profile: 'en' })
  await harness.flush()
  assert.equal(harness.value.language, 'en')
  assert.equal(harness.reads, 1)
  harness.value.setLanguage('nl')
  await harness.flush()
  assert.equal(harness.document.documentElement.lang, 'nl')
  assert.equal(harness.storage.get('spl-language'), 'nl')
  assert.deepEqual(harness.writes, [{ key: 'email', address: 'player@example.nl', preferred_language: 'nl' }])
  harness.unmount()
  assert.equal(harness.unsubscribed, 1)
})

test('provider guest defaults, saved preferences and inaccessible storage remain usable', async () => {
  for (const [options, expected] of [[{}, 'nl'], [{ saved: 'sk' }, 'sk'], [{ saved: 'bad' }, 'nl'], [{ storageError: true }, 'nl']]) {
    const harness = languageHarness(options)
    await harness.flush()
    assert.equal(harness.value.language, expected)
    harness.unmount()
  }
})

test('manual change wins an in-flight profile read; auth callback is synchronous and deferred', async () => {
  let resolve
  const profileResult = new Promise((done) => { resolve = done })
  const harness = languageHarness({ email: 'player@example.nl', profileResult })
  await harness.flush()
  harness.value.setLanguage('nl')
  resolve({ data: { preferred_language: 'sk' }, error: null })
  await harness.flush()
  assert.equal(harness.value.language, 'nl')
  const reads = harness.reads
  assert.equal(harness.emit({ user: { email: 'player@example.nl' } }), undefined)
  assert.equal(harness.reads, reads)
  await harness.flush()
  harness.unmount()
})

test('profile errors are reported and late auth/profile work is cancelled on cleanup', async () => {
  const failure = languageHarness({ email: 'player@example.nl', profileError: { message: 'column missing' } })
  await failure.flush()
  assert.equal(failure.value.language, 'nl')
  assert.equal(failure.warnings.length, 1)
  failure.unmount()
  const pending = languageHarness()
  assert.equal(pending.emit({ user: { email: 'player@example.nl' } }), undefined)
  pending.unmount()
  await pending.flush()
  assert.equal(pending.reads, 0)
  assert.equal(pending.unsubscribed, 1)
})

test('switching authenticated accounts loads the new profile instead of copying a previous manual choice', async () => {
  const harness = languageHarness({ email: 'first@example.nl', profile: 'en' })
  await harness.flush()
  harness.value.setLanguage('nl')
  await harness.flush()
  assert.equal(harness.value.language, 'nl')
  harness.emit({ user: { email: 'second@example.nl' } })
  await harness.flush()
  assert.equal(harness.value.language, 'en')
  assert.equal(harness.writes.length, 1)
  assert.equal(harness.writes[0].address, 'first@example.nl')
  harness.unmount()
})

test('failed profile persistence is explicit without undoing the manual language choice', async () => {
  const harness = languageHarness({ email: 'player@example.nl', updateError: { message: 'update denied' } })
  await harness.flush()
  harness.value.setLanguage('nl')
  await harness.flush()
  assert.equal(harness.value.language, 'nl')
  assert.equal(harness.warnings.length, 1)
  harness.unmount()
})

test('an expected missing guest auth session does not emit a warning', async () => {
  const harness = languageHarness({ authError: { name: 'AuthSessionMissingError', message: 'Auth session missing!' } })
  await harness.flush()
  assert.equal(harness.value.language, 'nl')
  assert.equal(harness.warnings.length, 0)
  assert.equal(harness.reads, 0)
  harness.unmount()
})
