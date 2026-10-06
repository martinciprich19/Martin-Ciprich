import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMatchDetail, parseSets } from '../lib/match-detail-model.ts'

const profiles = [1, 2, 3, 4].map((id) => ({ id, full_name: `Player ${id}`, elo_rating: 1000 + id, career_elo: 1100 + id, avatar_url: null, email: `p${id}@test.invalid` }))
const baseRow = {
  id: 7, player1_id: 1, team1_player2_id: 2, player2_id: 3, team2_player2_id: 4, winner_id: 1,
  match_date: '2026-10-06T12:00:00Z', created_at: '2026-10-06T14:00:00Z', status: 'confirmed', arena_name: 'Zilinska arena',
  result_sets: [{ team1Score: 6, team2Score: 4 }, { team1Score: 6, team2Score: 7 }, { team1Score: 6, team2Score: 2 }],
  player1_sets_won: 2, player2_sets_won: 1, player1_games_won: 18, player2_games_won: 13,
  submitted_by: 1, rejected_by: null, approved_profile_ids: '{1,2,3,4}',
  elo_delta_team1: 16, elo_delta_team2: -16, career_elo_delta_team1: 12, career_elo_delta_team2: -12,
}

test('confirmed match: scoreboard, per-player ELO, confirmations, win probability', () => {
  const detail = buildMatchDetail(baseRow, profiles)
  assert.equal(detail.status, 'confirmed')
  assert.equal(detail.winnerTeam, 1)
  assert.deepEqual(detail.teams.map((team) => [team.setsWon, team.gamesWon]), [[2, 18], [1, 13]])
  assert.equal(detail.totalGames, 31)
  assert.deepEqual(detail.sets.map((set) => set.tiebreak), [false, true, false])
  assert.deepEqual(detail.teams.flatMap((team) => team.players.map((player) => [player.id, player.seasonDelta, player.careerDelta])), [['1', 16, 12], ['2', 16, 12], ['3', -16, -12], ['4', -16, -12]])
  assert.equal(detail.confirmedCount, 4)
  assert.equal(detail.teams[0].players[0].isSubmitter, true)
  assert.equal(detail.team1WinProbability, 0.5)
  assert.deepEqual(detail.discrepancies, [])
})

test('pending match hides ELO and tracks who still has to confirm', () => {
  const detail = buildMatchDetail({ ...baseRow, status: 'pending', approved_profile_ids: [1, 3] }, profiles)
  assert.equal(detail.confirmedCount, 2)
  assert.deepEqual(detail.teams.flatMap((team) => team.players.map((player) => player.confirmation)), ['confirmed', 'waiting', 'confirmed', 'waiting'])
  assert.ok(detail.teams.every((team) => team.seasonDelta === null && team.players.every((player) => player.seasonDelta === null)))
  assert.equal(detail.team1WinProbability, null)
})

test('rejected match and inconsistent stored totals are reported as discrepancies', () => {
  const detail = buildMatchDetail({ ...baseRow, status: 'rejected', rejected_by: 4, approved_profile_ids: [1, 2], player1_games_won: 20, winner_id: 3 }, profiles)
  assert.equal(detail.status, 'rejected')
  assert.equal(detail.rejectedBy?.name, 'Player 4')
  assert.equal(detail.teams[1].players[1].confirmation, 'rejected')
  assert.equal(detail.discrepancies.length, 3)
  assert.match(detail.discrepancies[0], /Player 4/)
  assert.match(detail.discrepancies.join(' '), /gemov/)
  assert.match(detail.discrepancies.join(' '), /víťaz/)
})

test('falls back to stored totals when set scores are missing; parses legacy formats', () => {
  const detail = buildMatchDetail({ ...baseRow, result_sets: null }, profiles)
  assert.deepEqual(detail.teams.map((team) => [team.setsWon, team.gamesWon]), [[2, 18], [1, 13]])
  assert.deepEqual(parseSets('[[6,3],[7,6]]').map((set) => [set.team1Score, set.team2Score, set.winner]), [[6, 3, 1], [7, 6, 1]])
})
