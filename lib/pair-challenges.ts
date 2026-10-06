import { createClient } from '@/lib/supabase/client'

export type PairChallengeStatus = 'pending' | 'accepted' | 'confirmed' | 'declined' | 'cancelled'
export type ChallengeProfile = { full_name: string | null } | { full_name: string | null }[] | null

export type PairChallenge = {
  id: string
  challenger_1_id: string
  challenger_2_id: string
  challenged_1_id: string
  challenged_2_id: string
  arena_id: string | null
  match_date: string
  status: PairChallengeStatus
  challenger_2_accepted: boolean
  challenged_1_accepted: boolean
  challenged_2_accepted: boolean
  challenger_1: ChallengeProfile
  challenger_2: ChallengeProfile
  challenged_1: ChallengeProfile
  challenged_2: ChallengeProfile
}

const PAIR_CHALLENGE_SELECT = 'id, challenger_1_id, challenger_2_id, challenged_1_id, challenged_2_id, arena_id, match_date, status, challenger_2_accepted, challenged_1_accepted, challenged_2_accepted, challenger_1:proffiles!challenges_challenger_1_id_fkey(full_name), challenger_2:proffiles!challenges_challenger_2_id_fkey(full_name), challenged_1:proffiles!challenges_challenged_1_id_fkey(full_name), challenged_2:proffiles!challenges_challenged_2_id_fkey(full_name)'

export async function fetchMyPairChallenges(userId: string): Promise<PairChallenge[]> {
  const { data, error } = await createClient()
    .from('challenges')
    .select(PAIR_CHALLENGE_SELECT)
    .eq('challenger_1_id', userId)
    .order('match_date', { ascending: true })
  if (error) throw error
  return (data ?? []) as PairChallenge[]
}

export async function fetchPairChallenge(challengeId: string): Promise<PairChallenge> {
  const { data, error } = await createClient()
    .from('challenges')
    .select(PAIR_CHALLENGE_SELECT)
    .eq('id', challengeId)
    .single()
  if (error) throw error
  return data as PairChallenge
}

export async function fetchUpcomingPairChallenges(userId: string | number): Promise<PairChallenge[]> {
  const profileId = String(userId)
  if (!/^[1-9]\d*$/.test(profileId)) throw new Error('Neplatné ID hráča.')
  const { data, error } = await createClient()
    .from('challenges')
    .select(PAIR_CHALLENGE_SELECT)
    .in('status', ['accepted', 'confirmed'])
    .gte('match_date', new Date().toISOString())
    .or(`challenger_1_id.eq.${profileId},challenger_2_id.eq.${profileId},challenged_1_id.eq.${profileId},challenged_2_id.eq.${profileId}`)
    .order('match_date', { ascending: true })
  if (error) throw error
  return (data ?? []) as PairChallenge[]
}

export async function respondToPairChallenge(challengeId: string, accept: boolean): Promise<PairChallengeStatus> {
  const { data, error } = await createClient().rpc('respond_to_pair_challenge', {
    p_challenge_id: challengeId,
    p_accept: accept,
  })
  if (error) throw error
  return data as PairChallengeStatus
}

export async function cancelPairChallenge(id: string, userId: string) {
  const { error } = await createClient()
    .from('challenges')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('challenger_1_id', userId)
  if (error) throw error
}