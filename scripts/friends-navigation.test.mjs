import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(new URL('../app/profile/page.tsx', import.meta.url), 'utf8')
const view = readFileSync(new URL('../components/friends-view.tsx', import.meta.url), 'utf8')
const friendships = readFileSync(new URL('../lib/friendships.ts', import.meta.url), 'utf8')

test('friends navigation precedes messages and opens its own deep-linkable tab', () => {
  const nav = page.slice(page.indexOf('const navItems = ['), page.indexOf('const bottomNavItems = ['))
  assert.match(nav, /label: 'Priatelia', href: '\/profile\?view=friends'/)
  assert.ok(nav.indexOf("label: 'Priatelia'") < nav.indexOf("label: 'Správy'"))
  assert.match(page, /'Priatelia': 'friends'/)
  assert.match(page, /const tabsFromUrl: ProfileTab\[\] = \[[^\]]*'friends'/)
  assert.match(page, /activeTab === 'friends' \? <FriendsView myProfileId=\{player\.profile_id\}/)
  assert.match(page, /onMessage=\{openConversation\}/)
})

test('friends view fetches accepted friends, reports states, and links to profiles and messages', () => {
  assert.match(friendships.slice(friendships.indexOf('export async function fetchFriends'), friendships.indexOf('export async function fetchIncomingRequests')), /\.eq\('status', 'accepted'\)/)
  assert.match(view, /\['friends', myProfileId\]/)
  assert.match(view, /fetchFriends\(id\)/)
  assert.match(view, /role="status"/)
  assert.match(view, /role="alert"/)
  assert.match(view, /onClick=\{\(\) => void mutate\(\)\}/)
  assert.match(view, /communications-realtime-updated/)
  assert.match(view, /friends\.map\(\(friend\)/)
  assert.match(view, /href=\{`\/players\/\$\{friend\.id\}`\}/)
  assert.match(view, /onMessage\(friend\)/)
  assert.match(view, /onClick=\{onFindPlayers\}/)
})
