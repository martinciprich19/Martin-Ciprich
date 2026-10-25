export type Team = 'TEAM_A' | 'TEAM_B'
export type GameScore = 0 | 15 | 30 | 40
export type ScoringType = 'golden_point' | 'advantage'
export type SetFormat = 'standard' | 'pro_set' | 'seven_games_no_tiebreak'
export type ThirdSetFormat = 'full_set' | 'super_tiebreak'
export type MatchSettings = {
  scoring_type: ScoringType
  set_format: SetFormat
  third_set_format: ThirdSetFormat
}
export type TiebreakScore = { a: number; b: number; first_team: Team; first_player: 1 | 2 }
export type ServiceGameStatistics = { team_a_won: number; team_a_lost: number; team_b_won: number; team_b_lost: number }
type HistoryServer = { team: Team; player: 1 | 2 }
export type PointHistoryEntry = { server?: HistoryServer } & (
  | {
    type: 'point'
    played_at?: string
    set: number
    game: number
    team: Team
    tiebreak: boolean
    super_tiebreak: boolean
    score_a: string
    score_b: string
    games_a: number
    games_b: number
    game_winner: Team | null
    set_winner: Team | null
  }
  | { type: 'reset'; set: number; game: number; tiebreak: boolean; super_tiebreak: boolean })
export type LiveScore = {
  scoring_type?: ScoringType
  set_format?: SetFormat
  third_set_format?: ThirdSetFormat
  advantage_team?: Team | null
  tiebreak_score?: TiebreakScore | null
  team_a_game_score: GameScore
  team_b_game_score: GameScore
  team_a_games: number
  team_b_games: number
  team_a_sets: number
  team_b_sets: number
  serving_team: Team | null
  serving_player: 1 | 2
  initial_server_chosen: boolean
  team_a_player1_serve_points_won: number
  team_a_player1_serve_points_lost: number
  team_a_player2_serve_points_won: number
  team_a_player2_serve_points_lost: number
  team_b_player1_serve_points_won: number
  team_b_player1_serve_points_lost: number
  team_b_player2_serve_points_won: number
  team_b_player2_serve_points_lost: number
  team_a_total_points_won: number
  team_b_total_points_won: number
  streak_team: Team | null
  current_point_streak: number
  team_a_longest_point_streak: number
  team_b_longest_point_streak: number
  team_a_break_points: number
  team_a_break_points_converted: number
  team_a_break_points_missed: number
  team_b_break_points: number
  team_b_break_points_converted: number
  team_b_break_points_missed: number
  started_at: string | null
  finished_at: string | null
  completed_sets: [number, number][]
  set_statistics?: (SetStatistics | null)[]
  service_game_statistics?: ServiceGameStatistics | null
  point_history?: PointHistoryEntry[]
  point_history_complete?: boolean
}

export const POINT_STAT_KEYS = [
  'team_a_player1_serve_points_won', 'team_a_player1_serve_points_lost',
  'team_a_player2_serve_points_won', 'team_a_player2_serve_points_lost',
  'team_b_player1_serve_points_won', 'team_b_player1_serve_points_lost',
  'team_b_player2_serve_points_won', 'team_b_player2_serve_points_lost',
  'team_a_total_points_won', 'team_b_total_points_won',
  'team_a_longest_point_streak', 'team_b_longest_point_streak',
  'team_a_break_points', 'team_a_break_points_converted', 'team_a_break_points_missed',
  'team_b_break_points', 'team_b_break_points_converted', 'team_b_break_points_missed',
] as const
export type RecordedMatchStatistics = LiveScore & {
  team_a_player1_name: string
  team_a_player2_name: string
  team_b_player1_name: string
  team_b_player2_name: string
  statistics_complete: boolean
}

