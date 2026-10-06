// Pure match-detail model (no Supabase imports) so it can be unit-tested in isolation.

export const ELO_K_FACTOR = 32
export const DELETED_PLAYER_NAME = 'Vymazaný hráč'

export type MatchDetailRow = {
  id: number | string
  player1_id: number | string | null
  team1_player2_id: number | string | null
  player2_id: number | string | null
  team2_player2_id: number | string | null
  winner_id?: number | string | null
  match_date: string | null
  created_at?: string | null
  status: string | null
  result_sets?: unknown
  arena_name?: string | null
  submitted_by?: number | string | null
  rejected_by?: number | string | null
  approved_profile_ids?: unknown
  player1_sets_won?: number | null
  player2_sets_won?: number | null
  player1_games_won?: number | null
  player2_games_won?: number | null
  elo_delta_team1?: number | null
  elo_delta_team2?: number | null
  career_elo_delta_team1?: number | null
  career_elo_delta_team2?: number | null
}

export type MatchDetailProfileRow = {
  id: number | string
  full_name?: string | null
  avatar_url?: string | null
  elo_rating?: number | null
  career_elo?: number | null
  email?: string | null
}

export type MatchDetailStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled'
export type ConfirmationState = 'confirmed' | 'rejected' | 'waiting'

export type MatchDetailPlayer = {
  id: string
  name: string
  avatarUrl: string | null
  currentElo: number | null
  careerElo: number | null
  deleted: boolean
  seasonDelta: number | null
  careerDelta: number | null
  confirmation: ConfirmationState
  isSubmitter: boolean
}

export type MatchDetailSet = { team1Score: number; team2Score: number; winner: 1 | 2 | null; tiebreak: boolean }

export type MatchDetailTeam = {
  players: MatchDetailPlayer[]
  setsWon: number
  gamesWon: number
  seasonDelta: number | null
  careerDelta: number | null
}

export type MatchDetail = {
  id: string
  date: string | null
  createdAt: string | null
  arenaName: string
  status: MatchDetailStatus
  rawStatus: string
  sets: MatchDetailSet[]
  teams: [MatchDetailTeam, MatchDetailTeam]
  winnerTeam: 1 | 2 | null
  totalGames: number
  confirmedCount: number
  requiredCount: number
  submittedBy: { id: string; name: string } | null
  rejectedBy: { id: string; name: string } | null
  // Pre-match win probability of team 1 derived from the stored ELO delta (Elo expectation).
  team1WinProbability: number | null
  discrepancies: string[]
}

const toId = (value: unknown) => (value == null || value === '' ? null : String(value))
const toNumber = (value: unknown) => (value == null || value === '' || Number.isNaN(Number(value)) ? null : Number(value))

export function parseIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id) => id != null).map(String)
  if (typeof value === 'string') return value.replace(/^[{[]|[}\]]$/g, '').split(',').map((id) => id.trim().replace(/^"|"$/g, '')).filter(Boolean)
  return []
}

export function parseSets(value: unknown): MatchDetailSet[] {
  let raw = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const pair = Array.isArray(item)
      ? [item[0], item[1]]
      : item && typeof item === 'object'
        ? [(item as Record<string, unknown>).team1Score ?? (item as Record<string, unknown>).team1, (item as Record<string, unknown>).team2Score ?? (item as Record<string, unknown>).team2]
        : []
    const team1Score = toNumber(pair[0])
    const team2Score = toNumber(pair[1])
    if (team1Score === null || team2Score === null) return []
    const winner = team1Score > team2Score ? 1 : team2Score > team1Score ? 2 : null
    const tiebreak = (team1Score === 7 && team2Score === 6) || (team1Score === 6 && team2Score === 7)
    return [{ team1Score, team2Score, winner, tiebreak }]
  })
}

export function normalizeMatchStatus(status: string | null | undefined): MatchDetailStatus {
  const value = String(status ?? '').toLowerCase()
  if (value === 'pending') return 'pending'
  if (value === 'confirmed' || value === 'approved') return 'confirmed'
  if (value === 'cancelled') return 'cancelled'
  return 'rejected'
}

