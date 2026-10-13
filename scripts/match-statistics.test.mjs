import assert from 'node:assert/strict'
import test from 'node:test'
import { getMatchStatistics, pointSuccess, scoreForSet } from '../lib/match-statistics.ts'
import { awardLivePoint, parseSetStatistics, parseServiceGameStatistics, POINT_STAT_KEYS } from '../lib/live-match-scoring.ts'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

function initialScore() {
  const score = {
    serving_team: 'TEAM_A', serving_player: 1, initial_server_chosen: true,
    streak_team: null, started_at: null, finished_at: null, completed_sets: [],
    current_point_streak: 0,
    service_game_statistics: { team_a_won: 0, team_a_lost: 0, team_b_won: 0, team_b_lost: 0 },
  }
  for (const team of ['a', 'b']) {
    for (const key of ['game_score', 'games', 'sets', 'total_points_won', 'longest_point_streak', 'break_points', 'break_points_converted', 'break_points_missed']) {
      score[`team_${team}_${key}`] = 0
    }
    for (const player of [1, 2]) {
      for (const outcome of ['won', 'lost']) score[`team_${team}_player${player}_serve_points_${outcome}`] = 0
    }
  }
  return score
}

test('zero opportunities are unavailable rather than a misleading 0 percent', () => {
  assert.deepEqual(pointSuccess(0, 0), { won: 0, lost: 0, total: 0, percent: null })
  assert.equal(pointSuccess(0, 10).percent, 0)
  assert.equal(pointSuccess(10, 0).percent, 100)
  assert.equal(pointSuccess(1, 2).percent, 33)
  const [a, b] = getMatchStatistics(initialScore())
  assert.equal(a.receive.percent, null)
  assert.equal(b.breakSuccess.percent, null)
})

test('team comparison and each player aggregate the entire two-set match', () => {
  let score = initialScore()
  for (let rally = 0; rally < 48; rally++) {
    score = awardLivePoint(score, 'TEAM_A', new Date(Date.UTC(2026, 9, 13, 12, 0, rally)).toISOString())
  }
  const [a, b] = getMatchStatistics(score)
  assert.equal(a.sets, 2)
  assert.equal(a.games, 12)
  assert.equal(b.games, 0)
  assert.deepEqual(a.points, { won: 48, lost: 0, total: 48, percent: 100 })
  assert.deepEqual(a.serve, { won: 24, lost: 0, total: 24, percent: 100 })
  assert.deepEqual(a.receive, { won: 24, lost: 0, total: 24, percent: 100 })
  assert.deepEqual(b.receive, { won: 0, lost: 24, total: 24, percent: 0 })
  assert.equal(a.players[0].total, 12)
  assert.equal(a.players[1].total, 12)
  assert.equal(b.players[0].lost, 12)
  assert.equal(b.players[1].lost, 12)
  assert.equal(a.streak, 48)
  assert.equal(a.breakPoints, 6)
  assert.equal(a.breaksConverted, 6)
  assert.equal(a.breaksMissed, 0)
  assert.deepEqual(a.hold, { won: 6, lost: 0, total: 6, percent: 100 })
  assert.deepEqual(b.hold, { won: 0, lost: 6, total: 6, percent: 0 })
  assert.equal(getMatchStatistics(scoreForSet(score, 0))[0].hold.total, 3)
})

test('service games track the serving team, preserve undo snapshots and unknown history', () => {
  const before = { ...initialScore(), team_a_game_score: 40, team_b_game_score: 40 }
  const held = awardLivePoint(before, 'TEAM_A')
  const broken = awardLivePoint(before, 'TEAM_B')
  assert.deepEqual(held.service_game_statistics, { team_a_won: 1, team_a_lost: 0, team_b_won: 0, team_b_lost: 0 })
  assert.deepEqual(broken.service_game_statistics, { team_a_won: 0, team_a_lost: 1, team_b_won: 0, team_b_lost: 0 })
  assert.deepEqual(before.service_game_statistics, initialScore().service_game_statistics)
  const historical = awardLivePoint({ ...before, service_game_statistics: null }, 'TEAM_A')
  assert.equal(getMatchStatistics(historical)[0].hold, null)
  assert.equal(parseServiceGameStatistics(undefined), null)
  assert.throws(() => parseServiceGameStatistics({ team_a_won: -1 }), /Neplatné/)
})

test('weighted serve rates, receiving points and three-set games remain accurate', () => {
  const score = {
    ...initialScore(),
    completed_sets: [[6, 4], [3, 6], [9, 7]],
    team_a_sets: 2, team_b_sets: 1,
    team_a_player1_serve_points_won: 9, team_a_player1_serve_points_lost: 1,
    team_a_player2_serve_points_won: 1, team_a_player2_serve_points_lost: 3,
    team_b_player1_serve_points_won: 4, team_b_player1_serve_points_lost: 2,
    team_b_player2_serve_points_won: 2, team_b_player2_serve_points_lost: 2,
    team_a_total_points_won: 14, team_b_total_points_won: 10,
    team_a_break_points: 5, team_a_break_points_converted: 2, team_a_break_points_missed: 3,
  }
  const [a, b] = getMatchStatistics(score)
  assert.equal(a.games, 18)
  assert.equal(b.games, 17)
  assert.equal(a.serve.percent, 71)
  assert.equal(a.receive.won, 4)
  assert.equal(a.receive.total, 10)
  assert.equal(b.receive.won, 4)
  assert.equal(b.receive.total, 14)
  assert.equal(a.breakSuccess.percent, 40)
  assert.equal(a.points.percent, 58)
  assert.equal(b.points.percent, 42)
  assert.equal(a.points.won, a.serve.won + a.receive.won)
})