export function parsePointHistory(value: unknown): PointHistoryEntry[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('Neplatná história bodov zápasu.')
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('Neplatná udalosť v histórii bodov.')
    }
    const row = item as Record<string, unknown>
    let server: HistoryServer | undefined
    if (row.server !== undefined) {
      if (typeof row.server !== 'object' || row.server === null
        || !('team' in row.server) || !('player' in row.server)
        || (row.server.team !== 'TEAM_A' && row.server.team !== 'TEAM_B')
        || (row.server.player !== 1 && row.server.player !== 2)) {
        throw new Error('Neplatné podanie v histórii bodov.')
      }
      server = { team: row.server.team, player: row.server.player }
    }
    if (row.played_at !== undefined && (typeof row.played_at !== 'string' || !Number.isFinite(Date.parse(row.played_at)))) {
      throw new Error('Neplatný čas bodu v histórii zápasu.')
    }
    const positiveInteger = (field: string) => {
      const number = row[field]
      if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) {
        throw new Error('Neplatné poradie setu alebo gemu v histórii bodov.')
      }
      return number
    }
    const set = positiveInteger('set')
    const game = positiveInteger('game')
    if (row.type === 'reset') {
      if (typeof row.tiebreak !== 'boolean' || typeof row.super_tiebreak !== 'boolean') {
        throw new Error('Neplatné vynulovanie skóre v histórii bodov.')
      }
      return { type: 'reset', set, game, tiebreak: row.tiebreak, super_tiebreak: row.super_tiebreak, ...(server ? { server } : {}) }
    }
    if (row.type !== 'point' || (row.team !== 'TEAM_A' && row.team !== 'TEAM_B')
      || typeof row.tiebreak !== 'boolean' || typeof row.super_tiebreak !== 'boolean'
      || typeof row.score_a !== 'string' || typeof row.score_b !== 'string'
      || !/^(?:0|15|30|40|AD|\d{1,3})$/.test(row.score_a)
      || !/^(?:0|15|30|40|AD|\d{1,3})$/.test(row.score_b)
      || row.game_winner !== null && row.game_winner !== 'TEAM_A' && row.game_winner !== 'TEAM_B'
      || row.set_winner !== null && row.set_winner !== 'TEAM_A' && row.set_winner !== 'TEAM_B') {
      throw new Error('Neplatné skóre bodu v histórii zápasu.')
    }
    const games = (field: string) => {
      const number = row[field]
      if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) {
        throw new Error('Neplatný stav gemov v histórii bodov.')
      }
      return number
    }
    return {
      type: 'point', set, game, team: row.team, tiebreak: row.tiebreak,
      super_tiebreak: row.super_tiebreak, score_a: row.score_a, score_b: row.score_b,
      games_a: games('games_a'), games_b: games('games_b'),
      game_winner: row.game_winner, set_winner: row.set_winner,
      ...(server ? { server } : {}),
      ...(typeof row.played_at === 'string' ? { played_at: row.played_at } : {}),
    }
  })
}

