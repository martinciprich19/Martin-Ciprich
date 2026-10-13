import { createClient } from '@/lib/supabase/client'
import { getFirebasePushConfig } from '@/lib/firebase-client'

export type ChallengeResponse = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'unavailable'

export type LeagueNotification = {
  id: string
  type: string
  senderId: string | null
  title: string
  body: string | null
  read: boolean
  createdAt: string
  challenge_id: string | null
  challengeResponse: ChallengeResponse
}

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205'])
let notificationsSchemaUnavailable = false
let notificationReceiptsUnavailable = false
let challengeResponseSchemaUnavailable = false

export async function fetchNotifications(userId: string | number): Promise<LeagueNotification[]> {
  if (notificationsSchemaUnavailable) return []
  const supabase = createClient()
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .or(`user_id.eq.${Number(userId)},user_id.is.null`)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    if (MISSING_SCHEMA_CODES.has(error.code)) {
      notificationsSchemaUnavailable = true
      return []
    }
    throw error
  }

  const globalNotificationIds = (data ?? [])
    .filter((row) => row.user_id == null)
    .map((row) => String(row.id))
  let globallyReadIds = new Set<string>()
  if (globalNotificationIds.length && !notificationReceiptsUnavailable) {
    const { data: receipts, error: receiptsError } = await supabase
      .from('notification_read_receipts')
      .select('notification_id')
      .eq('user_profile_id', Number(userId))
      .in('notification_id', globalNotificationIds)
    if (receiptsError) {
      if (MISSING_SCHEMA_CODES.has(receiptsError.code)) notificationReceiptsUnavailable = true
      else throw receiptsError
    } else {
      globallyReadIds = new Set((receipts ?? []).map((receipt) => String(receipt.notification_id)))
    }
  }

  const challengeIds = Array.from(new Set((data ?? [])
    .map((row) => String(row.challenge_id ?? '').trim())
    .filter((id) => /^[1-9]\d*$/.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))))
  const challengeResponses = new Map<string, ChallengeResponse>()
  if (challengeIds.length && !challengeResponseSchemaUnavailable) {
    const { data: challenges, error: challengesError } = await supabase
      .from('challenges')
      .select('id, status, challenger_2_id, challenged_1_id, challenged_2_id, challenger_2_accepted, challenged_1_accepted, challenged_2_accepted')
      .in('id', challengeIds)
    if (challengesError) {
      if (MISSING_SCHEMA_CODES.has(challengesError.code)) challengeResponseSchemaUnavailable = true
      else throw challengesError
    }

    for (const challenge of challenges ?? []) {
      const profileId = String(userId)
      const isTeammate = String(challenge.challenger_2_id) === profileId
      const isFirstOpponent = String(challenge.challenged_1_id) === profileId
      const isSecondOpponent = String(challenge.challenged_2_id) === profileId
      if (!isTeammate && !isFirstOpponent && !isSecondOpponent) continue
      const confirmed = isTeammate ? challenge.challenger_2_accepted
        : isFirstOpponent ? challenge.challenged_1_accepted : challenge.challenged_2_accepted
      const response: ChallengeResponse = challenge.status === 'declined' ? 'declined'
        : challenge.status === 'cancelled' ? 'cancelled'
        : confirmed ? 'confirmed'
        : challenge.status === 'pending' ? 'pending' : 'unavailable'
      challengeResponses.set(String(challenge.id), response)
    }
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    type: String(row.type ?? ''),
    senderId: row.sender_id == null ? null : String(row.sender_id),
    title: row.type === 'friend_request' ? 'Žiadosť o priateľstvo' : ['pair_challenge', 'challenge_request'].includes(String(row.type)) ? 'Nová výzva na zápas' : String(row.type ?? 'Notifikácia'),
    body: row.message ?? null,
    read: Boolean(row.is_read) || globallyReadIds.has(String(row.id)),
    createdAt: String(row.created_at ?? ''),
    challenge_id: row.challenge_id == null ? null : String(row.challenge_id).trim(),
    challengeResponse: challengeResponses.get(String(row.challenge_id ?? '').trim()) ?? 'unavailable',
  }))
}

