export type Team = 'TEAM_A' | 'TEAM_B'
export type GameScore = 0 | 15 | 30 | 40
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

export function awardLivePoint(score: LiveScore, team: Team): LiveScore {
  if (!score.initial_server_chosen || score.serving_team === null) throw new Error('Choose an initial server first.')
  const next = { ...score }
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
    next[team === 'TEAM_A' ? 'team_a_sets' : 'team_b_sets']++
    next.team_a_games = 0
    next.team_b_games = 0
  }
  return { ...next, ...rotateServer(score) }
}

export function getPointAnnouncement(previous: LiveScore, updated: LiveScore): { sk: string; en: string } | null {
  if (!previous.initial_server_chosen || previous.serving_team === null) return null
  const scoreKeys = [
    'team_a_game_score', 'team_b_game_score', 'team_a_games',
    'team_b_games', 'team_a_sets', 'team_b_sets',
  ] as const
  for (const team of ['TEAM_A', 'TEAM_B'] as const) {
    const expected = awardLivePoint(previous, team)
    if (!scoreKeys.every((key) => expected[key] === updated[key])) continue
    const teamNumber = team === 'TEAM_A' ? 1 : 2
    const slovakTeam = team === 'TEAM_A' ? 'jeden' : 'dva'
    const wonGame = previous[team === 'TEAM_A' ? 'team_a_game_score' : 'team_b_game_score'] === 40
    return {
      sk: `Bod pre tím ${slovakTeam}${wonGame ? `, gem pre tím ${slovakTeam}` : ''}.`,
      en: `Point for Team ${teamNumber}${wonGame ? `, game for Team ${teamNumber}` : ''}.`,
    }
  }
  return null
}
