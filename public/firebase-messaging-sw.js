/* global firebase */
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/profile#messages', self.location.origin)
  if (target.origin !== self.location.origin) return
  event.stopImmediatePropagation()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === target.origin && 'navigate' in client) {
        await client.navigate(target.href)
        return client.focus()
      }
    }
    return self.clients.openWindow(target.href)
  })())
})

function showPushNotification(payload, background = true) {
  // FCM displays notification payloads itself; our server sends data-only messages.
  if (background && payload.notification) return Promise.resolve()
  const data = { ...payload.notification, ...payload.data }
  return self.registration.showNotification(data.title || 'RIVA Padel', {
    body: data.body || '',
    icon: '/images/riva-padel-play-together-compact-icon-192.png',
    badge: '/images/riva-padel-play-together-compact-icon-192.png',
    tag: data.id || 'riva-padel',
    data: { url: '/profile#messages' },
  })
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'RIVA_PUSH_FOREGROUND') {
    event.waitUntil(showPushNotification(event.data.payload, false))
  }
})

importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js')

const config = JSON.parse(new URL(self.location.href).searchParams.get('config') || 'null')
if (!config?.apiKey || !config?.projectId || !config?.messagingSenderId || !config?.appId) {
  throw new Error('Missing public Firebase configuration for RIVA push notifications.')
}
firebase.initializeApp(config)
firebase.messaging().onBackgroundMessage(showPushNotification)
