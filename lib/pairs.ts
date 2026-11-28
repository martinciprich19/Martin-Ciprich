import { createClient } from '@/lib/supabase/client'
import type { CountryCode } from '@/lib/countries'

export type PlayerPair = {
  id: string
  player_1_id: string
  player_2_id: string
  player_1: PairPlayer
  player_2: PairPlayer
  created_at: string | null
  country_code: CountryCode
}

export type PairPlayer = { full_name: string; region: string; elo: number; matches_played: number; matches_won: number }
export type PairInvitation = { id: string; inviterId: string; inviterName: string; createdAt: string }
export type FriendPairStatus = 'paired' | 'invited' | 'incoming'

const PAIR_INVITATIONS_SCHEMA_CODES = new Set(['42P01', '42703', '42883', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205'])
const PAIR_INVITATIONS_SCHEMA_MESSAGE = 'Pozvania do dvojice nie sú v databáze nastavené. Spusti migráciu scripts/020_pair_invitations.sql v Supabase.'

type PairPlayerRow = { full_name: string | null; region: string | null; elo_rating: number | null; matches_played: number | null; matches_won: number | null }
type PairRow = {
  country_code: CountryCode
  id: string | number
  player_1_id: string | number
  player_2_id: string | number
  player_1: PairPlayerRow | PairPlayerRow[] | null
  player_2: PairPlayerRow | PairPlayerRow[] | null
  created_at: string | null
}

function firstPlayer(value: PairPlayerRow | PairPlayerRow[] | null): PairPlayerRow | null {
  return Array.isArray(value) ? value[0] ?? null : value
}

function toPairPlayer(row: PairPlayerRow | null): PairPlayer {
  return { full_name: row?.full_name ?? 'Hráč', region: row?.region ?? '', elo: row?.elo_rating ?? 1000, matches_played: row?.matches_played ?? 0, matches_won: row?.matches_won ?? 0 }
}

export async function fetchPairs(country?: CountryCode): Promise<PlayerPair[]> {
  let query = createClient()
    .from('pairs')
    .select('id, country_code, player_1_id, player_2_id, created_at, player_1:proffiles!pairs_player_1_id_fkey(full_name, region, elo_rating, matches_played, matches_won), player_2:proffiles!pairs_player_2_id_fkey(full_name, region, elo_rating, matches_played, matches_won)')
  if (country) query = query.eq('country_code', country)
  const { data, error } = await query
    .order('created_at', { ascending: false })

  if (error) throw error

  return ((data ?? []) as unknown as PairRow[]).map((row) => {
    const player1 = firstPlayer(row.player_1)
    const player2 = firstPlayer(row.player_2)
    return {
      id: String(row.id),
      player_1_id: String(row.player_1_id),
      player_2_id: String(row.player_2_id),
      player_1: toPairPlayer(player1),
      player_2: toPairPlayer(player2),
      created_at: row.created_at,
      country_code: row.country_code,
    }
  })
}

export async function fetchFriendPairStatuses(profileId: number): Promise<Record<string, FriendPairStatus>> {
  if (!Number.isSafeInteger(profileId) || profileId <= 0) throw new Error('Neplatné ID hráča.')
  const client = createClient()
  const statuses: Record<string, FriendPairStatus> = {}
  const pageSize = 500
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await client.from('pair_invitations')
      .select('id, inviter_id, invitee_id')
      .eq('status', 'pending')
      .or(`inviter_id.eq.${profileId},invitee_id.eq.${profileId}`)
      .order('id').range(start, start + pageSize - 1)
    if (error) {
      if (PAIR_INVITATIONS_SCHEMA_CODES.has(error.code)) throw new Error(PAIR_INVITATIONS_SCHEMA_MESSAGE)
      throw error
    }
    const rows = data ?? []
    for (const row of rows) {
      const outgoing = Number(row.inviter_id) === profileId
      statuses[String(outgoing ? row.invitee_id : row.inviter_id)] = outgoing ? 'invited' : 'incoming'
    }
    if (rows.length < pageSize) break
  }
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await client.from('pairs')
      .select('id, player_1_id, player_2_id')
      .or(`player_1_id.eq.${profileId},player_2_id.eq.${profileId}`)
      .order('id').range(start, start + pageSize - 1)
    if (error) throw error
    const rows = data ?? []
    for (const row of rows) {
      statuses[String(Number(row.player_1_id) === profileId ? row.player_2_id : row.player_1_id)] = 'paired'
    }
    if (rows.length < pageSize) break
  }
  return statuses
}

export async function sendPairInvitation(inviteeId: string): Promise<void> {
  const { error } = await createClient().rpc('create_pair_invitation', { p_invitee_id: Number(inviteeId) })
  if (error) {
    if (PAIR_INVITATIONS_SCHEMA_CODES.has(error.code)) throw new Error(PAIR_INVITATIONS_SCHEMA_MESSAGE)
    throw error
  }
}

export async function deletePair(pairId: string): Promise<void> {
  const { error } = await createClient().rpc('delete_my_pair', { p_pair_id: pairId })
  if (error) {
    if (PAIR_INVITATIONS_SCHEMA_CODES.has(error.code)) {
      throw new Error('Odstránenie dvojice nie je v databáze nastavené. Spusti migráciu scripts/040_delete_my_pair.sql v Supabase.')
    }
    throw error
  }
}

export async function fetchIncomingPairInvitations(userId: string | number): Promise<PairInvitation[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('pair_invitations')
    .select('id, inviter_id, invitee_id, created_at')
    .eq('invitee_id', Number(userId))
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) {
    if (PAIR_INVITATIONS_SCHEMA_CODES.has(error.code)) throw new Error(PAIR_INVITATIONS_SCHEMA_MESSAGE)
    throw error
  }

  const invitations = (data ?? []) as { id: string | number; inviter_id: string | number; created_at: string }[]
  if (!invitations.length) return []

  const { data: profiles, error: profilesError } = await supabase
    .from('proffiles')
    .select('id, full_name')
    .in('id', invitations.map((invitation) => invitation.inviter_id))
  if (profilesError) throw profilesError

  return invitations.map((invitation) => ({
    id: String(invitation.id),
    inviterId: String(invitation.inviter_id),
    inviterName: profiles?.find((profile) => String(profile.id) === String(invitation.inviter_id))?.full_name?.trim() || 'Hráč',
    createdAt: invitation.created_at,
  }))
}

export async function respondToPairInvitation(invitationId: string, accept: boolean): Promise<void> {
  const { error } = await createClient().rpc('respond_to_pair_invitation', {
    p_invitation_id: Number(invitationId),
    p_accept: accept,
  })
  if (error) throw error
}