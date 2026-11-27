import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import * as jsxRuntime from 'react/jsx-runtime'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

function elements(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(elements)
  return [node, ...elements(node.props?.children)]
}

async function createView(props, sendPairInvitation = async () => {}) {
  await loadBindings()
  const { code } = await transform(await read('../components/pairs-view.tsx'), {
    filename: 'pairs-view.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  })
  const state = []
  let index = 0
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    console,
    require: (name) => {
      if (name === 'react/jsx-runtime') return jsxRuntime
      if (name === 'react') return { useState: (initial) => {
        const i = index++
        if (!(i in state)) state[i] = initial
        return [state[i], (value) => { state[i] = value }]
      } }
      if (name === 'swr') return (key) => ({
        data: key?.[0] === 'league-players' ? [{ id: 'friend' }] : key?.[0] === 'friends' ? [{ id: 'friend', name: 'Friend' }] : [],
        isLoading: false,
      })
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null })
      if (name === '@/components/language-provider') return { useLanguage: () => ({ t: (text) => text }) }
      if (name === '@/components/league-provider') return { useLeague: () => ({ country: 'SK', regions: [], isLoading: false }) }
      if (name === '@/lib/pairs') return { sendPairInvitation }
      if (name === '@/lib/friendships' || name === '@/lib/players') return {}
      if (name === '@/lib/errors') return { getErrorMessage: (error) => String(error) }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  return () => {
    index = 0
    const countryView = exports.PairsView(props)
    return elements(countryView.type(countryView.props))
  }
}

test('challenge button opens the pairs view with the invitation initially open', async () => {
  const [profile, challenge] = await Promise.all([
    read('../app/profile/page.tsx'),
    read('../components/pair-challenge-view.tsx'),
  ])
  assert.match(profile, /<PairsView initialInviteOpen\b/)
  assert.match(profile, /onOpenPairs=\{\(\) => setShowPairsView\(true\)\}/)
  assert.match(challenge, /onClick=\{onOpenPairs\} disabled=\{!userId\}/)
  const render = await createView({ currentPlayerId: 'player', initialInviteOpen: true })
  assert.ok(render().find((element) => element.type === 'form'))
})

test('invitation can be closed, reopened, and submitted', async () => {
  const sent = []
  const render = await createView(
    { currentPlayerId: 'player', initialInviteOpen: true },
    async (friendId) => { sent.push(friendId) },
  )
  render().find((element) => element.props?.['aria-label'] === 'Zavrieť').props.onClick()
  assert.equal(render().some((element) => element.type === 'form'), false)
  render().find((element) => element.type === 'button' && element.props.children?.includes('Pozvať priateľa do dvojice')).props.onClick()
  const select = render().find((element) => element.type === 'select' && element.props.required)
  select.props.onChange({ target: { value: 'friend' } })
  await render().find((element) => element.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(sent, ['friend'])
  assert.equal(render().some((element) => element.type === 'form'), false)
  assert.ok(render().find((element) => element.props?.role === 'status' && element.props.children === 'Žiadosť o vytvorenie dvojice bola odoslaná.'))
})

test('default and missing player do not open an invitation; a new view opens it again', async () => {
  for (const props of [{ currentPlayerId: 'player' }, { currentPlayerId: null, initialInviteOpen: true }]) {
    const render = await createView(props)
    assert.equal(render().some((element) => element.type === 'form'), false)
  }
  const render = await createView({ currentPlayerId: 'player', initialInviteOpen: true })
  assert.ok(render().find((element) => element.type === 'form'))
})