export function parseRecordedMatchStatistics(value: unknown): RecordedMatchStatistics | null {
  if (value == null) return null
  if (typeof value !== 'object') throw new Error('Neplatné uložené štatistiky zápasu.')
  const row = value as Record<string, unknown>
  const stats = parseSetStatistics([row])[0]
  if (!stats || typeof row.statistics_complete !== 'boolean') throw new Error('Neplatné uložené štatistiky zápasu.')
  const count = (key: string) => {
    const n = row[key]
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw new Error(`Neplatná štatistika: ${key}.`)
    return n
  }
  const name = (key: string) => {
    const text = row[key]
    if (typeof text !== 'string') throw new Error('Chýba meno hráča v štatistikách.')
    return text
  }
  if (!Array.isArray(row.completed_sets)) throw new Error('Chýbajú výsledky setov v štatistikách.')
  if (row.scoring_type !== undefined && row.scoring_type !== 'golden_point' && row.scoring_type !== 'advantage') {
    throw new Error('Neplatné uložené pravidlá bodovania.')
  }
  if (row.set_format !== undefined && row.set_format !== 'standard'
    && row.set_format !== 'pro_set' && row.set_format !== 'seven_games_no_tiebreak') {
    throw new Error('Neplatný uložený formát setu.')
  }
  if (row.third_set_format !== undefined && row.third_set_format !== 'full_set' && row.third_set_format !== 'super_tiebreak') {
    throw new Error('Neplatný uložený formát tretieho setu.')
  }
  const completedSets: [number, number][] = row.completed_sets.map((set: unknown) => {
    if (!Array.isArray(set) || set.length !== 2 || !set.every((n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) throw new Error('Neplatné výsledky setov v štatistikách.')
    return [set[0], set[1]]
  })
  return {
    ...stats,
    scoring_type: row.scoring_type ?? 'golden_point',
    set_format: row.set_format ?? 'standard',
    third_set_format: row.third_set_format ?? 'full_set',
    advantage_team: null,
    team_a_game_score: 0, team_b_game_score: 0, team_a_games: 0, team_b_games: 0,
    team_a_sets: count('team_a_sets'), team_b_sets: count('team_b_sets'),
    serving_team: null, serving_player: 1, initial_server_chosen: true,
    completed_sets: completedSets, set_statistics: parseSetStatistics(row.set_statistics),
    point_history: parsePointHistory(row.point_history),
    point_history_complete: row.point_history_complete === true,
    statistics_complete: row.statistics_complete,
    team_a_player1_name: name('team_a_player1_name'), team_a_player2_name: name('team_a_player2_name'),
    team_b_player1_name: name('team_b_player1_name'), team_b_player2_name: name('team_b_player2_name'),
  }
}
export type SetStatistics = Pick<LiveScore, typeof POINT_STAT_KEYS[number] | 'streak_team' | 'current_point_streak' | 'started_at' | 'finished_at' | 'service_game_statistics'>

export function parseServiceGameStatistics(value: unknown): ServiceGameStatistics | null {
  if (value == null) return null
  if (typeof value !== 'object') throw new Error('Neplatné štatistiky gemov na podaní.')
  const row = value as Record<string, unknown>
  const result: ServiceGameStatistics = { team_a_won: 0, team_a_lost: 0, team_b_won: 0, team_b_lost: 0 }
  for (const key of Object.keys(result) as (keyof ServiceGameStatistics)[]) {
    const counter = row[key]
    if (typeof counter !== 'number' || !Number.isSafeInteger(counter) || counter < 0) throw new Error('Neplatné štatistiky gemov na podaní.')
    result[key] = counter
  }
  return result
}

export function emptySetStatistics(): SetStatistics {
  return {
    team_a_player1_serve_points_won: 0, team_a_player1_serve_points_lost: 0,
    team_a_player2_serve_points_won: 0, team_a_player2_serve_points_lost: 0,
    team_b_player1_serve_points_won: 0, team_b_player1_serve_points_lost: 0,
    team_b_player2_serve_points_won: 0, team_b_player2_serve_points_lost: 0,
    team_a_total_points_won: 0, team_b_total_points_won: 0,
    team_a_longest_point_streak: 0, team_b_longest_point_streak: 0,
    team_a_break_points: 0, team_a_break_points_converted: 0, team_a_break_points_missed: 0,
    team_b_break_points: 0, team_b_break_points_converted: 0, team_b_break_points_missed: 0,
    streak_team: null, current_point_streak: 0, started_at: null, finished_at: null,
    service_game_statistics: { team_a_won: 0, team_a_lost: 0, team_b_won: 0, team_b_lost: 0 },
  }
}

export function parseSetStatistics(value: unknown): (SetStatistics | null)[] {
  if (!Array.isArray(value) || value.length > 3) throw new Error('Chýbajú alebo sú neplatné štatistiky setov. Spusti SQL migráciu 050.')
  return value.map((entry: unknown) => {
    if (entry === null) return null
    if (!entry || typeof entry !== 'object') throw new Error('Neplatné štatistiky setu.')
    const row = entry as Record<string, unknown>
    const stats = emptySetStatistics()
    for (const key of POINT_STAT_KEYS) {
      const counter = row[key]
      if (typeof counter !== 'number' || !Number.isSafeInteger(counter) || counter < 0) throw new Error('Neplatné počítadlo štatistiky setu.')
      stats[key] = counter
    }
    if (row.streak_team !== null && row.streak_team !== 'TEAM_A' && row.streak_team !== 'TEAM_B') throw new Error('Neplatný tím série v sete.')
    if (typeof row.current_point_streak !== 'number' || !Number.isSafeInteger(row.current_point_streak) || row.current_point_streak < 0) throw new Error('Neplatná séria v sete.')
    stats.streak_team = row.streak_team
    stats.current_point_streak = row.current_point_streak
    stats.service_game_statistics = parseServiceGameStatistics(row.service_game_statistics)
    for (const key of ['started_at', 'finished_at'] as const) {
      const timestamp = row[key]
      if (timestamp !== null && (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)))) throw new Error('Neplatný čas setu.')
      stats[key] = timestamp
    }
    return stats
  })
}

const serveStatKeys = {
  TEAM_A: {
    1: { won: 'team_a_player1_serve_points_won', lost: 'team_a_player1_serve_points_lost' },
    2: { won: 'team_a_player2_serve_points_won', lost: 'team_a_player2_serve_points_lost' },
  },
  TEAM_B: {
    1: { won: 'team_b_player1_serve_points_won', lost: 'team_b_player1_serve_points_lost' },
    2: { won: 'team_b_player2_serve_points_won', lost: 'team_b_player2_serve_points_lost' },
  },
} as const

const breakPointKeys = {
  TEAM_A: {
    chances: 'team_a_break_points',
    converted: 'team_a_break_points_converted',
    missed: 'team_a_break_points_missed',
  },
  TEAM_B: {
    chances: 'team_b_break_points',
    converted: 'team_b_break_points_converted',
    missed: 'team_b_break_points_missed',
  },
} as const

export function getMatchWinner(score: Pick<LiveScore, 'team_a_sets' | 'team_b_sets' | 'set_format'>): Team | null {
  const setsToWin = score.set_format === 'pro_set' ? 1 : 2
  return score.team_a_sets >= setsToWin ? 'TEAM_A' : score.team_b_sets >= setsToWin ? 'TEAM_B' : null
}

export function rotateServer(score: Pick<LiveScore, 'serving_team' | 'serving_player'>): { serving_team: Team; serving_player: 1 | 2 } {
  if (score.serving_team === null) throw new Error('Choose an initial server first.')
  return {
    serving_team: score.serving_team === 'TEAM_A' ? 'TEAM_B' : 'TEAM_A',
    serving_player: score.serving_team === 'TEAM_B' ? (score.serving_player === 1 ? 2 : 1) : score.serving_player,
  }
}

