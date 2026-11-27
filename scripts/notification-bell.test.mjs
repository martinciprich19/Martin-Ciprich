import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (await readFile(new URL('../app/profile/page.tsx', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const callbackSource = source.slice(
  source.indexOf('  const markAllNotificationsRead = useCallback('),
  source.indexOf('\n\n  useEffect(() => {', source.indexOf('  const markAllNotificationsRead = useCallback(')),
)

function harness({ error = null, wait = null, profileId = 1 } = {}) {
  const state = {
    notifications: [{ id: 'one', read: false }, { id: 'two', read: false }],
    serverNotifications: [{ id: 'one', read: false }, { id: 'two', read: false }],
    calls: 0, error: false, rpcError: error, busy: false, ref: { current: false },
  }
  const mutateNotifications = async (update) => {
    if (update) state.notifications = update(state.notifications)
    else state.notifications = state.serverNotifications.map((item) => ({ ...item }))
  }
  const createClient = () => ({ rpc: async (name) => {
    assert.equal(name, 'mark_notifications_as_read')
    state.calls++
    if (wait) await wait
    if (!state.rpcError) state.serverNotifications = state.serverNotifications.map(item => ({ ...item, read: true }))
    return { error: state.rpcError }
  } })
  const save = new Function(
    'useCallback', 'markingNotificationsRef', 'player', 'setMarkingNotifications',
    'setNotificationReadError', 'mutateNotifications', 'createClient',
    `${callbackSource}\nreturn markAllNotificationsRead`,
  )(
    callback => callback, state.ref, { profile_id: profileId },
    value => { state.busy = value }, value => { state.error = value }, mutateNotifications, createClient,
  )
  return { state, save }
}

test('opening notifications marks the existing entries as read and refreshes the saved state', async () => {
  const { state, save } = harness()
  await save()
  assert.equal(state.calls, 1)
  assert.ok(state.notifications.every(item => item.read))
  assert.ok(state.serverNotifications.every(item => item.read))
  assert.equal(state.error, false)
  assert.equal(state.busy, false)
})

test('failure restores unread state and exposes an error; retry can succeed', async () => {
  const { state, save } = harness({ error: new Error('RPC failed') })
  const originalError = console.error
  console.error = () => {}
  try { await save() } finally { console.error = originalError }
  assert.equal(state.error, true)
  assert.ok(state.notifications.every(item => !item.read))
  assert.equal(state.ref.current, false)
  state.rpcError = null
  await save()
  assert.equal(state.error, false)
  assert.ok(state.notifications.every(item => item.read))
})

test('concurrent opens do not start duplicate updates', async () => {
  let release
  const wait = new Promise(resolve => { release = resolve })
  const { state, save } = harness({ wait })
  const first = save()
  await save()
  assert.equal(state.calls, 1)
  release()
  await first
  assert.equal(state.busy, false)
})

test('bell and notification tab trigger the read action and the badge is hidden on that tab', () => {
  const badge = source.match(/const showAlertBadge = ([\s\S]*?)\n  const unreadNotificationBatch/)
  assert.ok(badge)
  const visible = new Function('unreadAlertCount', 'communicationAlertsSeen', 'activeTab', 'messagesCategory', `return ${badge[1]}`)
  assert.equal(visible(2, false, 'overview', 'direct'), true)
  assert.equal(visible(2, false, 'messages', 'notifications'), false)
  assert.equal(visible(2, true, 'overview', 'direct'), false)
  assert.match(source, /function openNotifications\(\) \{\s*setCommunicationAlertsSeen\(true\)\s*void markAllNotificationsRead\(\)/)
  assert.match(source, /activeTab === 'messages' && messagesCategory === 'notifications'[\s\S]*?attemptedNotificationBatch\.current !== unreadNotificationBatch[\s\S]*?void markAllNotificationsRead\(\)/)
  assert.match(source, /notificationReadError \? <p role="alert"[\s\S]*?onClick=\{\(\) => void markAllNotificationsRead\(\)\}/)
})
