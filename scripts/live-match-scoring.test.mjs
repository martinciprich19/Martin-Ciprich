import assert from 'node:assert/strict'
import test from 'node:test'
import { awardLivePoint, getPointAnnouncement, getMatchWinner, getWinnerAnnouncement, rotateServer, rotateServingPlayer } from '../lib/live-match-scoring.ts'

const initial = {
  team_a_game_score: 0, team_b_game_score: 0,
  team_a_games: 0, team_b_games: 0,
  team_a_sets: 0, team_b_sets: 0,
  serving_team: 'TEAM_A', serving_player: 1, initial_server_chosen: true,
  team_a_player1_serve_points_won: 0, team_a_player1_serve_points_lost: 0,
  team_a_player2_serve_points_won: 0, team_a_player2_serve_points_lost: 0,
  team_b_player1_serve_points_won: 0, team_b_player1_serve_points_lost: 0,
  team_b_player2_serve_points_won: 0, team_b_player2_serve_points_lost: 0,
  team_a_total_points_won: 0, team_b_total_points_won: 0,
  streak_team: null, current_point_streak: 0,
  team_a_longest_point_streak: 0, team_b_longest_point_streak: 0,
  team_a_break_points: 0, team_a_break_points_converted: 0, team_a_break_points_missed: 0,
  team_b_break_points: 0, team_b_break_points_converted: 0, team_b_break_points_missed: 0,
  started_at: null, finished_at: null,
  completed_sets: [],
}

test('winner announcement identifies both players only when the match is finished', () => {
  const names = {
    team_a_player1_name: ' Martin ', team_a_player2_name: 'Peter',
    team_b_player1_name: 'Jana', team_b_player2_name: ' Eva ',
  }
  assert.equal(getWinnerAnnouncement({ ...initial, ...names }), null)
  for (const team of ['TEAM_A', 'TEAM_B']) {
    const before = {
      ...initial, ...names,
      team_a_sets: team === 'TEAM_A' ? 1 : 0,
      team_b_sets: team === 'TEAM_B' ? 1 : 0,
      team_a_games: team === 'TEAM_A' ? 5 : 0,
      team_b_games: team === 'TEAM_B' ? 5 : 0,
      team_a_game_score: team === 'TEAM_A' ? 40 : 0,
      team_b_game_score: team === 'TEAM_B' ? 40 : 0,
    }
    const updated = { ...before, ...awardLivePoint(before, team) }
    assert.deepEqual(getWinnerAnnouncement(updated), team === 'TEAM_A' ? {
      sk: 'Zápas vyhral tím jedna. Víťazná dvojica: Martin a Peter.',
      en: 'Team 1 won the match. The winning pair: Martin and Peter.',
    } : {
      sk: 'Zápas vyhral tím dva. Víťazná dvojica: Jana a Eva.',
      en: 'Team 2 won the match. The winning pair: Jana and Eva.',
    })
  }
})

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

test('serve statistics belong to the player serving before the point, based on the winning team', () => {
  const servingTeamWins = awardLivePoint(initial, 'TEAM_A')
  assert.equal(servingTeamWins.team_a_player1_serve_points_won, 1)
  assert.equal(servingTeamWins.team_a_player1_serve_points_lost, 0)
  assert.equal(servingTeamWins.serving_player, 2)

  const receivingTeamWins = awardLivePoint(initial, 'TEAM_B')
  assert.equal(receivingTeamWins.team_a_player1_serve_points_won, 0)
  assert.equal(receivingTeamWins.team_a_player1_serve_points_lost, 1)
  assert.equal(receivingTeamWins.team_b_player1_serve_points_won, 0)

  const teammateServes = awardLivePoint({ ...initial, serving_player: 2 }, 'TEAM_B')
  assert.equal(teammateServes.team_a_player2_serve_points_lost, 1)
  assert.equal(teammateServes.team_a_player1_serve_points_lost, 0)
})

test('total points and longest team streaks include points from every set', () => {
  let score = { ...initial }
  for (const winner of ['TEAM_A', 'TEAM_A', 'TEAM_B', 'TEAM_B', 'TEAM_B', 'TEAM_A']) {
    score = awardLivePoint(score, winner, '2026-10-13T10:00:00.000Z')
  }
  assert.equal(score.team_a_total_points_won, 3)
  assert.equal(score.team_b_total_points_won, 3)
  assert.equal(score.team_a_longest_point_streak, 2)
  assert.equal(score.team_b_longest_point_streak, 3)
  assert.equal(score.current_point_streak, 1)
  assert.equal(score.streak_team, 'TEAM_A')
  assert.equal(score.started_at, '2026-10-13T10:00:00.000Z')
  assert.equal(score.finished_at, null)
})

