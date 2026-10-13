export type Team = 'TEAM_A' | 'TEAM_B'
export type GameScore = 0 | 15 | 30 | 40
export type ServiceGameStatistics = { team_a_won: number; team_a_lost: number; team_b_won: number; team_b_lost: number }
export type LiveScore = {
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
  const completedSets: [number, number][] = row.completed_sets.map((set: unknown) => {
    if (!Array.isArray(set) || set.length !== 2 || !set.every((n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) throw new Error('Neplatné výsledky setov v štatistikách.')
    return [set[0], set[1]]
  })
  return {
    ...stats,
    team_a_game_score: 0, team_b_game_score: 0, team_a_games: 0, team_b_games: 0,
    team_a_sets: count('team_a_sets'), team_b_sets: count('team_b_sets'),
    serving_team: null, serving_player: 1, initial_server_chosen: true,
    completed_sets: completedSets, set_statistics: parseSetStatistics(row.set_statistics),
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

export function getMatchWinner(score: Pick<LiveScore, 'team_a_sets' | 'team_b_sets'>): Team | null {
  return score.team_a_sets >= 2 ? 'TEAM_A' : score.team_b_sets >= 2 ? 'TEAM_B' : null
}

export function rotateServer(score: LiveScore): { serving_team: Team; serving_player: 1 | 2 } {
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

function recordPointStatistics(next: SetStatistics, score: LiveScore, team: Team, pointAt: string) {
  if (score.serving_team === null) throw new Error('Choose an initial server first.')
  const outcome = team === score.serving_team ? 'won' : 'lost'
  const playerKey = serveStatKeys[score.serving_team][score.serving_player][outcome]
  next[playerKey]++
  if (score[team === 'TEAM_A' ? 'team_a_game_score' : 'team_b_game_score'] === 40 && next.service_game_statistics) {
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
  const receiverScore = score[receiver === 'TEAM_A' ? 'team_a_game_score' : 'team_b_game_score']
  if (receiverScore === 40) {
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

  const pointKey = team === 'TEAM_A' ? 'team_a_game_score' : 'team_b_game_score'
  const points = score[pointKey]
  if (points !== 40) {
    next[pointKey] = points === 0 ? 15 : points === 15 ? 30 : 40
    return { ...next, ...rotateServingPlayer(score) }
  }
  next.team_a_game_score = 0
  next.team_b_game_score = 0
  const gameKey = team === 'TEAM_A' ? 'team_a_games' : 'team_b_games'
  next[gameKey]++
  if (next[gameKey] >= 6 && Math.abs(next.team_a_games - next.team_b_games) >= 2) {
    next.completed_sets = [...score.completed_sets, [next.team_a_games, next.team_b_games]]
    const finishedSet = setStats[setIndex]
    if (finishedSet) setStats[setIndex] = { ...finishedSet, finished_at: pointAt }
    next[team === 'TEAM_A' ? 'team_a_sets' : 'team_b_sets']++
    next.team_a_games = 0
    next.team_b_games = 0
  }
  if (getMatchWinner(next)) next.finished_at = pointAt
  return { ...next, ...rotateServer(score) }
}

export function getPointAnnouncement(previous: LiveScore, updated: LiveScore): { sk: string; en: string } | null {
  if (!previous.initial_server_chosen || previous.serving_team === null || getMatchWinner(previous)) return null
  const scoreKeys = [
    'team_a_game_score', 'team_b_game_score', 'team_a_games',
    'team_b_games', 'team_a_sets', 'team_b_sets',
  ] as const
  for (const team of ['TEAM_A', 'TEAM_B'] as const) {
    const expected = awardLivePoint(previous, team)
    if (!scoreKeys.every((key) => expected[key] === updated[key])) continue
    const teamNumber = team === 'TEAM_A' ? 1 : 2
    const slovakTeam = team === 'TEAM_A' ? 'tím jedna' : 'tím dva'
    const wonGame = previous[team === 'TEAM_A' ? 'team_a_game_score' : 'team_b_game_score'] === 40
    return {
      sk: `Bod pre ${slovakTeam}${wonGame ? `, gem pre ${slovakTeam}` : ''}.`,
      en: `Point for Team ${teamNumber}${wonGame ? `, game for Team ${teamNumber}` : ''}.`,
    }
  }
  return null
}

export function getWinnerAnnouncement(match: Pick<LiveScore, 'team_a_sets' | 'team_b_sets'> & {
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
