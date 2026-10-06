import { createClient } from '@/lib/supabase/client'
import { DELETED_PROFILE_EMAIL_DOMAIN, fetchPlayerProfile } from '@/lib/profiles'

export type OverviewStats = {
  displayName: string | null
  region: string | null
  level: string | null
  elo: number
  matchesPlayed: number
  wins: number
  winRate: number
  rank: number | null
  memberSince: string | null
}

const toNumber = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

export async function fetchOverviewStats(email: string): Promise<OverviewStats | null> {
  const supabase = createClient()
  const row = await fetchPlayerProfile(email)
  if (!row) return null

  const elo = toNumber(row.elo_rating, 1000)
  const matchesPlayed = toNumber(row.matches_played)
  const wins = toNumber(row.matches_won)

  let rank: number | null = null
  if (matchesPlayed > 0) {
    const { count, error: rankError } = await supabase
      .from('proffiles')
      .select('id', { count: 'exact', head: true })
      .gt('elo_rating', elo)
      .not('email', 'like', `%${DELETED_PROFILE_EMAIL_DOMAIN}`)
    if (rankError) throw rankError
    rank = (count ?? 0) + 1
  }

  return {
    displayName: row.full_name || null,
    region: row.region ?? null,
    level: row.level ?? null,
    elo,
    matchesPlayed,
    wins,
    winRate: matchesPlayed > 0 ? Math.round((wins / matchesPlayed) * 100) : 0,
    rank,
    memberSince: row.created_at,
  }
}
