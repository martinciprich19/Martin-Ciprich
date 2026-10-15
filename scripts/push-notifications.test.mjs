import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import { createPrivateKey, generateKeyPairSync } from 'node:crypto'

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const tokenA = 'alice-device-token-1234567890'
const tokenB = 'bob-device-token-1234567890'

async function loadModule(path, imports, globals = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const context = vm.createContext({ console, URL, Request, Response, Buffer, crypto, setTimeout, clearTimeout, ...globals })
  const mocked = new Map()
  async function link(name) {
    assert.ok(name in imports, `Unexpected import: ${name}`)
    if (!mocked.has(name)) {
      const values = imports[name]
      const module = new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value)
      }, { context })
      await module.link(() => {})
      await module.evaluate()
      mocked.set(name, module)
    }
    return mocked.get(name)
  }
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context, importModuleDynamically: link })
  await module.link(link)
  await module.evaluate()
  return module.namespace
}

test('localhost notifications require explicit permission and never replace configured or production FCM', async () => {
  const values = new Map()
  let configured = false
  let permission = 'default'
  let requested = 0
  const displayed = []
  const window = { location: { hostname: 'localhost' }, isSecureContext: true }
  class NotificationMock {
    static get permission() { return permission }
    static async requestPermission() { requested++; return permission }
    constructor(title, options) { displayed.push({ title, options }) }
  }
  window.Notification = NotificationMock
  const env = { NODE_ENV: 'development' }
  const module = await loadModule('../lib/local-notifications.ts', {
    './firebase-client': { isFirebasePushConfigured: () => configured },
  }, {
    window, Notification: NotificationMock, process: { env },
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
  })
  assert.equal(module.isLocalNotificationMode(), true)
  assert.equal(requested, 0)
  await assert.rejects(module.enableLocalNotifications(alice), /nebolo udelené/)
  permission = 'denied'
  await assert.rejects(module.enableLocalNotifications(alice), /zablokované/)
  permission = 'granted'
  await module.enableLocalNotifications(alice)
  assert.equal(module.localNotificationsEnabled(alice), true)
  assert.equal(module.localNotificationsEnabled(bob), false)
  module.testLocalNotification(alice, 'Local test')
  assert.equal(displayed.length, 1)
  assert.equal(displayed[0].options.body, 'Local test')
  module.disableLocalNotifications(alice)
  assert.equal(module.localNotificationsEnabled(alice), false)
  assert.throws(() => module.testLocalNotification(alice, 'Local test'), /Najprv/)
  configured = true
  assert.equal(module.isLocalNotificationMode(), false)
  await assert.rejects(module.enableLocalNotifications(alice), /iba pri vývoji/)
  configured = false
  env.NODE_ENV = 'production'
  assert.equal(module.isLocalNotificationMode(), false)
  env.NODE_ENV = 'development'
  window.location.hostname = '192.168.1.10'
  assert.equal(module.isLocalNotificationMode(), false)
  assert.equal(displayed.length, 1)
})

