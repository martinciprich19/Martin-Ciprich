import type { LiveScore } from './live-match-scoring'
export type { RecordedMatchStatistics } from './live-match-scoring'


export function scoreForSet(score: LiveScore, index: number): LiveScore | null {
  const stats = score.set_statistics?.[index]
  const games = score.completed_sets[index]
  if (!stats || !games) return null
  return {
    ...score, ...stats, completed_sets: [games],
    service_game_statistics: stats.service_game_statistics ?? null,
    team_a_sets: games[0] > games[1] ? 1 : 0,
    team_b_sets: games[1] > games[0] ? 1 : 0,
    team_a_games: 0, team_b_games: 0,
  }
}

export function pointSuccess(won: number, lost: number) {
  const total = won + lost
  return { won, lost, total, percent: total === 0 ? null : Math.round(won / total * 100) }
}

export function getMatchStatistics(score: LiveScore) {
  const aPlayers = [
    pointSuccess(score.team_a_player1_serve_points_won, score.team_a_player1_serve_points_lost),
    pointSuccess(score.team_a_player2_serve_points_won, score.team_a_player2_serve_points_lost),
  ]
  const bPlayers = [
    pointSuccess(score.team_b_player1_serve_points_won, score.team_b_player1_serve_points_lost),
    pointSuccess(score.team_b_player2_serve_points_won, score.team_b_player2_serve_points_lost),
  ]
  const aServe = pointSuccess(aPlayers[0].won + aPlayers[1].won, aPlayers[0].lost + aPlayers[1].lost)
  const bServe = pointSuccess(bPlayers[0].won + bPlayers[1].won, bPlayers[0].lost + bPlayers[1].lost)
  const serviceGames = score.service_game_statistics
  return [
    {
      players: aPlayers, serve: aServe, receive: pointSuccess(bServe.lost, bServe.won),
      points: pointSuccess(score.team_a_total_points_won, score.team_b_total_points_won),
      sets: score.team_a_sets, games: score.completed_sets.reduce((sum, set) => sum + set[0], 0),
      streak: score.team_a_longest_point_streak, breakPoints: score.team_a_break_points,
      breaksConverted: score.team_a_break_points_converted, breaksMissed: score.team_a_break_points_missed,
      breakSuccess: pointSuccess(score.team_a_break_points_converted, score.team_a_break_points_missed),
      hold: serviceGames ? pointSuccess(serviceGames.team_a_won, serviceGames.team_a_lost) : null,
    },
    {
      players: bPlayers, serve: bServe, receive: pointSuccess(aServe.lost, aServe.won),
      points: pointSuccess(score.team_b_total_points_won, score.team_a_total_points_won),
      sets: score.team_b_sets, games: score.completed_sets.reduce((sum, set) => sum + set[1], 0),
      streak: score.team_b_longest_point_streak, breakPoints: score.team_b_break_points,
      breaksConverted: score.team_b_break_points_converted, breaksMissed: score.team_b_break_points_missed,
      breakSuccess: pointSuccess(score.team_b_break_points_converted, score.team_b_break_points_missed),
      hold: serviceGames ? pointSuccess(serviceGames.team_b_won, serviceGames.team_b_lost) : null,
    },
  ] as const
}
