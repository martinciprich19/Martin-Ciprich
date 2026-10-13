import assert from 'node:assert/strict'
import test from 'node:test'
import { awardLivePoint, getPointAnnouncement, rotateServer, rotateServingPlayer } from '../lib/live-match-scoring.ts'

const initial = {
  team_a_game_score: 0, team_b_game_score: 0,
  team_a_games: 0, team_b_games: 0,
  team_a_sets: 0, team_b_sets: 0,
  serving_team: 'TEAM_A', serving_player: 1, initial_server_chosen: true,
}

test('points advance to a game without changing the original snapshot', () => {
  let score = { ...initial }
  for (const points of [15, 30, 40]) {
    score = awardLivePoint(score, 'TEAM_A')
    assert.equal(score.team_a_game_score, points)
    assert.equal(score.team_a_games, 0)
  }
  score = awardLivePoint(score, 'TEAM_A')
  assert.equal(score.team_a_game_score, 0)
  assert.equal(score.team_b_game_score, 0)
  assert.equal(score.team_a_games, 1)
  assert.equal(initial.team_a_game_score, 0)
})

test('each point alternates serving teammates regardless of who wins the point', () => {
  for (const serving_team of ['TEAM_A', 'TEAM_B']) {
    for (const serving_player of [1, 2]) {
      let score = { ...initial, serving_team, serving_player }
      for (const winner of ['TEAM_A', 'TEAM_B', 'TEAM_A', 'TEAM_B']) {
        const previous = score
        score = awardLivePoint(score, winner)
        assert.equal(score.serving_team, serving_team)
        assert.equal(score.serving_player, previous.serving_player === 1 ? 2 : 1)
      }
      assert.equal(score.serving_player, serving_player)
    }
  }
})

test('manual player rotation stays in the serving team and undo restores the server', () => {
  const before = { ...initial }
  const next = { ...before, ...rotateServingPlayer(before) }
  assert.equal(next.serving_team, 'TEAM_A')
  assert.equal(next.serving_player, 2)
  assert.equal(before.serving_player, 1)
  assert.deepEqual({ ...next, ...before }, initial)
})

test('server cycles through all four players, starting from either team', () => {
  for (const serving_team of ['TEAM_A', 'TEAM_B']) {
    let score = { ...initial, serving_team }
    const seen = new Set()
    for (let game = 0; game < 4; game++) {
      seen.add(`${score.serving_team}:${score.serving_player}`)
      score = { ...score, ...rotateServer(score) }
    }
    assert.equal(seen.size, 4)
    assert.equal(score.serving_team, serving_team)
    assert.equal(score.serving_player, 1)
  }
})

test('6-4 wins a set, resets games and rotates the server', () => {
  const before = { ...initial, team_a_games: 5, team_b_games: 4, team_a_game_score: 40, team_b_game_score: 30 }
  const next = awardLivePoint(before, 'TEAM_A')
  assert.equal(next.team_a_sets, 1)
  assert.equal(next.team_a_games, 0)
  assert.equal(next.team_b_games, 0)
  assert.equal(next.serving_team, 'TEAM_B')
  assert.equal(before.team_a_games, 5)
})

test('6-5 and 7-6 do not win; 8-6 wins without a tie-break', () => {
  let score = awardLivePoint({ ...initial, team_a_games: 5, team_b_games: 5, team_a_game_score: 40 }, 'TEAM_A')
  assert.equal(score.team_a_sets, 0)
  score = awardLivePoint({ ...score, team_b_game_score: 40 }, 'TEAM_B')
  assert.equal(score.team_b_games, 6)
  score = awardLivePoint({ ...score, team_a_game_score: 40 }, 'TEAM_A')
  assert.equal(score.team_a_games, 7)
  assert.equal(score.team_a_sets, 0)
  score = awardLivePoint({ ...score, team_a_game_score: 40 }, 'TEAM_A')
  assert.equal(score.team_a_sets, 1)
  assert.equal(score.team_a_games, 0)
})

test('team 2 sets accumulate and undo snapshot restores games, sets and server', () => {
  const before = { ...initial, team_b_games: 5, team_b_sets: 1, team_b_game_score: 40 }
  const history = [{ ...before }]
  const next = awardLivePoint(before, 'TEAM_B')
  assert.equal(next.team_b_sets, 2)
  assert.deepEqual(history.pop(), before)
  assert.throws(() => awardLivePoint({ ...initial, initial_server_chosen: false }, 'TEAM_A'))
})

test('ordinary points announce only the winning team in Slovak and English', () => {
  for (const [team, number] of [['TEAM_A', 1], ['TEAM_B', 2]]) {
    let score = { ...initial }
    for (let point = 0; point < 3; point++) {
      const next = awardLivePoint(score, team)
      assert.deepEqual(getPointAnnouncement(score, next), {
        sk: `Bod pre tím ${number === 1 ? 'jeden' : 'dva'}.`,
        en: `Point for Team ${number}.`,
      })
      score = next
    }
  }
})

test('game and set winners announce point plus game, without statistics', () => {
  for (const [team, number] of [['TEAM_A', 1], ['TEAM_B', 2]]) {
    for (const games of [0, 5]) {
      const before = {
        ...initial,
        [team === 'TEAM_A' ? 'team_a_game_score' : 'team_b_game_score']: 40,
        [team === 'TEAM_A' ? 'team_a_games' : 'team_b_games']: games,
      }
      assert.deepEqual(getPointAnnouncement(before, awardLivePoint(before, team)), {
        sk: `Bod pre tím ${number === 1 ? 'jeden' : 'dva'}, gem pre tím ${number === 1 ? 'jeden' : 'dva'}.`,
        en: `Point for Team ${number}, game for Team ${number}.`,
      })
    }
  }
})

test('Realtime echoes, undo and reset are not announced as awarded points', () => {
  const next = awardLivePoint(initial, 'TEAM_A')
  assert.equal(getPointAnnouncement(next, next), null)
  assert.equal(getPointAnnouncement(next, initial), null)
  assert.equal(getPointAnnouncement({ ...initial, team_a_game_score: 40 }, initial), null)
})