test('break points are recorded for the receiving team as chances, conversions and misses', () => {
  const opportunity = { ...initial, team_a_game_score: 30, team_b_game_score: 40 }
  const converted = awardLivePoint(opportunity, 'TEAM_B')
  assert.equal(converted.team_b_break_points, 1)
  assert.equal(converted.team_b_break_points_converted, 1)
  assert.equal(converted.team_b_break_points_missed, 0)
  assert.equal(converted.team_b_games, 1)

  const missed = awardLivePoint(opportunity, 'TEAM_A')
  assert.equal(missed.team_b_break_points, 1)
  assert.equal(missed.team_b_break_points_converted, 0)
  assert.equal(missed.team_b_break_points_missed, 1)
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
        sk: `Bod pre tím ${number === 1 ? 'jedna' : 'dva'}.`,
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
        sk: `Bod pre tím ${number === 1 ? 'jedna' : 'dva'}, gem pre tím ${number === 1 ? 'jedna' : 'dva'}.`,
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

test('two sets end the match with exact serve-based player and set statistics', () => {
  for (const team of ['TEAM_A', 'TEAM_B']) {
    let score = { ...initial }
    for (let point = 0; point < 48; point++) {
      score = awardLivePoint(score, team, '2026-10-13T10:00:00.000Z')
      assert.equal(getMatchWinner(score), point < 47 ? null : team)
    }
    assert.deepEqual(score.completed_sets, team === 'TEAM_A' ? [[6, 0], [6, 0]] : [[0, 6], [0, 6]])
    assert.equal(score[team === 'TEAM_A' ? 'team_a_total_points_won' : 'team_b_total_points_won'], 48)
    assert.equal(score.finished_at, score.started_at)
    const servicePoints = [
      score.team_a_player1_serve_points_won, score.team_a_player1_serve_points_lost,
      score.team_a_player2_serve_points_won, score.team_a_player2_serve_points_lost,
      score.team_b_player1_serve_points_won, score.team_b_player1_serve_points_lost,
      score.team_b_player2_serve_points_won, score.team_b_player2_serve_points_lost,
    ].reduce((sum, count) => sum + count, 0)
    assert.equal(servicePoints, 48)
    const restored = JSON.parse(JSON.stringify(score))
    assert.equal(getMatchWinner(restored), team)
    assert.throws(() => awardLivePoint(restored, 'TEAM_A'), /finished/)
  }
})

test('a finished match stores elapsed time endpoints and undo can restore a prior snapshot', () => {
  let score = { ...initial }
  const start = '2026-10-13T10:00:00.000Z'
  const finish = '2026-10-13T11:30:45.000Z'
  for (let point = 0; point < 47; point++) score = awardLivePoint(score, 'TEAM_A', start)
  const history = [{ ...score }]
  assert.equal(score.finished_at, null)
  score = awardLivePoint(score, 'TEAM_A', finish)
  assert.equal(score.started_at, start)
  assert.equal(score.finished_at, finish)
  const seconds = (Date.parse(score.finished_at) - Date.parse(score.started_at)) / 1000
  assert.equal(seconds, 5445)
  const restored = history.pop()
  assert.ok(restored)
  assert.equal(restored.finished_at, null)
  assert.notEqual(restored.team_a_total_points_won, score.team_a_total_points_won)
})

test('a 2-1 match records three sets and player attribution is not guessed', () => {
  let score = { ...initial }
  for (const team of ['TEAM_A', 'TEAM_B', 'TEAM_A']) {
    for (let point = 0; point < 24; point++) score = awardLivePoint(score, team)
  }
  assert.equal(getMatchWinner(score), 'TEAM_A')
  assert.deepEqual(score.completed_sets, [[6, 0], [0, 6], [6, 0]])
  const servicePoints = [
    score.team_a_player1_serve_points_won, score.team_a_player1_serve_points_lost,
    score.team_a_player2_serve_points_won, score.team_a_player2_serve_points_lost,
    score.team_b_player1_serve_points_won, score.team_b_player1_serve_points_lost,
    score.team_b_player2_serve_points_won, score.team_b_player2_serve_points_lost,
  ].reduce((sum, count) => sum + count, 0)
  assert.equal(servicePoints, 72)
  assert.deepEqual(initial.completed_sets, [])
})
