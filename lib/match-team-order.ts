import type { LiveScore } from './live-match-scoring'

export function orderMatchTeams<T>(teamA: T, teamB: T, kioskMode: boolean, score: Pick<LiveScore, 'team_a_sets' | 'team_b_sets'>): [T, T] {
  return kioskMode && (score.team_a_sets + score.team_b_sets) % 2 === 1
    ? [teamB, teamA]
    : [teamA, teamB]
}
