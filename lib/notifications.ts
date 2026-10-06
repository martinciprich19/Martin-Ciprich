import { createClient } from '@/lib/supabase/client'

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