export function rotateServingPlayer(score: LiveScore): { serving_team: Team; serving_player: 1 | 2 } {
  if (score.serving_team === null) throw new Error('Choose an initial server first.')
  return {
    serving_team: score.serving_team,
    serving_player: score.serving_player === 1 ? 2 : 1,
  }
}

export function isTiebreak(score: Pick<LiveScore, 'team_a_games' | 'team_b_games' | 'set_format' | 'tiebreak_score'>): boolean {
  return score.tiebreak_score != null
    || (score.set_format !== 'seven_games_no_tiebreak'
      && score.set_format !== 'pro_set'
      && score.team_a_games === 6 && score.team_b_games === 6)
    || (score.set_format === 'pro_set' && score.team_a_games === 8 && score.team_b_games === 8)
}

export function isSuperTiebreak(score: Pick<LiveScore, 'team_a_sets' | 'team_b_sets' | 'set_format' | 'third_set_format' | 'tiebreak_score'>): boolean {
  return score.set_format !== 'pro_set'
    && score.third_set_format === 'super_tiebreak'
    && score.team_a_sets === 1
    && score.team_b_sets === 1
    && score.tiebreak_score != null
}

export function parseTiebreakScore(value: unknown): TiebreakScore | null {
  if (value == null) return null
  if (typeof value !== 'object') throw new Error('Neplatné skóre tajbrejku.')
  const row = value as Record<string, unknown>
  if (typeof row.a !== 'number' || !Number.isSafeInteger(row.a) || row.a < 0
    || typeof row.b !== 'number' || !Number.isSafeInteger(row.b) || row.b < 0
    || (row.first_team !== 'TEAM_A' && row.first_team !== 'TEAM_B')
    || (row.first_player !== 1 && row.first_player !== 2)) {
    throw new Error('Neplatné skóre tajbrejku.')
  }
  return { a: row.a, b: row.b, first_team: row.first_team, first_player: row.first_player }
}

export function getTiebreakScore(score: LiveScore): TiebreakScore {
  if (score.tiebreak_score) return score.tiebreak_score
  if (score.serving_team === null) throw new Error('Choose an initial server first.')
  return { a: 0, b: 0, first_team: score.serving_team, first_player: score.serving_player }
}

export function tiebreakServer(state: TiebreakScore): { serving_team: Team; serving_player: 1 | 2 } {
  const total = state.a + state.b
  const rotations = total === 0 ? 0 : Math.ceil(total / 2) % 4
  let server = { serving_team: state.first_team, serving_player: state.first_player }
  for (let i = 0; i < rotations; i++) server = rotateServer(server)
  return server
}

export function isGamePoint(score: LiveScore, team: Team): boolean {
  if (isTiebreak(score)) return false
  const own = score[team === 'TEAM_A' ? 'team_a_game_score' : 'team_b_game_score']
  const opponent = score[team === 'TEAM_A' ? 'team_b_game_score' : 'team_a_game_score']
  return own === 40 && (score.scoring_type !== 'advantage' || opponent < 40 || score.advantage_team === team)
}

export function createPointHistoryReset(score: LiveScore): PointHistoryEntry {
  const tiebreak = isTiebreak(score)
  return {
    type: 'reset',
    set: score.team_a_sets + score.team_b_sets + 1,
    game: score.team_a_games + score.team_b_games + 1,
    tiebreak,
    super_tiebreak: tiebreak && isSuperTiebreak(score),
    ...(score.serving_team ? { server: { team: score.serving_team, player: score.serving_player } } : {}),
  }
}

function withPointHistory(previous: LiveScore, next: LiveScore, team: Team, pointAt: string): LiveScore {
  const tiebreak = isTiebreak(previous)
  let scoreA: string
  let scoreB: string
  if (tiebreak) {
    const current = getTiebreakScore(previous)
    scoreA = String(current.a + (team === 'TEAM_A' ? 1 : 0))
    scoreB = String(current.b + (team === 'TEAM_B' ? 1 : 0))
  } else if (isGamePoint(previous, team)) {
    scoreA = previous.advantage_team === 'TEAM_A' ? 'AD' : String(previous.team_a_game_score)
    scoreB = previous.advantage_team === 'TEAM_B' ? 'AD' : String(previous.team_b_game_score)
  } else if (next.advantage_team) {
    scoreA = next.advantage_team === 'TEAM_A' ? 'AD' : '40'
    scoreB = next.advantage_team === 'TEAM_B' ? 'AD' : '40'
  } else {
    scoreA = String(next.team_a_game_score)
    scoreB = String(next.team_b_game_score)
  }
  const setFinished = next.completed_sets.length > previous.completed_sets.length
  const gameFinished = setFinished
    || next.team_a_games !== previous.team_a_games
    || next.team_b_games !== previous.team_b_games
  const completedSet = setFinished ? next.completed_sets.at(-1) : null
  const entry: PointHistoryEntry = {
    type: 'point',
    played_at: pointAt,
    ...(previous.serving_team ? { server: { team: previous.serving_team, player: previous.serving_player } } : {}),
    set: previous.team_a_sets + previous.team_b_sets + 1,
    game: previous.team_a_games + previous.team_b_games + 1,
    team,
    tiebreak,
    super_tiebreak: tiebreak && isSuperTiebreak(previous),
    score_a: scoreA,
    score_b: scoreB,
    games_a: completedSet?.[0] ?? next.team_a_games,
    games_b: completedSet?.[1] ?? next.team_b_games,
    game_winner: gameFinished ? team : null,
    set_winner: next.team_a_sets > previous.team_a_sets || next.team_b_sets > previous.team_b_sets ? team : null,
  }
  return { ...next, point_history: [...(previous.point_history ?? []), entry] }
}

