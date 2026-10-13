import 'server-only'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { createClient } from '@supabase/supabase-js'

export function createPushAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Chýba serverová konfigurácia Supabase pre push notifikácie.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function getAdminMessaging() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) throw new Error('Chýba serverová konfigurácia Firebase pre push notifikácie.')
  const app = getApps().find((app) => app.name === 'riva-push-server')
    ?? initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, 'riva-push-server')
  return getMessaging(app)
}

export async function deliverPush(tokens: string[], data: { title: string; body: string; id: string }) {
  const messaging = getAdminMessaging()
  const supabase = createPushAdminClient()
  let sent = 0
  let failed = 0
  for (let start = 0; start < tokens.length; start += 500) {
    const batch = tokens.slice(start, start + 500)
    const result = await messaging.sendEachForMulticast({
      tokens: batch,
      data,
      webpush: { headers: { TTL: '3600', Urgency: 'high' } },
    })
    sent += result.successCount
    failed += result.failureCount
    const invalid: string[] = []
    result.responses.forEach((response, index) => {
      if (response.success) return
      const code = response.error?.code
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        invalid.push(batch[index])
      } else {
        console.error('FCM delivery failed:', code, response.error?.message)
      }
    })
    if (invalid.length) {
      const { error } = await supabase.from('user_push_tokens').delete().in('token', invalid)
      if (error) throw error
    }
  }
  return { sent, failed }
}