test('partial historical stats derive returns from recorded serves, not untracked total points', () => {
  const score = { ...initialScore(), team_b_player1_serve_points_won: 2, team_b_player1_serve_points_lost: 3 }
  const [a] = getMatchStatistics(score)
  assert.equal(a.receive.won, 3)
  assert.equal(a.receive.percent, 60)
  assert.equal(a.points.percent, null)
})

test('set filters include the last rally, persist after reload and reset set-only streaks', () => {
  let score = initialScore()
  const history = []
  for (const team of ['TEAM_A', 'TEAM_B', 'TEAM_A']) {
    for (let point = 0; point < 24; point++) {
      history.push(score)
      score = awardLivePoint(score, team, new Date(Date.UTC(2026, 9, 13, 12, 0, history.length)).toISOString())
    }
  }
  assert.equal(score.set_statistics.length, 3)
  const reloaded = { ...score, set_statistics: parseSetStatistics(JSON.parse(JSON.stringify(score.set_statistics))) }
  for (let index = 0; index < 3; index++) {
    const selected = scoreForSet(reloaded, index)
    assert.ok(selected)
    const [a, b] = getMatchStatistics(selected)
    assert.equal(a.points.won + b.points.won, 24)
    assert.equal(a.games + b.games, 6)
    assert.equal(a.sets + b.sets, 1)
    assert.equal(index === 1 ? b.streak : a.streak, 24)
    assert.equal(a.players.reduce((n, p) => n + p.total, 0) + b.players.reduce((n, p) => n + p.total, 0), 24)
    assert.ok(selected.finished_at)
  }
  for (const key of POINT_STAT_KEYS.filter((key) => !key.includes('longest'))) {
    assert.equal(score.set_statistics.reduce((sum, set) => sum + set[key], 0), score[key])
  }
  const undo = history.at(-1)
  assert.equal(undo.set_statistics[2].team_a_total_points_won, 23)
  assert.equal(undo.set_statistics[2].finished_at, null)
  assert.equal(awardLivePoint(undo, 'TEAM_A').set_statistics[2].team_a_total_points_won, 24)
})

test('match streak spans sets but per-set streak does not; legacy sets are unavailable', () => {
  let score = initialScore()
  for (let i = 0; i < 48; i++) score = awardLivePoint(score, 'TEAM_A')
  assert.equal(score.team_a_longest_point_streak, 48)
  assert.equal(score.set_statistics[0].team_a_longest_point_streak, 24)
  assert.equal(score.set_statistics[1].team_a_longest_point_streak, 24)
  const legacy = { ...initialScore(), team_a_games: 5, team_a_game_score: 40, started_at: '2026-10-13T12:00:00Z' }
  let upgraded = awardLivePoint(legacy, 'TEAM_A')
  assert.equal(scoreForSet(upgraded, 0), null)
  for (let i = 0; i < 24; i++) upgraded = awardLivePoint(upgraded, 'TEAM_B')
  assert.equal(upgraded.set_statistics[0], null)
  assert.equal(scoreForSet(upgraded, 1).team_b_total_points_won, 24)
  assert.equal(scoreForSet(upgraded, 2), null)
  assert.throws(() => parseSetStatistics(undefined), /050/)
  assert.throws(() => parseSetStatistics([{}]), /počítadlo/)
  assert.deepEqual(parseSetStatistics([null]), [null])
})

test('050 preserves historical totals and is safe to rerun without wiping new set stats', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated;
      create table live_matches(
        id integer primary key, completed_sets jsonb not null default '[]',
        team_a_sets integer default 0, team_b_sets integer default 0,
        team_a_games integer default 0, team_b_games integer default 0,
        team_a_game_score integer default 0, team_b_game_score integer default 0,
        started_at timestamptz);
      insert into live_matches(id) values (1);
      insert into live_matches(id,completed_sets,team_a_sets,started_at) values
        (2,'[[6,0],[6,0]]',2,'2026-10-13T12:00:00Z'),
        (3,'[[6,0]]',1,'2026-10-13T12:00:00Z');`)
    const sql = await readFile(new URL('./050_live_match_set_statistics.sql', import.meta.url), 'utf8')
    await db.exec(sql)
    assert.deepEqual((await db.query('select set_statistics from live_matches order by id')).rows.map((r) => r.set_statistics), [[], [null, null], [null, null]])
    await db.query('update live_matches set set_statistics=$1 where id=1', [JSON.stringify([{ recorded: true }])])
    await db.exec(sql)
    assert.deepEqual((await db.query('select set_statistics from live_matches where id=1')).rows[0].set_statistics, [{ recorded: true }])
    await assert.rejects(db.exec("update live_matches set set_statistics='[]' where id=2"), /ukonceny/)
    await assert.rejects(db.exec("update live_matches set set_statistics='{}' where id=1"), /live_matches_set_statistics_shape/)
  } finally { await db.close() }
})