function recordPointStatistics(next: SetStatistics, score: LiveScore, team: Team, pointAt: string) {
  if (score.serving_team === null) throw new Error('Choose an initial server first.')
  const outcome = team === score.serving_team ? 'won' : 'lost'
  const playerKey = serveStatKeys[score.serving_team][score.serving_player][outcome]
  next[playerKey]++
  if (isGamePoint(score, team) && next.service_game_statistics) {
    const key = `${score.serving_team === 'TEAM_A' ? 'team_a' : 'team_b'}_${outcome}` as keyof ServiceGameStatistics
    next.service_game_statistics = { ...next.service_game_statistics, [key]: next.service_game_statistics[key] + 1 }
  }
  next[team === 'TEAM_A' ? 'team_a_total_points_won' : 'team_b_total_points_won']++
  if (next.streak_team === team) {
    next.current_point_streak++
  } else {
    next.streak_team = team
    next.current_point_streak = 1
  }
  const longestStreakKey = team === 'TEAM_A' ? 'team_a_longest_point_streak' : 'team_b_longest_point_streak'
  next[longestStreakKey] = Math.max(next[longestStreakKey], next.current_point_streak)

  const receiver = score.serving_team === 'TEAM_A' ? 'TEAM_B' : 'TEAM_A'
  if (isGamePoint(score, receiver)) {
    const keys = breakPointKeys[receiver]
    next[keys.chances]++
    if (team === receiver) next[keys.converted]++
    else next[keys.missed]++
  }
  if (next.started_at === null) next.started_at = pointAt
}

