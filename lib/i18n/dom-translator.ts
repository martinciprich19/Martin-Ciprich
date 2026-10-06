import { uiPatterns, uiTranslations } from '@/lib/i18n/ui-translations'

const ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt'] as const
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'CODE'])

type Applied = { original: string; applied: string }

export function createTranslator(extra: Record<string, string>) {
  const lookup: Record<string, string> = { ...extra, ...uiTranslations }

  function translateString(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    const exact = lookup[trimmed]
    if (exact !== undefined) return value.replace(trimmed, () => exact)
    for (const [pattern, replacement] of uiPatterns) {
      if (pattern.test(trimmed)) return value.replace(trimmed, () => trimmed.replace(pattern, replacement))
    }
    return null
  }

  return { translateString }
}

// Translates rendered Slovak text/attributes to English in the live DOM and restores them when disabled.
export function startDomTranslation(translateString: (value: string) => string | null) {
  const textState = new WeakMap<Text, Applied>()
  const attrState = new WeakMap<Element, Map<string, Applied>>()
  const managedOptions = new WeakSet<Element>()
  const touchedTexts = new Set<WeakRef<Text>>()
  const touchedElements = new Set<WeakRef<Element>>()
  let enabled = true

  const isSkipped = (element: Element | null) => {
    for (let current = element; current; current = current.parentElement) {
      if (SKIPPED_TAGS.has(current.tagName) || current.getAttribute('translate') === 'no') return true
    }
    return false
  }

  function processText(node: Text) {
    if (isSkipped(node.parentElement)) return
    const state = textState.get(node)
    if (state && node.data === state.applied) return
    const translated = translateString(node.data)
    if (translated === null || translated === node.data) {
      textState.delete(node)
      return
    }
    const parent = node.parentElement
    if (parent?.tagName === 'OPTION' && (!parent.hasAttribute('value') || managedOptions.has(parent))) {
      parent.setAttribute('value', node.data.trim())
      managedOptions.add(parent)
    }
    textState.set(node, { original: node.data, applied: translated })
    touchedTexts.add(new WeakRef(node))
    node.data = translated
  }

  function processAttributes(element: Element) {
    if (isSkipped(element)) return
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name)
      if (value === null) continue
      const states = attrState.get(element)
      const state = states?.get(name)
      if (state && value === state.applied) continue
      const translated = translateString(value)
      if (translated === null || translated === value) {
        states?.delete(name)
        continue
      }
      const map = states ?? new Map<string, Applied>()
      map.set(name, { original: value, applied: translated })
      attrState.set(element, map)
      touchedElements.add(new WeakRef(element))
      element.setAttribute(name, translated)
    }
  }

  function walk(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) return processText(root as Text)
    if (root.nodeType !== Node.ELEMENT_NODE) return
    const element = root as Element
    processAttributes(element)
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) processText(node as Text)
      else processAttributes(node as Element)
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (!enabled) return
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') processText(mutation.target as Text)
      else if (mutation.type === 'attributes') processAttributes(mutation.target as Element)
      else mutation.addedNodes.forEach(walk)
    }
  })

  walk(document.body)
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] })

  return () => {
    enabled = false
    observer.disconnect()
    for (const ref of touchedTexts) {
      const node = ref.deref()
      const state = node && textState.get(node)
      if (node && state && node.data === state.applied) node.data = state.original
    }
    for (const ref of touchedElements) {
      const element = ref.deref()
      attrState.get(element as Element)?.forEach((state, name) => {
        if (element && element.getAttribute(name) === state.applied) element.setAttribute(name, state.original)
      })
    }
  }
}