test('049 isolates tokens, handles shared devices, rate limits tests and resolves recipients', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, service_role;
      grant execute on function auth.uid() to authenticated, service_role;
      create table proffiles(id bigint primary key, email text, settings jsonb);
      create table notifications(id uuid primary key, user_id text, type text, message text);
      insert into auth.users values ('${alice}', 'alice@example.test'), ('${bob}', 'bob@example.test');
      insert into proffiles values (1, 'alice@example.test', '{}'), (2, 'bob@example.test', '{}');
      insert into notifications values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '1', 'challenge_request', 'Challenge'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${bob}', 'message', 'Message'),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', null, 'news', 'News');
    `)
    const migration = await readFile(new URL('./049_web_push_notifications.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${alice}'`)
    await assert.rejects(db.query('select register_push_token($1)', ['short']), /Neplatny/)
    await db.query('select register_push_token($1)', [tokenA])
    await db.query('select register_push_token($1)', [tokenA])
    assert.equal((await db.query('select count(*)::integer as n from user_push_tokens')).rows[0].n, 1)
    await assert.rejects(db.query('insert into user_push_tokens(token,user_id) values ($1,$2)', [tokenB, bob]), /permission denied/)
    await assert.rejects(db.query('select push_notification_tokens($1)', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']), /permission denied/)
    assert.equal((await db.query('select reserve_push_test() as token')).rows[0].token, tokenA)
    await assert.rejects(db.query('select reserve_push_test()'), /o minutu/)
    await db.exec(`set request.jwt.claim.sub = '${bob}'`)
    assert.equal((await db.query('select * from user_push_tokens')).rows.length, 0)
    await db.query('delete from user_push_tokens where token = $1', [tokenA])
    await db.query('select register_push_token($1)', [tokenB])
    await db.exec('reset role')
    assert.equal((await db.query('select count(*)::integer as n from user_push_tokens')).rows[0].n, 2)
    await db.exec('set role service_role')
    assert.equal((await db.query('select push_notification_tokens($1) as token', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])).rows[0].token, tokenA)
    assert.equal((await db.query('select push_notification_tokens($1) as token', ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])).rows[0].token, tokenB)
    assert.equal((await db.query('select push_notification_tokens($1)', ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'])).rows.length, 2)
    await db.exec('reset role')
    await db.exec(`update proffiles set settings = '{"pushAlerts":false}' where id = 2`)
    await db.exec('set role service_role')
    assert.equal((await db.query('select push_notification_tokens($1)', ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])).rows.length, 0)
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${bob}'`)
    await db.query('select register_push_token($1, true)', [tokenB])
    await db.exec('reset role')
    assert.equal((await db.query('select settings from proffiles where id = 2')).rows[0].settings.pushAlerts, true)
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${bob}'`)
    await db.query('select register_push_token($1)', [tokenA])
    await db.exec('reset role')
    assert.equal((await db.query('select user_id from user_push_tokens where token = $1', [tokenA])).rows[0].user_id, bob)
    await db.exec(`set role authenticated; set request.jwt.claim.sub = ''`)
    await assert.rejects(db.query('select register_push_token($1)', [tokenA]), /Prihlasenie/)
    await db.exec('set role anon')
    await assert.rejects(db.query('select * from user_push_tokens'), /permission denied/)
  } finally { await db.close() }
})

test('service worker displays exactly once, handles foreground and keeps clicks local', async () => {
  const code = await readFile(new URL('../public/firebase-messaging-sw.js', import.meta.url), 'utf8')
  const listeners = {}
  const displayed = []
  let background
  let opened
  const origin = 'https://riva.example'
  const self = {
    location: { origin, href: `${origin}/firebase-messaging-sw.js?config=${encodeURIComponent(JSON.stringify({ apiKey: 'public', projectId: 'riva', appId: 'app', messagingSenderId: '123' }))}` },
    addEventListener: (type, callback) => { listeners[type] = callback },
    registration: { showNotification: async (title, options) => { displayed.push({ title, options }) } },
    clients: { matchAll: async () => [], openWindow: async (url) => { opened = url } },
    skipWaiting: async () => {},
  }
  vm.runInNewContext(code, {
    self, URL, importScripts: () => {},
    firebase: { initializeApp: () => {}, messaging: () => ({ onBackgroundMessage: (cb) => { background = cb } }) },
  })
  await background({ data: { title: 'Match', body: 'Confirm', id: 'one' } })
  assert.equal(displayed.length, 1)
  assert.equal(displayed[0].options.data.url, '/profile#messages')
  await background({ notification: { title: 'Automatic FCM display' } })
  assert.equal(displayed.length, 1)
  let pending
  listeners.message({ data: { type: 'RIVA_PUSH_FOREGROUND', payload: { notification: { title: 'Foreground' } } }, waitUntil: (p) => { pending = p } })
  await pending
  assert.equal(displayed[1].title, 'Foreground')
  const click = (url) => ({ notification: { close() {}, data: { url } }, stopImmediatePropagation() {}, waitUntil: (p) => { pending = p } })
  listeners.notificationclick(click('https://attacker.example'))
  assert.equal(opened, undefined)
  listeners.notificationclick(click('/profile#messages'))
  await pending
  assert.equal(opened, `${origin}/profile#messages`)
})

