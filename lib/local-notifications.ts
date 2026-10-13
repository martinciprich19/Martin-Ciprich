import { isFirebasePushConfigured } from './firebase-client'

export function isLocalNotificationMode() {
  return process.env.NODE_ENV === 'development'
    && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
    && !isFirebasePushConfigured()
}

function requireLocalMode() {
  if (!isLocalNotificationMode() || !window.isSecureContext || !('Notification' in window)) {
    throw new Error('Lokálne notifikácie sú dostupné iba pri vývoji na localhoste v podporovanom prehliadači.')
  }
}

export function localNotificationsEnabled(userId: string) {
  requireLocalMode()
  return localStorage.getItem(`riva-local-notifications-${userId}`) === 'enabled'
    && Notification.permission === 'granted'
}

export async function enableLocalNotifications(userId: string) {
  requireLocalMode()
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifikácie sú zablokované. Povoľ ich v nastaveniach prehliadača alebo systému.'
      : 'Povolenie notifikácií nebolo udelené.')
  }
  localStorage.setItem(`riva-local-notifications-${userId}`, 'enabled')
}

export function disableLocalNotifications(userId: string) {
  requireLocalMode()
  localStorage.removeItem(`riva-local-notifications-${userId}`)
}

export function testLocalNotification(userId: string, body: string) {
  if (!localNotificationsEnabled(userId)) throw new Error('Najprv zapni lokálne notifikácie.')
  const notification = new Notification('RIVA Padel', { body, tag: 'riva-local-test' })
  notification.onerror = (event) => {
    console.error('Lokálnu notifikáciu sa nepodarilo zobraziť:', event)
    window.dispatchEvent(new CustomEvent('riva-push-error', { detail: 'Prehliadač nedokázal zobraziť lokálnu notifikáciu.' }))
  }
  return notification
}