export function awardLivePoint(score: LiveScore, team: Team, pointAt = new Date().toISOString()): LiveScore {
  if (getMatchWinner(score)) throw new Error('This match has finished.')
  if (!score.initial_server_chosen || score.serving_team === null) throw new Error('Choose an initial server first.')
  const next = { ...score }
  recordPointStatistics(next, score, team, pointAt)
  const setIndex = score.completed_sets.length
  const setStats = [...(score.set_statistics ?? [])]
  while (setStats.length < setIndex) setStats.push(null)
  if (setStats.length === setIndex) {
    // Never infer a set's earlier points from match-wide totals.
    const hasUntrackedPoints = score.team_a_games + score.team_b_games > 0
      || score.team_a_game_score + score.team_b_game_score > 0
      || (setIndex === 0 && score.started_at !== null)
    if (hasUntrackedPoints) setStats.push(null)
    else setStats.push(emptySetStatistics())
  }
  const currentSet = setStats[setIndex]
  if (currentSet) {
    const updatedSet = { ...currentSet }
    recordPointStatistics(updatedSet, score, team, pointAt)
    setStats[setIndex] = updatedSet
  }
  next.set_statistics = setStats

  if (isTiebreak(score)) {
    const state = { ...getTiebreakScore(score) }
    state[team === 'TEAM_A' ? 'a' : 'b']++
    next.team_a_game_score = 0
    next.team_b_game_score = 0
    next.advantage_team = null
    const decidingSuperTiebreak = isSuperTiebreak(score)
    const tiebreakTarget = decidingSuperTiebreak ? 10 : 7
    if (Math.max(state.a, state.b) >= tiebreakTarget && Math.abs(state.a - state.b) >= 2) {
      const setScore: [number, number] = decidingSuperTiebreak
        ? [state.a, state.b]
        : score.set_format === 'pro_set'
          ? team === 'TEAM_A' ? [9, 8] : [8, 9]
          : team === 'TEAM_A' ? [7, 6] : [6, 7]
      next.completed_sets = [...score.completed_sets, setScore]
      const finishedSet = setStats[setIndex]
      if (finishedSet) setStats[setIndex] = { ...finishedSet, finished_at: pointAt }
      next[team === 'TEAM_A' ? 'team_a_sets' : 'team_b_sets']++
      next.team_a_games = 0
      next.team_b_games = 0
      next.tiebreak_score = null
      if (getMatchWinner(next)) next.finished_at = pointAt
      return withPointHistory(score, { ...next, ...rotateServer({ ...score, serving_team: state.first_team, serving_player: state.first_player }) }, team, pointAt)
    }
    next.tiebreak_score = state
    return withPointHistory(score, { ...next, ...tiebreakServer(state) }, team, pointAt)
  }

  const pointKey = team === 'TEAM_A' ? 'team_a_game_score' : 'team_b_game_score'
  const points = score[pointKey]
  if (points !== 40) {
    next[pointKey] = points === 0 ? 15 : points === 15 ? 30 : 40
    return withPointHistory(score, { ...next, ...rotateServingPlayer(score) }, team, pointAt)
  }
  if (!isGamePoint(score, team)) {
    next.advantage_team = score.advantage_team ? null : team
    return withPointHistory(score, { ...next, ...rotateServingPlayer(score) }, team, pointAt)
  }
  next.advantage_team = null
  next.team_a_game_score = 0
  next.team_b_game_score = 0
  const gameKey = team === 'TEAM_A' ? 'team_a_games' : 'team_b_games'
  next[gameKey]++
  const setGameTarget = score.set_format === 'pro_set' ? 8
    : score.set_format === 'seven_games_no_tiebreak' ? 7 : 6
  const wonNoTiebreakSet = score.set_format === 'seven_games_no_tiebreak'
    && next[gameKey] === 7
    && (Math.abs(next.team_a_games - next.team_b_games) >= 2
      || (next.team_a_games === 7 && next.team_b_games === 6)
      || (next.team_a_games === 6 && next.team_b_games === 7))
  if (wonNoTiebreakSet || (score.set_format !== 'seven_games_no_tiebreak'
    && next[gameKey] >= setGameTarget
    && Math.abs(next.team_a_games - next.team_b_games) >= 2)) {
    next.completed_sets = [...score.completed_sets, [next.team_a_games, next.team_b_games]]
    const finishedSet = setStats[setIndex]
    if (finishedSet) setStats[setIndex] = { ...finishedSet, finished_at: pointAt }
    next[team === 'TEAM_A' ? 'team_a_sets' : 'team_b_sets']++
    next.team_a_games = 0
    next.team_b_games = 0
    if (next.team_a_sets === 1 && next.team_b_sets === 1 && next.third_set_format === 'super_tiebreak') {
      const server = rotateServer(score)
      next.tiebreak_score = { a: 0, b: 0, first_team: server.serving_team, first_player: server.serving_player }
      return withPointHistory(score, { ...next, ...server }, team, pointAt)
    }
  }
  if (getMatchWinner(next)) next.finished_at = pointAt
  const result = { ...next, ...rotateServer(score) }
  if (isTiebreak(result)) result.tiebreak_score = getTiebreakScore({ ...result, tiebreak_score: null })
  return withPointHistory(score, result, team, pointAt)
}

export function resetLiveGame(score: LiveScore): LiveScore {
  const tie = isTiebreak(score) ? getTiebreakScore(score) : null
  return {
    ...score, team_a_game_score: 0, team_b_game_score: 0, advantage_team: null,
    point_history: [...(score.point_history ?? []), createPointHistoryReset(score)],
    ...(tie ? { tiebreak_score: { ...tie, a: 0, b: 0 }, serving_team: tie.first_team, serving_player: tie.first_player } : {}),
  }
}

