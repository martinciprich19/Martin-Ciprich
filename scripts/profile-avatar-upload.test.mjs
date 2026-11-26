import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

const source = stripTypeScriptTypes(await readFile(new URL('../lib/profile-avatar.ts', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '').replace(/\bexport /g, '')
const userId = '00000000-0000-0000-0000-000000000001'
const base = 'https://storage.example.test/storage/v1/object/public'
const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })

function harness(initialUrl = `${base}/avatars/${userId}/avatar`) {
  const state = { profile: { id: 1, avatar_url: initialUrl }, objects: new Set(), failRemove: false, conflict: false, uncertainUpdate: false, uploads: [] }
  if (initialUrl) state.objects.add(initialUrl)
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: userId, email: 'player@example.test' } }, error: null }) },
    storage: { from(bucket) { return {
      getPublicUrl: path => ({ data: { publicUrl: `${base}/${bucket}/${path}` } }),
      async upload(path, uploaded, options) {
        state.uploads.push({ path, uploaded, options })
        state.objects.add(`${base}/${bucket}/${path}`)
        return { data: { path }, error: null }
      },
      async remove(paths) {
        if (state.failRemove) return { data: null, error: new Error('remove failed') }
        const removed = paths.filter(path => state.objects.delete(`${base}/${bucket}/${path}`))
        return { data: removed.map(name => ({ name })), error: null }
      },
    } } },
    from() {
      let changes, expected
      const query = {
        select() { return query },
        update(value) { changes = value; return query },
        eq(key, value) { if (key === 'avatar_url') expected = value; return query },
        is(key, value) { if (key === 'avatar_url') expected = value; return query },
        async maybeSingle() {
          if (!changes) return { data: { ...state.profile }, error: null }
          if (state.uncertainUpdate) {
            Object.assign(state.profile, changes)
            return { data: null, error: new Error('network error') }
          }
          if (state.conflict || state.profile.avatar_url !== expected) return { data: null, error: null }
          Object.assign(state.profile, changes)
          return { data: { id: 1 }, error: null }
        },
      }
      return query
    },
  }
  return { state, save: new Function('createClient', `${source}; return saveProfileAvatar`)(() => client) }
}

test('new uploads get distinct URLs and remove the previous owned avatar', async () => {
  const { state, save } = harness()
  const first = await save(file)
  const second = await save(file)
  assert.notEqual(first.url, second.url)
  assert.equal(first.cleanupWarning, false)
  assert.equal(second.cleanupWarning, false)
  assert.equal(state.profile.avatar_url, second.url)
  assert.deepEqual([...state.objects], [second.url])
  assert.ok(state.uploads.every(item => item.options.upsert === false && item.path.startsWith(`${userId}/avatar-`)))
})

test('supports an empty profile and removes the upload if the profile changed concurrently', async () => {
  const { state, save } = harness(null)
  const first = await save(file)
  assert.equal(first.cleanupWarning, false)
  state.conflict = true
  await assert.rejects(save(file), /medzitým zmenila/)
  assert.deepEqual([...state.objects], [first.url])
  assert.equal(state.profile.avatar_url, first.url)
})

test('reports cleanup failure without hiding the successfully saved new avatar', async () => {
  const { state, save } = harness()
  state.failRemove = true
  const originalError = console.error
  console.error = () => {}
  try {
    const result = await save(file)
    assert.equal(result.cleanupWarning, true)
    assert.equal(state.profile.avatar_url, result.url)
    assert.equal(state.objects.size, 2)
  } finally { console.error = originalError }
})

test('does not delete a potentially committed upload when the profile update outcome is uncertain', async () => {
  const { state, save } = harness()
  state.uncertainUpdate = true
  await assert.rejects(save(file), /nepodarilo potvrdiť/)
  assert.ok(state.objects.has(state.profile.avatar_url))
})
