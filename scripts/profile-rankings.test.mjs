import assert from 'node:assert/strict'
import test from 'node:test'
import { profileRankingPositions } from '../lib/ranking-order.ts'

test('profile positions follow leaderboard ELO, wins, name order and regional normalization', () => {
  const players = [
    { id: 4, full_name: 'Alpha', region: 'Žilinský kraj', elo_rating: 1000, matches_won: 3 },
    { id: 3, full_name: 'Beta', region: 'Trenčiansky kraj', elo_rating: 1200, matches_won: 0 },
    { id: 2, full_name: 'Charlie', region: 'Zilinsky', elo_rating: 1000, matches_won: 3 },
    { id: 1, full_name: 'Delta', region: 'Žilinský kraj', elo_rating: 1000, matches_won: 5 },
    { id: 5, full_name: ' ', region: 'Žilinský kraj', elo_rating: 1500, matches_won: 9 },
  ]
  assert.deepEqual(profileRankingPositions(players, 2), { national: 4, regional: 3 })
  assert.deepEqual(profileRankingPositions(players, 1), { national: 2, regional: 1 })
  assert.deepEqual(profileRankingPositions(players, 3), { national: 1, regional: 1 })
  assert.deepEqual(profileRankingPositions(players, 5), { national: null, regional: null })
  assert.deepEqual(profileRankingPositions(players, 99), { national: null, regional: null })
  assert.deepEqual(profileRankingPositions([{ ...players[0], region: '' }], 4), { national: 1, regional: null })
})