export function removeLastTeamPoint(score: LiveScore, team: Team, snapshots: LiveScore[] = []): LiveScore {
  const history = score.point_history ?? []
  const index = history.findLastIndex((entry) => entry.type === 'point' && entry.team === team)
  if (index < 0) throw new Error(`Tím ${team === 'TEAM_A' ? 1 : 2} nemá v histórii bod, ktorý možno odobrať.`)
  const baseline = snapshots.findLast((entry) => entry.point_history?.length === index
    && JSON.stringify(entry.point_history) === JSON.stringify(history.slice(0, index)))
  const first = history[0]
  if (!baseline && (!score.point_history_complete || !first?.server)) {
    throw new Error('Starší bod nemožno bezpečne odobrať: chýba úplná história s údajmi o podaní.')
  }
  let original: LiveScore = baseline ?? {
    ...score, ...emptySetStatistics(), team_a_game_score: 0, team_b_game_score: 0,
    team_a_games: 0, team_b_games: 0, team_a_sets: 0, team_b_sets: 0,
    completed_sets: [], set_statistics: [], tiebreak_score: null, advantage_team: null,
    initial_server_chosen: true, serving_team: first.server!.team, serving_player: first.server!.player,
    point_history: [],
  }
  let corrected = original
  const start = baseline ? index : 0
  for (let i = start; i < history.length; i++) {
    const entry = history[i]
    // Preserve deliberate serve changes, not rotations caused by the removed point.
    if (entry.server && (entry.server.team !== original.serving_team || entry.server.player !== original.serving_player)) {
      const server = { serving_team: entry.server.team, serving_player: entry.server.player }
      original = { ...original, ...server }
      corrected = { ...corrected, ...server }
    }
    if (entry.type === 'reset') {
      original = resetLiveGame(original)
      corrected = resetLiveGame(corrected)
    } else {
      if (!entry.played_at && i !== index) {
        throw new Error('Staršia história neobsahuje čas bodov potrebný na bezpečný prepočet.')
      }
      const pointAt = entry.played_at ?? score.started_at
      if (!pointAt) throw new Error('Chýba čas bodu potrebný na bezpečný prepočet.')
      original = awardLivePoint(original, entry.team, pointAt)
      if (i !== index) corrected = awardLivePoint(corrected, entry.team, pointAt)
    }
  }
  const keys = [
    ...POINT_STAT_KEYS, 'team_a_game_score', 'team_b_game_score', 'team_a_games', 'team_b_games',
    'team_a_sets', 'team_b_sets', 'advantage_team', 'tiebreak_score', 'completed_sets',
  ] as const
  if (keys.some((key) => JSON.stringify(original[key] ?? null) !== JSON.stringify(score[key] ?? null))) {
    throw new Error('História nesúhlasí so skóre zápasu. Obnov stránku pred opravou bodu.')
  }
  if (original.serving_team !== score.serving_team || original.serving_player !== score.serving_player) {
    corrected = { ...corrected, serving_team: score.serving_team, serving_player: score.serving_player }
  }
  return corrected
}

export function getPointAnnouncement(previous: LiveScore, updated: LiveScore): { sk: string; en: string } | null {
  if (!previous.initial_server_chosen || previous.serving_team === null || getMatchWinner(previous)) return null
  const scoreKeys = [
    'team_a_game_score', 'team_b_game_score', 'team_a_games',
    'team_b_games', 'team_a_sets', 'team_b_sets', 'advantage_team',
  ] as const
  for (const team of ['TEAM_A', 'TEAM_B'] as const) {
    const expected = awardLivePoint(previous, team)
    if (!scoreKeys.every((key) => (expected[key] ?? null) === (updated[key] ?? null))) continue
    if ((expected.tiebreak_score?.a ?? 0) !== (updated.tiebreak_score?.a ?? 0)
      || (expected.tiebreak_score?.b ?? 0) !== (updated.tiebreak_score?.b ?? 0)) continue
    const teamNumber = team === 'TEAM_A' ? 1 : 2
    const slovakTeam = team === 'TEAM_A' ? 'tím jedna' : 'tím dva'
    const wonGame = isGamePoint(previous, team)
    const gainedAdvantage = updated.advantage_team === team
    const returnedToDeuce = Boolean(previous.advantage_team && !updated.advantage_team && !wonGame)
    if (isTiebreak(previous)) {
      const previousTie = getTiebreakScore(previous)
      const tiebreakA = previousTie.a + (team === 'TEAM_A' ? 1 : 0)
      const tiebreakB = previousTie.b + (team === 'TEAM_B' ? 1 : 0)
      const scoreSk = `${capitalize(spokenScoreNumber(tiebreakA, 'sk'))} ${spokenScoreNumber(tiebreakB, 'sk')}`
      const scoreEn = `${capitalize(spokenScoreNumber(tiebreakA, 'en'))} ${spokenScoreNumber(tiebreakB, 'en')}`
      const wonTiebreak = updated.team_a_sets + updated.team_b_sets > previous.team_a_sets + previous.team_b_sets
      return {
        sk: wonTiebreak ? `Tajbrejk a set pre ${slovakTeam}. ${scoreSk}.` : `Bod pre ${slovakTeam}. ${scoreSk}.`,
        en: wonTiebreak ? `Tiebreak and set for Team ${teamNumber}. ${scoreEn}.` : `Point for Team ${teamNumber}. ${scoreEn}.`,
      }
    }
    if (wonGame) {
      const completedSet = updated.completed_sets.length > previous.completed_sets.length
        ? updated.completed_sets.at(-1)
        : null
      const gamesA = completedSet?.[0] ?? updated.team_a_games
      const gamesB = completedSet?.[1] ?? updated.team_b_games
      const tiedScore = gamesA === gamesB
      return {
        sk: `Gem ${slovakTeam}. Stav gemov: ${spokenScoreNumber(gamesA, 'sk')} ${spokenScoreNumber(gamesB, 'sk')}${tiedScore ? '' : ` pre ${slovakTeam}`}.`,
        en: `Game for Team ${teamNumber}. Game score: ${spokenScoreNumber(gamesA, 'en')} ${spokenScoreNumber(gamesB, 'en')}${tiedScore ? '' : ` for Team ${teamNumber}`}.`,
      }
    }
    if (updated.advantage_team) {
      return {
        sk: `Bod pre ${slovakTeam}. Výhoda pre ${slovakTeam}.`,
        en: `Point for Team ${teamNumber}. Advantage for Team ${teamNumber}.`,
      }
    }
    if (updated.team_a_game_score === 40 && updated.team_b_game_score === 40) {
      const goldenPoint = updated.scoring_type !== 'advantage'
      return {
        sk: `Bod pre ${slovakTeam}. ${goldenPoint ? 'Zlatá loptička' : 'Zhoda'}.`,
        en: `Point for Team ${teamNumber}. ${goldenPoint ? 'Golden point' : 'Deuce'}.`,
      }
    }
    const scoreSk = `${spokenGameScore(updated.team_a_game_score)} ${spokenGameScore(updated.team_b_game_score)}`
    const scoreEn = `${spokenGameScore(updated.team_a_game_score, 'en')} ${spokenGameScore(updated.team_b_game_score, 'en')}`
    return {
      sk: `Bod pre ${slovakTeam}. ${scoreSk}.`,
      en: `Point for Team ${teamNumber}. ${scoreEn}.`,
    }
  }
  return null
}