export function buildMatchDetail(row: MatchDetailRow, profiles: MatchDetailProfileRow[]): MatchDetail {
  const profileById = new Map(profiles.map((profile) => [String(profile.id), profile]))
  const status = normalizeMatchStatus(row.status)
  const approvedIds = new Set(parseIdList(row.approved_profile_ids))
  const rejectedById = toId(row.rejected_by)
  const submittedById = toId(row.submitted_by)
  const nameOf = (id: string) => {
    const profile = profileById.get(id)
    return String(profile?.full_name ?? '').trim() || `Hráč ${id}`
  }

  const team1Ids = [row.player1_id, row.team1_player2_id].map(toId).filter((id): id is string => id !== null)
  const team2Ids = [row.player2_id, row.team2_player2_id].map(toId).filter((id): id is string => id !== null)

  const sets = parseSets(row.result_sets)
  const setsFromScores = { team1: sets.filter((set) => set.winner === 1).length, team2: sets.filter((set) => set.winner === 2).length }
  const gamesFromScores = { team1: sets.reduce((sum, set) => sum + set.team1Score, 0), team2: sets.reduce((sum, set) => sum + set.team2Score, 0) }
  const storedSets = { team1: toNumber(row.player1_sets_won), team2: toNumber(row.player2_sets_won) }
  const storedGames = { team1: toNumber(row.player1_games_won), team2: toNumber(row.player2_games_won) }
  const team1SetsWon = sets.length ? setsFromScores.team1 : storedSets.team1 ?? 0
  const team2SetsWon = sets.length ? setsFromScores.team2 : storedSets.team2 ?? 0
  const team1Games = sets.length ? gamesFromScores.team1 : storedGames.team1 ?? 0
  const team2Games = sets.length ? gamesFromScores.team2 : storedGames.team2 ?? 0

  const winnerId = toId(row.winner_id)
  const winnerByScore = team1SetsWon > team2SetsWon ? 1 : team2SetsWon > team1SetsWon ? 2 : null
  const winnerByRecord = winnerId === null ? null : team1Ids.includes(winnerId) ? 1 : team2Ids.includes(winnerId) ? 2 : null
  const winnerTeam = winnerByScore ?? winnerByRecord

  const showElo = status === 'confirmed'
  const seasonDeltas = [showElo ? toNumber(row.elo_delta_team1) : null, showElo ? toNumber(row.elo_delta_team2) : null] as const
  const careerDeltas = [showElo ? toNumber(row.career_elo_delta_team1) : null, showElo ? toNumber(row.career_elo_delta_team2) : null] as const

  const confirmationOf = (id: string): ConfirmationState => {
    if (rejectedById === id) return 'rejected'
    if (approvedIds.has(id) || status === 'confirmed') return 'confirmed'
    return 'waiting'
  }
  const player = (id: string, teamIndex: 0 | 1): MatchDetailPlayer => {
    const profile = profileById.get(id)
    const name = nameOf(id)
    return {
      id,
      name,
      avatarUrl: profile?.avatar_url || null,
      currentElo: toNumber(profile?.elo_rating),
      careerElo: toNumber(profile?.career_elo),
      deleted: name === DELETED_PLAYER_NAME || String(profile?.email ?? '').endsWith('@deleted.spl.invalid'),
      seasonDelta: seasonDeltas[teamIndex],
      careerDelta: careerDeltas[teamIndex],
      confirmation: confirmationOf(id),
      isSubmitter: submittedById === id,
    }
  }

  const participants = [...team1Ids, ...team2Ids]
  const confirmedCount = participants.filter((id) => confirmationOf(id) === 'confirmed').length

  let team1WinProbability: number | null = null
  if (seasonDeltas[0] !== null && winnerTeam !== null) {
    const team1Score = winnerTeam === 1 ? 1 : 0
    team1WinProbability = Math.min(0.99, Math.max(0.01, team1Score - seasonDeltas[0] / ELO_K_FACTOR))
  }

  const discrepancies: string[] = []
  if (status === 'rejected' || row.status === 'disputed') {
    discrepancies.push(rejectedById ? `Výsledok rozporoval/a ${nameOf(rejectedById)}.` : 'Výsledok bol označený ako sporný.')
  }
  if (status === 'cancelled') discrepancies.push('Zápas bol zrušený a nezapočítava sa do ELO ani štatistík.')
  if (sets.length && storedSets.team1 !== null && storedSets.team2 !== null && (storedSets.team1 !== setsFromScores.team1 || storedSets.team2 !== setsFromScores.team2)) {
    discrepancies.push(`Uložené skóre setov (${storedSets.team1}:${storedSets.team2}) nesedí s výsledkami setov (${setsFromScores.team1}:${setsFromScores.team2}).`)
  }
  if (sets.length && storedGames.team1 !== null && storedGames.team2 !== null && (storedGames.team1 !== gamesFromScores.team1 || storedGames.team2 !== gamesFromScores.team2)) {
    discrepancies.push(`Uložený počet gemov (${storedGames.team1}:${storedGames.team2}) nesedí so súčtom gemov v setoch (${gamesFromScores.team1}:${gamesFromScores.team2}).`)
  }
  if (winnerByScore !== null && winnerByRecord !== null && winnerByScore !== winnerByRecord) {
    discrepancies.push('Zaznamenaný víťaz zápasu nesedí so skóre setov.')
  }
  if (sets.some((set) => set.winner === null)) discrepancies.push('Niektorý set skončil nerozhodne.')
  if (new Set(participants).size !== participants.length) discrepancies.push('V zápase je ten istý hráč zapísaný viackrát.')

  return {
    id: String(row.id),
    date: row.match_date ?? null,
    createdAt: row.created_at ?? null,
    arenaName: String(row.arena_name ?? '').trim(),
    status,
    rawStatus: String(row.status ?? ''),
    sets,
    teams: [
      { players: team1Ids.map((id) => player(id, 0)), setsWon: team1SetsWon, gamesWon: team1Games, seasonDelta: seasonDeltas[0], careerDelta: careerDeltas[0] },
      { players: team2Ids.map((id) => player(id, 1)), setsWon: team2SetsWon, gamesWon: team2Games, seasonDelta: seasonDeltas[1], careerDelta: careerDeltas[1] },
    ],
    winnerTeam,
    totalGames: team1Games + team2Games,
    confirmedCount,
    requiredCount: participants.length,
    submittedBy: submittedById ? { id: submittedById, name: nameOf(submittedById) } : null,
    rejectedBy: rejectedById ? { id: rejectedById, name: nameOf(rejectedById) } : null,
    team1WinProbability,
    discrepancies,
  }
}
