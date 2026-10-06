import { createClient } from '@/lib/supabase/client'
import { fetchPlayerProfiles } from '@/lib/profiles'

export type ProfileMatch = {
  id: string
  match_date: string
  status: 'approved' | 'confirmed' | 'rejected' | 'disputed'
  opponent_id: string
  opponent_name: string
  result: 'win' | 'loss'
  sets_won: number
  sets_lost: number
  games_won: number
  games_lost: number
}

export type ParticipantMatch = {
  id: string
  date: string
  arena: string
  team1Ids: string[]
  team2Ids: string[]
  team1Name: string
  team2Name: string
  participants: { id: string; name: string }[]
  sets: { team1Score: number; team2Score: number }[]
  team1SetsWon: number
  team2SetsWon: number
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled'
  approvedIds: string[]
  eloDeltaTeam1: number | null
  eloDeltaTeam2: number | null
}

export async function submitMatchResult(input: {
  team1Player1Id: string
  team1Player2Id: string
  team2Player1Id: string
  team2Player2Id: string
  date: string
  arena: string
  sets: ParticipantMatch['sets']
}): Promise<string> {
  const ids = [input.team1Player1Id, input.team1Player2Id, input.team2Player1Id, input.team2Player2Id]
  if (ids.some((id) => !/^[1-9]\d*$/.test(id))) throw new Error('Každý slot musí mať vybraného registrovaného hráča.')
  if (new Set(ids).size !== ids.length) throw new Error('Všetci štyria hráči musia byť rozdielni.')
  const { data, error } = await createClient().rpc('submit_match_result', {
    p_team1_player1_id: Number(input.team1Player1Id),
    p_team1_player2_id: Number(input.team1Player2Id),
    p_team2_player1_id: Number(input.team2Player1Id),
    p_team2_player2_id: Number(input.team2Player2Id),
    p_match_date: input.date,
    p_arena_name: input.arena,
    p_sets: input.sets,
  })
  if (error) throw error
  if (data == null) throw new Error('Databáza nevrátila ID zápasu.')
  return String(data)
}

export const isCountedMatch = (match: Pick<ProfileMatch, 'status'>) => match.status === 'confirmed' || match.status === 'approved'

// Pending match the given player takes part in but hasn't confirmed or rejected yet.
export const isAwaitingResponseFrom = (match: Pick<ParticipantMatch, 'status' | 'participants' | 'approvedIds'>, profileId: string | number) => {
  const id = String(profileId)
  return match.status === 'pending' && match.participants.some((participant) => participant.id === id) && !match.approvedIds.includes(id)
}

function parseProfileIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id) => id != null).map(String)
  if (typeof value === 'string') return value.replace(/^[{[]|[}\]]$/g, '').split(',').map((id) => id.trim().replace(/^"|"$/g, '')).filter(Boolean)
  return []
}

export type MatchResponseStatus = 'pending' | 'confirmed' | 'rejected'

export async function respondToMatchResult(matchId: string, accept: boolean): Promise<MatchResponseStatus> {
  const { data, error } = await createClient().rpc('respond_to_match_result', {
    p_match_id: matchId,
    p_accept: accept,
  })
  if (error) throw error
  const raw = data && typeof data === 'object' && 'status' in data ? (data as { status: unknown }).status : data
  const status = String(raw ?? '').trim().toLowerCase()
  if (status === 'confirmed' || status === 'approved') return 'confirmed'
  if (status === 'rejected' || status === 'disputed' || status === 'cancelled') return 'rejected'
  if (status === 'pending') return 'pending'
  return accept ? 'pending' : 'rejected'
}