const slovakScoreNumbers = [
  'nula', 'jeden', 'dva', 'tri', 'štyri', 'päť', 'šesť', 'sedem', 'osem', 'deväť',
  'desať', 'jedenásť', 'dvanásť', 'trinásť', 'štrnásť', 'pätnásť', 'šestnásť',
  'sedemnásť', 'osemnásť', 'devätnásť', 'dvadsať',
]
const englishScoreNumbers = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
]

function spokenScoreNumber(value: number, language: 'sk' | 'en'): string {
  const words = language === 'sk' ? slovakScoreNumbers : englishScoreNumbers
  return words[value] ?? String(value)
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1)
}

function spokenGameScore(value: GameScore, language: 'sk' | 'en' = 'sk'): string {
  if (language === 'en') return ({ 0: 'Love', 15: 'Fifteen', 30: 'Thirty', 40: 'Forty' })[value]
  return ({ 0: 'Nula', 15: 'Pätnásť', 30: 'Tridsať', 40: 'Štyridsať' })[value]
}

export function isPointAnnouncement(text: string): boolean {
  const words = '(?:Nula|Jeden|Dva|Tri|Štyri|Päť|Šesť|Sedem|Osem|Deväť|Desať|Jedenásť|Dvanásť|Trinásť|Štrnásť|Pätnásť|Šestnásť|Sedemnásť|Osemnásť|Devätnásť|Dvadsať|Zero|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty|[0-9]{1,3})'
  const gamePoints = '(?:Nula|Pätnásť|Tridsať|Štyridsať|Love|Fifteen|Thirty|Forty)'
  return new RegExp(`^(?:Bod pre tím (?:jedna|dva)\\. ${gamePoints} ${gamePoints}|Bod pre tím (?:jedna|dva)\\. (?:Výhoda pre tím (?:jedna|dva)|Zhoda|Zlatá loptička)|Gem tím (?:jedna|dva)\\. Stav gemov: ${words} ${words}(?: pre tím (?:jedna|dva))?|Bod pre tím (?:jedna|dva)\\. ${words} ${words}|Tajbrejk a set pre tím (?:jedna|dva)\\. ${words} ${words})\\.$`, 'i').test(text)
    || new RegExp(`^(?:Point for Team [12]\\. ${gamePoints} ${gamePoints}|Point for Team [12]\\. (?:Advantage for Team [12]|Deuce|Golden point)|Game for Team [12]\\. Game score: ${words} ${words}(?: for Team [12])?|Point for Team [12]\\. ${words} ${words}|Tiebreak and set for Team [12]\\. ${words} ${words})\\.$`, 'i').test(text)
}

export function getWinnerAnnouncement(match: Pick<LiveScore, 'team_a_sets' | 'team_b_sets' | 'set_format'> & {
  team_a_player1_name: string
  team_a_player2_name: string
  team_b_player1_name: string
  team_b_player2_name: string
}): { sk: string; en: string } | null {
  const winner = getMatchWinner(match)
  if (!winner) return null
  const names = winner === 'TEAM_A'
    ? [match.team_a_player1_name.trim(), match.team_a_player2_name.trim()]
    : [match.team_b_player1_name.trim(), match.team_b_player2_name.trim()]
  return {
    sk: `Zápas vyhral tím ${winner === 'TEAM_A' ? 'jedna' : 'dva'}. Víťazná dvojica: ${names[0]} a ${names[1]}.`,
    en: `Team ${winner === 'TEAM_A' ? 1 : 2} won the match. The winning pair: ${names[0]} and ${names[1]}.`,
  }
}