test('test API requires same-origin authentication and sends only reserved account tokens', async () => {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' })
  let signedIn = true
  let delivered
  let reserveError = null
  let tokens = [tokenA]
  let failed = 0
  let reservations = 0
  const env = {
    FIREBASE_PROJECT_ID: 'test-project', FIREBASE_CLIENT_EMAIL: 'test@example.invalid',
    FIREBASE_PRIVATE_KEY: privateKey, NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  }
  const rpc = async (name) => {
    assert.equal(name, 'reserve_push_test')
    reservations++
    return { data: tokens, error: reserveError }
  }
  const route = await loadModule('../app/api/push/test/route.ts', {
    'node:crypto': { createPrivateKey },
    'next/server': { NextResponse: Response },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: alice } : null }, error: null }) }, rpc }) },
    '@/lib/firebase-admin': {
      getAdminMessaging() {}, createPushAdminClient() {},
      deliverPush: async (tokens) => { delivered = tokens; return { sent: 1, failed } },
    },
  }, { process: { env } })
  const request = (origin = 'https://riva.example') => new Request('https://riva.example/api/push/test', { method: 'POST', headers: { origin } })
  assert.equal((await route.POST(request('https://attacker.example'))).status, 403)
  signedIn = false
  assert.equal((await route.POST(request())).status, 401)
  signedIn = true
  env.FIREBASE_CLIENT_EMAIL = ''
  env.FIREBASE_PRIVATE_KEY = ' '
  const missing = await route.POST(request())
  assert.equal(missing.status, 503)
  const missingBody = await missing.json()
  assert.equal(missingBody.code, 'PUSH_CONFIG_MISSING')
  assert.deepEqual(missingBody.missingVariables, ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'])
  assert.match(missingBody.error, /FIREBASE_CLIENT_EMAIL.*FIREBASE_PRIVATE_KEY/)
  assert.ok(!JSON.stringify(missingBody).includes('test-service-key'))
  assert.equal(reservations, 0)
  env.FIREBASE_CLIENT_EMAIL = 'test@example.invalid'
  env.FIREBASE_PRIVATE_KEY = 'test-private-key'
  const invalid = await route.POST(request())
  assert.equal(invalid.status, 503)
  const invalidBody = await invalid.json()
  assert.equal(invalidBody.code, 'PUSH_PRIVATE_KEY_INVALID')
  assert.ok(!JSON.stringify(invalidBody).includes('test-private-key'))
  assert.equal(reservations, 0)
  env.FIREBASE_PRIVATE_KEY = privateKey.replaceAll('\n', '\\n')
  const result = await route.POST(request())
  assert.equal(result.status, 200)
  assert.equal((await result.json()).sent, 1)
  assert.equal(delivered[0], tokenA)
  env.FIREBASE_PRIVATE_KEY = privateKey
  reserveError = { code: 'P0001', message: 'Wait a minute' }
  assert.equal((await route.POST(request())).status, 429)
  reserveError = null
  reserveError = { code: 'PGRST202', message: 'Missing function' }
  const schema = await route.POST(request())
  assert.equal(schema.status, 503)
  assert.equal((await schema.json()).code, 'PUSH_SCHEMA_MISSING')
  reserveError = null
  tokens = []
  assert.equal((await route.POST(request())).status, 409)
  tokens = [tokenA]
  failed = 1
  assert.equal((await route.POST(request())).status, 502)
})

test('send-push exposes the same authenticated and validated webhook handler', async () => {
  const handler = async () => Response.json({ sent: 1, failed: 0 })
  const route = await loadModule('../app/api/send-push/route.ts', {
    '@/app/api/push/webhook/route': { POST: handler },
  })
  assert.equal(route.runtime, 'nodejs')
  assert.equal(route.POST, handler)
  assert.equal((await route.POST(new Request('https://riva.example/api/send-push', { method: 'POST' }))).status, 200)
})

