export function isFirebasePushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY
    && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    && process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
    && process.env.NEXT_PUBLIC_FIREBASE_APP_ID
    && process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY)
}

export function getFirebasePushConfig() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
  if (!config.apiKey || !config.projectId || !config.messagingSenderId || !config.appId || !vapidKey) {
    throw new Error('Push notifikácie ešte nie sú nakonfigurované. Správca musí doplniť Firebase nastavenia.')
  }
  return { config, vapidKey }
}

export async function getFirebasePushClient() {
  const { config, vapidKey } = getFirebasePushConfig()
  const [{ getApp, getApps, initializeApp }, { getMessaging, isSupported }] = await Promise.all([
    import('firebase/app'),
    import('firebase/messaging'),
  ])
  if (!await isSupported()) throw new Error('Tento prehliadač nepodporuje Firebase Web Push.')
  const app = getApps().some((app) => app.name === 'riva-push') ? getApp('riva-push') : initializeApp(config, 'riva-push')
  const registration = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?config=${encodeURIComponent(JSON.stringify(config))}`,
    { scope: '/firebase-cloud-messaging-push-scope/', updateViaCache: 'none' },
  )
  // This worker has a dedicated scope, so navigator.serviceWorker.ready may never resolve.
  const worker = registration.installing ?? registration.waiting
  if (!registration.active && worker) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.removeEventListener('statechange', changed)
        reject(new Error('Service Worker sa nespustil. Skús obnoviť stránku.'))
      }, 20000)
      function changed() {
        if (worker!.state !== 'activated' && worker!.state !== 'redundant') return
        clearTimeout(timeout)
        worker!.removeEventListener('statechange', changed)
        if (worker!.state === 'activated') resolve()
        else reject(new Error('Service Worker sa nepodarilo aktivovať.'))
      }
      worker.addEventListener('statechange', changed)
      changed()
    })
  }
  if (!registration.active) throw new Error('Push Service Worker nie je aktívny.')
  return { messaging: getMessaging(app), registration, vapidKey }
}
