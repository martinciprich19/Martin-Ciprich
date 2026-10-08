import { createClient } from '@/lib/supabase/client'
import { withProfileGender } from '@/lib/profile-gender-query'
import { buildMatchDetail, parseIdList, type MatchDetail, type MatchDetailProfileRow, type MatchDetailRow } from '@/lib/match-detail-model'

export * from '@/lib/match-detail-model'

const BASE_MATCH_COLUMNS = 'id, player1_id, team1_player2_id, player2_id, team2_player2_id, winner_id, match_date, status, player1_sets_won, player2_sets_won, player1_games_won, player2_games_won'
const EXTENDED_MATCH_COLUMNS = `${BASE_MATCH_COLUMNS}, created_at, result_sets, arena_name, submitted_by, rejected_by, approved_profile_ids, elo_delta_team1, elo_delta_team2, career_elo_delta_team1, career_elo_delta_team2`
const EXTENDED_PROFILE_COLUMNS = 'id, full_name, avatar_url, gender, elo_rating, career_elo, email'
const BASE_PROFILE_COLUMNS = 'id, full_name, avatar_url, gender, elo_rating, email'

const isMissingColumn = (error: { code?: string } | null) => error?.code === '42703' || error?.code === 'PGRST204'

export async function fetchMatchDetail(matchId: string): Promise<MatchDetail> {
  if (!/^[1-9]\d*$/.test(matchId)) throw new Error('Neplatné ID zápasu.')
  const supabase = createClient()

  const extended = await supabase.from('matches').select(EXTENDED_MATCH_COLUMNS).eq('id', matchId).maybeSingle()
  // Older databases (before migrations 027–034) don't have all detail columns yet.
  const { data: row, error } = isMissingColumn(extended.error) ? await supabase.from('matches').select(BASE_MATCH_COLUMNS).eq('id', matchId).maybeSingle() : extended
  if (error) throw error
  if (!row) throw new Error('Zápas sa nenašiel alebo k nemu nemáš prístup.')
  const match = row as unknown as MatchDetailRow

  const profileIds = Array.from(new Set([
    match.player1_id, match.team1_player2_id, match.player2_id, match.team2_player2_id, match.submitted_by, match.rejected_by,
    ...parseIdList(match.approved_profile_ids),
  ].filter((id) => id != null && id !== '').map(String)))

  let profiles: MatchDetailProfileRow[] = []
  if (profileIds.length) {
    const query = (columns: string) => supabase.from('proffiles').select(columns).in('id', profileIds)
    const extended = await withProfileGender(query, EXTENDED_PROFILE_COLUMNS)
    const result = isMissingColumn(extended.error) ? await withProfileGender(query, BASE_PROFILE_COLUMNS) : extended
    if (result.error) throw result.error
    profiles = (result.data ?? []) as unknown as MatchDetailProfileRow[]
  }

  return buildMatchDetail(match, profiles)
}