test('webhook rejects unauthorized/invalid events and uses stored content and recipients', async () => {
  let delivered
  let bulk = false
  const ranges = []
  const route = await loadModule('../app/api/push/webhook/route.ts', {
    'node:crypto': await import('node:crypto'),
    'next/server': { NextResponse: Response },
    '@/lib/firebase-admin': {
      createPushAdminClient: () => ({
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { type: 'challenge_request', message: 'Stored challenge' }, error: null }) }) }) }),
        rpc: () => ({ range: async (start) => {
          ranges.push(start)
          return { data: bulk && start === 0 ? Array.from({ length: 1000 }, (_, index) => `device-${index}`) : [tokenA], error: null }
        } }),
      }),
      deliverPush: async (tokens, data) => { delivered = { tokens, data }; return { sent: 1, failed: 0 } },
    },
  }, { process: { env: { PUSH_WEBHOOK_SECRET: 'test-only-secret' } } })
  const request = (body, secret = 'test-only-secret') => new Request('https://riva.example/api/push/webhook', {
    method: 'POST', headers: { authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const event = { type: 'INSERT', schema: 'public', table: 'notifications', record: { id: 'one', message: 'Injected content', token: tokenB } }
  assert.equal((await route.POST(request(event, 'wrong'))).status, 401)
  assert.equal((await route.POST(request({ ...event, type: 'UPDATE' }))).status, 400)
  assert.equal((await route.POST(request(event))).status, 200)
  assert.equal(delivered.tokens[0], tokenA)
  assert.equal(delivered.data.body, 'Stored challenge')
  bulk = true
  assert.equal((await route.POST(request(event))).status, 200)
  assert.equal(delivered.tokens.length, 1001)
  assert.equal(ranges.at(-1), 1000)
})

test('client permission, token persistence, refresh errors and device opt-out', async () => {
  const stored = new Map()
  const order = []
  let rpcError = null
  let permission = 'granted'
  const sdk = {
    getToken: async () => { order.push('token'); return tokenA },
    deleteToken: async () => { order.push('delete-fcm'); return true },
  }
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: alice } }, error: null }) },
    rpc: async (name, args) => {
      assert.equal(name, 'register_push_token')
      assert.equal(args.p_token, tokenA)
      order.push('save'); return { error: rpcError }
    },
    from: () => ({ delete: () => ({ eq: () => ({ eq: async () => { order.push('delete-db'); return { error: null } } }) }) }),
  }
  const context = {
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
    window: { isSecureContext: true, Notification: {}, PushManager: {}, dispatchEvent() {} },
    navigator: { serviceWorker: {} },
    Notification: { requestPermission: async () => { order.push('permission'); return permission } },
    Event,
  }
  const client = await loadModule('../lib/notifications.ts', {
    '@/lib/supabase/client': { createClient: () => supabase },
    '@/lib/firebase-client': { getFirebasePushConfig: () => ({}), getFirebasePushClient: async () => ({ messaging: {}, registration: {}, vapidKey: 'public-key' }) },
    'firebase/messaging': sdk,
  }, context)
  const enabling = client.enablePushNotifications(alice)
  assert.equal(order[0], 'permission')
  await enabling
  assert.equal(client.getPushDevice().userId, alice)
  assert.equal(client.getPushDevice().token, tokenA)
  rpcError = new Error('database unavailable')
  await assert.rejects(client.refreshPushToken(alice), /database unavailable/)
  rpcError = null
  await client.disablePushNotifications()
  assert.equal(client.getPushDevice(), null)
  assert.ok(order.indexOf('delete-db') < order.indexOf('delete-fcm'))
  assert.equal(await client.refreshPushToken(alice, { restoreOnly: true }), null)
  permission = 'denied'
  await assert.rejects(client.enablePushNotifications(alice), /zablokované/)
  assert.equal(client.getPushDevice(), null)
  permission = 'default'
  await assert.rejects(client.enablePushNotifications(alice), /nebolo udelené/)
  context.window.isSecureContext = false
  await assert.rejects(client.enablePushNotifications(alice), /HTTPS/)
})

test('FCM delivery batches 500 devices, uses data-only payloads and removes expired tokens', async () => {
  const batches = []
  let deleted
  const messaging = {
    sendEachForMulticast: async (message) => {
      batches.push(message)
      const responses = message.tokens.map((token) => token === tokenA
        ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
        : { success: true })
      return { responses, successCount: responses.filter((r) => r.success).length, failureCount: responses.filter((r) => !r.success).length }
    },
  }
  const admin = await loadModule('../lib/firebase-admin.ts', {
    'server-only': {},
    'firebase-admin/app': { cert: () => ({}), getApps: () => [], initializeApp: () => ({}) },
    'firebase-admin/messaging': { getMessaging: () => messaging },
    '@supabase/supabase-js': { createClient: () => ({ from: () => ({ delete: () => ({ in: async (_column, tokens) => { deleted = tokens; return { error: null } } }) }) }) },
  }, { process: { env: {
    FIREBASE_PROJECT_ID: 'test-project', FIREBASE_CLIENT_EMAIL: 'test@example.test', FIREBASE_PRIVATE_KEY: 'mock-key',
    NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example', SUPABASE_SERVICE_ROLE_KEY: 'mock-key',
  } } })
  const tokens = [tokenA, ...Array.from({ length: 500 }, (_, index) => `token-${index}`)]
  const result = await admin.deliverPush(tokens, { title: 'Test', body: 'Body', id: 'event' })
  assert.equal(result.sent, 500)
  assert.equal(result.failed, 1)
  assert.equal(batches.length, 2)
  assert.equal(batches[0].tokens.length, 500)
  assert.equal(batches[1].tokens.length, 1)
  assert.equal(batches[0].notification, undefined)
  assert.equal(batches[0].data.title, 'Test')
  assert.equal(deleted[0], tokenA)
})
