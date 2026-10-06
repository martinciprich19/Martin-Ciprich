import { createClient } from '@/lib/supabase/client'

export type FriendshipStatus = 'none' | 'pending_sent' | 'pending_received' | 'accepted'

export type Friend = { id: string; name: string; region: string; elo: number }
export type FriendRequest = { friendshipId: string; fromId: string; fromName: string }

type FriendshipRow = { id: number | string; user_id: number | string; friend_id: number | string; status: string }
type ProfileRow = { id: number | string; full_name: string | null; region: string | null; elo_rating: number | null }

function toId(value: string | number) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Neplatné ID hráča.')
  return id
}

export async function fetchFriendshipStatus(myId: string | number, otherId: string | number): Promise<FriendshipStatus> {
  const me = toId(myId)
  const other = toId(otherId)
  const { data, error } = await createClient()
    .from('friendships')
    .select('id, user_id, friend_id, status')
    .or(`and(user_id.eq.${me},friend_id.eq.${other}),and(user_id.eq.${other},friend_id.eq.${me})`)
    .limit(1)
  if (error) throw error
  const row = (data as FriendshipRow[] | null)?.[0]
  if (!row) return 'none'
  if (row.status === 'accepted') return 'accepted'
  return Number(row.user_id) === me ? 'pending_sent' : 'pending_received'
}

export async function fetchFriendshipStatuses(myId: string | number): Promise<Record<string, FriendshipStatus>> {
  const me = toId(myId)
  const { data, error } = await createClient()
    .from('friendships')
    .select('user_id, friend_id, status')
    .or(`user_id.eq.${me},friend_id.eq.${me}`)
  if (error) throw error

  const statuses: Record<string, FriendshipStatus> = {}
  for (const row of (data ?? []) as Pick<FriendshipRow, 'user_id' | 'friend_id' | 'status'>[]) {
    const isSender = Number(row.user_id) === me
    const otherId = String(isSender ? row.friend_id : row.user_id)
    const status: FriendshipStatus = row.status === 'accepted' ? 'accepted' : isSender ? 'pending_sent' : 'pending_received'
    if (statuses[otherId] !== 'accepted') statuses[otherId] = status
  }
  return statuses
}

export async function sendFriendRequest(myId: string | number, friendId: string | number) {
  const me = toId(myId)
  const friend = toId(friendId)
  if (me === friend) throw new Error('Nemôžeš pridať sám seba.')
  if (await fetchFriendshipStatus(me, friend) !== 'none') throw new Error('Žiadosť o priateľstvo už existuje.')
  const supabase = createClient()

  const { error } = await supabase.from('friendships').insert({ user_id: me, friend_id: friend, status: 'pending' })
  if (error) throw error

  const { data: profile } = await supabase.from('proffiles').select('full_name').eq('id', me).maybeSingle()
  const name = (profile as { full_name: string | null } | null)?.full_name?.trim() || 'Hráč'
  const { error: notificationError } = await supabase.from('notifications').insert({
    user_id: friend,
    sender_id: me,
    type: 'friend_request',
    message: `${name} ti poslal(a) žiadosť o priateľstvo.`,
    is_read: false,
  })
  if (notificationError) {
    console.error('Notifikáciu o žiadosti o priateľstvo sa nepodarilo vytvoriť:', notificationError.message)
    throw notificationError
  }
}

async function fetchProfiles(ids: number[]): Promise<ProfileRow[]> {
  if (!ids.length) return []
  const { data, error } = await createClient().from('proffiles').select('id, full_name, region, elo_rating').in('id', ids)
  if (error) throw error
  return (data ?? []) as ProfileRow[]
}

export async function fetchFriends(myId: string | number): Promise<Friend[]> {
  const me = toId(myId)
  const { data, error } = await createClient()
    .from('friendships')
    .select('id, user_id, friend_id, status')
    .eq('status', 'accepted')
    .or(`user_id.eq.${me},friend_id.eq.${me}`)
  if (error) throw error
  const ids = Array.from(new Set(((data ?? []) as FriendshipRow[]).map((row) => Number(row.user_id) === me ? Number(row.friend_id) : Number(row.user_id))))
  return (await fetchProfiles(ids))
    .map((row) => ({ id: String(row.id), name: row.full_name?.trim() || 'Hráč', region: row.region ?? '', elo: Number(row.elo_rating ?? 1000) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sk'))
}

export async function fetchIncomingRequests(myId: string | number): Promise<FriendRequest[]> {
  const me = toId(myId)
  const { data, error } = await createClient().from('friendships').select('id, user_id, friend_id, status').eq('friend_id', me).eq('status', 'pending')
  if (error) throw error
  const rows = (data ?? []) as FriendshipRow[]
  const profiles = await fetchProfiles(rows.map((row) => Number(row.user_id)))
  return rows.map((row) => ({
    friendshipId: String(row.id),
    fromId: String(row.user_id),
    fromName: profiles.find((profile) => Number(profile.id) === Number(row.user_id))?.full_name?.trim() || 'Hráč',
  }))
}

export async function respondToFriendRequest(friendshipId: string, accept: boolean) {
  const supabase = createClient()
  const { error } = accept
    ? await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId)
    : await supabase.from('friendships').delete().eq('id', friendshipId)
  if (error) throw error
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('communications-updated'))
}

export async function removeFriendship(myId: string | number, friendId: string | number): Promise<void> {
  const me = toId(myId)
  const friend = toId(friendId)
  if (me === friend) throw new Error('Nemôžeš odstrániť sám seba z priateľov.')

  const supabase = createClient()
  const { data: deleted, error: deleteError } = await supabase
    .from('friendships')
    .delete()
    .eq('status', 'accepted')
    .or(`and(user_id.eq.${me},friend_id.eq.${friend}),and(user_id.eq.${friend},friend_id.eq.${me})`)
    .select('id')
  
  if (deleteError) throw deleteError
  if (!deleted?.length) throw new Error('Priateľstvo sa nepodarilo odstrániť.')

  if (typeof window !== 'undefined') window.dispatchEvent(new Event('communications-updated'))
}