export async function fetchParticipantMatches(profileId: string | number): Promise<ParticipantMatch[]> {
  const id = String(profileId)
  if (!/^[1-9]\d*$/.test(id)) throw new Error('Neplatné ID hráča.')
  const { data, error } = await createClient()
    .from('matches')
    .select('id, player1_id, player2_id, team1_player2_id, team2_player2_id, match_date, status, result_sets, arena_name, approved_profile_ids, player1_sets_won, player2_sets_won, elo_delta_team1, elo_delta_team2')
    .or(`player1_id.eq.${id},player2_id.eq.${id},team1_player2_id.eq.${id},team2_player2_id.eq.${id}`)
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
  if (error) throw error
  if (!data?.length) return []
  const participantIds = Array.from(new Set(data.flatMap((row) => [row.player1_id, row.team1_player2_id, row.player2_id, row.team2_player2_id]).filter((value) => value != null).map(String)))
  const { data: profiles, error: profilesError } = await createClient()
    .from('proffiles').select('id, full_name').in('id', participantIds)
  if (profilesError) throw profilesError
  const names = new Map((profiles ?? []).map((profile) => [String(profile.id), String(profile.full_name ?? '').trim()]))

  return data.map((row) => {
    const team1Ids = [row.player1_id, row.team1_player2_id].filter((value) => value != null).map(String)
    const team2Ids = [row.player2_id, row.team2_player2_id].filter((value) => value != null).map(String)
    return {
      id: String(row.id),
      date: String(row.match_date),
      arena: String(row.arena_name ?? ''),
      team1Ids,
      team2Ids,
      team1Name: team1Ids.map((playerId) => names.get(playerId) || `Hráč ${playerId}`).join(' & '),
      team2Name: team2Ids.map((playerId) => names.get(playerId) || `Hráč ${playerId}`).join(' & '),
      participants: [...team1Ids, ...team2Ids].map((playerId) => ({ id: playerId, name: names.get(playerId) || `Hráč ${playerId}` })),
      sets: Array.isArray(row.result_sets) ? row.result_sets as ParticipantMatch['sets'] : [],
      team1SetsWon: Number(row.player1_sets_won ?? 0),
      team2SetsWon: Number(row.player2_sets_won ?? 0),
      status: row.status === 'pending' ? 'pending' : ['confirmed', 'approved'].includes(row.status) ? 'confirmed' : row.status === 'cancelled' ? 'cancelled' : 'rejected',
      approvedIds: parseProfileIds(row.approved_profile_ids),
      eloDeltaTeam1: row.elo_delta_team1 == null ? null : Number(row.elo_delta_team1),
      eloDeltaTeam2: row.elo_delta_team2 == null ? null : Number(row.elo_delta_team2),
    }
  })
}

type MatchRow = {
  id: number | string
  player1_id: number | string
  player2_id: number | string
  team1_player2_id: number | string | null
  team2_player2_id: number | string | null
  winner_id: number | string | null
  match_date: string
  player1_sets_won: number | null
  player1_games_won: number | null
  player2_sets_won: number | null
  player2_games_won: number | null
  status: string
}

export async function fetchProfileMatches(profileId: string): Promise<ProfileMatch[]> {
  const supabase = createClient()
  const [{ data, error }, profiles] = await Promise.all([
    supabase
      .from('matches')
      .select('id, player1_id, player2_id, team1_player2_id, team2_player2_id, winner_id, match_date, status, player1_sets_won, player1_games_won, player2_sets_won, player2_games_won')
      .or(`player1_id.eq.${profileId},player2_id.eq.${profileId},team1_player2_id.eq.${profileId},team2_player2_id.eq.${profileId}`)
      .in('status', ['approved', 'confirmed', 'rejected', 'disputed'])
      .not('winner_id', 'is', null)
      .order('match_date', { ascending: false }),
    fetchPlayerProfiles({ includeDeleted: true }),
  ])

  if (error) throw error

  const profileNames = new Map(profiles.map((profile) => [String(profile.id), profile.full_name]))

  return ((data ?? []) as unknown as MatchRow[]).map((row) => {
    const team1Ids = [row.player1_id, row.team1_player2_id].filter((id): id is string | number => id !== null).map(String)
    const team2Ids = [row.player2_id, row.team2_player2_id].filter((id): id is string | number => id !== null).map(String)
    const isTeam1 = team1Ids.includes(profileId)
    const ownTeamIds = isTeam1 ? team1Ids : team2Ids
    const opponentIds = isTeam1 ? team2Ids : team1Ids
    const player1SetsWon = Number(row.player1_sets_won ?? 0)
    const player1GamesWon = Number(row.player1_games_won ?? 0)
    const player2SetsWon = Number(row.player2_sets_won ?? 0)
    const player2GamesWon = Number(row.player2_games_won ?? 0)

    return {
      id: String(row.id),
      match_date: row.match_date,
      status: ['approved', 'confirmed', 'rejected', 'disputed'].includes(row.status) ? row.status as ProfileMatch['status'] : 'confirmed',
      opponent_id: opponentIds.join(','),
      opponent_name: opponentIds.map((id) => profileNames.get(id)).filter(Boolean).join(' & ') || 'Neznámy hráč',
      result: ownTeamIds.includes(String(row.winner_id)) ? 'win' : 'loss',
      sets_won: isTeam1 ? player1SetsWon : player2SetsWon,
      sets_lost: isTeam1 ? player2SetsWon : player1SetsWon,
      games_won: isTeam1 ? player1GamesWon : player2GamesWon,
      games_lost: isTeam1 ? player2GamesWon : player1GamesWon,
    }
  })
}