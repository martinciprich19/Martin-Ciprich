import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

const source = stripTypeScriptTypes(await readFile(new URL('../lib/profile-avatar.ts', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '')
  .replace(/\bexport /g, '')
const userId = '00000000-0000-0000-0000-000000000001'
const base = 'https://storage.example.test/storage/v1/object/public'

function harness(bucket = 'avatars', path = `${userId}/avatar`) {
  const state = {
    profile: { id: 1, avatar_url: `${base}/${bucket}/${path}` },
    objects: new Set([`${bucket}/${path}`]),
    calls: [],
    skipDelete: false,
    failList: false,
    failRemove: false,
    failUpdate: false,
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: userId, email: 'player@example.test' } }, error: null }) },
    storage: { from(currentBucket) { return {
      getPublicUrl: (name) => ({ data: { publicUrl: `${base}/${currentBucket}/${name}` } }),
      async list(folder, { search }) {
        state.calls.push('list')
        if (state.failList) return { data: null, error: new Error('list failed') }
        return { data: state.objects.has(`${currentBucket}/${folder}/${search}`) ? [{ name: search, id: 'object-id' }] : [], error: null }
      },
      async remove(paths) {
        state.calls.push('remove')
        if (state.failRemove) return { error: new Error('remove failed') }
        if (!state.skipDelete) paths.forEach((value) => state.objects.delete(`${currentBucket}/${value}`))
        return { data: state.skipDelete ? [] : paths.map((name) => ({ name })), error: null }
      },
    } } },
    from() {
      let update = false
      let expectedUrl
      const query = {
        select() { return query },
        update() { update = true; return query },
        eq(key, value) { if (key === 'avatar_url') expectedUrl = value; return query },
        async maybeSingle() {
          if (!update) return { data: { ...state.profile }, error: null }
          state.calls.push('update')
          if (state.failUpdate) return { data: null, error: new Error('update failed') }
          if (state.profile.avatar_url !== expectedUrl) return { data: null, error: null }
          state.profile.avatar_url = null
          return { data: { id: 1 }, error: null }
        },
      }
      return query
    },
  }
  return { state, remove: new Function('createClient', `${source}; return removeProfileAvatar`)(() => client) }
}

test('removes the referenced current or legacy photo before clearing the profile', async () => {
  for (const [bucket, path] of [['avatars', `${userId}/avatar`], ['player-avatars', `${userId}/old/photo.png`]]) {
    const { state, remove } = harness(bucket, path)
    await remove()
    assert.equal(state.objects.size, 0)
    assert.equal(state.profile.avatar_url, null)
    assert.deepEqual(state.calls, ['list', 'remove', 'list', 'update'])
  }
})

test('does not clear the profile when storage fails or silently rejects deletion', async () => {
  for (const failure of ['failList', 'failRemove', 'skipDelete']) {
    const { state, remove } = harness()
    state[failure] = true
    await assert.rejects(remove())
    assert.notEqual(state.profile.avatar_url, null)
    assert.equal(state.calls.includes('update'), false)
  }
})

test('reports partial failure if the file was removed but the profile update failed', async () => {
  const { state, remove } = harness()
  state.failUpdate = true
  await assert.rejects(remove(), /Fotografia bola odstránená z úložiska/)
  assert.equal(state.objects.size, 0)
  assert.notEqual(state.profile.avatar_url, null)
  await assert.rejects(remove(), /nepodarilo nájsť alebo k nej nemáš prístup/)
})

test('does not clear the profile when storage listing hides the photo', async () => {
  const { state, remove } = harness()
  state.objects.clear()
  await assert.rejects(remove(), /nepodarilo nájsť alebo k nej nemáš prístup/)
  assert.notEqual(state.profile.avatar_url, null)
  assert.deepEqual(state.calls, ['list'])
})

test('rejects external URLs and other users paths without deleting anything', async () => {
  for (const url of ['https://other.example.test/photo.png', `${base}/avatars/other/avatar`]) {
    const { state, remove } = harness()
    state.profile.avatar_url = url
    await assert.rejects(remove())
    assert.equal(state.objects.size, 1)
    assert.deepEqual(state.calls, [])
  }
})

test('profile photo preview exposes a confirmed remove action', async () => {
  const page = await readFile(new URL('../app/profile/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /window\.confirm\(t\('Naozaj chceš odstrániť profilovú fotografiu\?'/)
  assert.match(page, /size="lg" onRemove=\{removeAvatar\}/)
  assert.match(page, /t\('Odstrániť fotografiu', 'Delete photo'\)/)
})