export async function markNotificationRead(id: string) {
  const { error } = await createClient().from('notifications').update({ is_read: true }).eq('id', id)
  if (error && !MISSING_SCHEMA_CODES.has(error.code)) throw error
}

const PUSH_DEVICE_KEY = 'riva-push-device'
let pushMutation: Promise<unknown> = Promise.resolve()

function mutatePush<T>(action: () => Promise<T>): Promise<T> {
  const next = pushMutation.then(action, action)
  pushMutation = next
  return next
}

export function getPushDevice(): { userId: string; token: string } | null {
  const stored = localStorage.getItem(PUSH_DEVICE_KEY)
  if (!stored) return null
  const value: unknown = JSON.parse(stored)
  if (!value || typeof value !== 'object' || !('userId' in value) || typeof value.userId !== 'string'
    || !('token' in value) || typeof value.token !== 'string') {
    throw new Error('Neplatná lokálna registrácia push notifikácií.')
  }
  return { userId: value.userId, token: value.token }
}

export function refreshPushToken(userId: string, options: { restoreOnly?: boolean; enableAlerts?: boolean } = {}) {
  return mutatePush(async () => {
    if (options.restoreOnly && getPushDevice()?.userId !== userId) return null
    const { getFirebasePushClient } = await import('@/lib/firebase-client')
    const { getToken } = await import('firebase/messaging')
    const { messaging, registration, vapidKey } = await getFirebasePushClient()
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
    if (!token) throw new Error('Firebase nevrátil token pre push notifikácie.')
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) throw authError
    if (!user || user.id !== userId) throw new Error('Prihlásenie sa zmenilo. Skús zapnúť notifikácie znova.')
    const previous = getPushDevice()
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_enable_alerts: options.enableAlerts ?? false })
    if (error) throw error
    if (previous?.userId === userId && previous.token !== token) {
      const { error: deleteError } = await supabase.from('user_push_tokens').delete().eq('token', previous.token).eq('user_id', userId)
      if (deleteError) throw deleteError
    }
    localStorage.setItem(PUSH_DEVICE_KEY, JSON.stringify({ userId, token }))
    window.dispatchEvent(new Event('riva-push-changed'))
    return { messaging, registration }
  })
}

export async function enablePushNotifications(userId: string) {
  if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifikácie vyžadujú HTTPS a podporovaný prehliadač.')
  }
  getFirebasePushConfig()
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifikácie sú zablokované. Povoľ ich v nastaveniach prehliadača alebo systému.'
      : 'Povolenie notifikácií nebolo udelené.')
  }
  return refreshPushToken(userId, { enableAlerts: true })
}

export function disablePushNotifications() {
  return mutatePush(async () => {
    const device = getPushDevice()
    if (!device) return
    const { error } = await createClient().from('user_push_tokens').delete().eq('token', device.token).eq('user_id', device.userId)
    if (error) throw error
    localStorage.removeItem(PUSH_DEVICE_KEY)
    window.dispatchEvent(new Event('riva-push-changed'))
    const { getFirebasePushClient } = await import('@/lib/firebase-client')
    const { deleteToken } = await import('firebase/messaging')
    const { messaging } = await getFirebasePushClient()
    if (!await deleteToken(messaging)) throw new Error('Token bol odstránený z databázy, ale Firebase registráciu sa nepodarilo zrušiť.')
  })
}

export async function sendTestPushNotification() {
  const response = await fetch('/api/push/test', { method: 'POST' })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Testovaciu notifikáciu sa nepodarilo odoslať.')
  if (typeof result.sent !== 'number' || result.sent < 1) throw new Error('Server nepotvrdil odoslanie testovacej notifikácie.')
  return result.sent
}
