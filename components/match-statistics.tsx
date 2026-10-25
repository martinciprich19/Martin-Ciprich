'use client'

import { Activity, ChevronDown, Target, Trophy, Users } from 'lucide-react'
import { useId, useState } from 'react'
import { useLanguage } from '@/components/language-provider'
import { getMatchStatistics, scoreForSet, type pointSuccess } from '@/lib/match-statistics'
import type { LiveScore, PointHistoryEntry } from '@/lib/live-match-scoring'
import { PlayerAvatar } from '@/components/player-avatar'
import type { MatchAvatars } from '@/lib/live-match-avatars'

type StatisticsMatch = LiveScore & {
  team_a_player1_name: string
  team_a_player2_name: string
  team_b_player1_name: string
  team_b_player2_name: string
}
type Success = ReturnType<typeof pointSuccess>

function successLabel(value: Success) {
  return value.percent === null ? '—' : `${value.percent}% (${value.won}/${value.total})`
}

function ComparisonRow({ label, a, b, aLabel = String(a), bLabel = String(b) }: {
  label: string; a: number; b: number; aLabel?: string; bLabel?: string
}) {
  const max = Math.max(a, b)
  return (
    <div className="result-stat-row" role="row">
      <span role="cell" className={`result-stat-value ${a > b ? 'result-stat-leading-a' : ''}`}>{aLabel}</span>
      <span role="rowheader" className="result-stat-label">{label}</span>
      <span role="cell" className={`result-stat-value result-stat-value-b ${b > a ? 'result-stat-leading-b' : ''}`}>{bLabel}</span>
      <div className="result-stat-bars" aria-hidden="true">
        <div><span className="result-bar-a" style={{ width: `${max === 0 ? 0 : a / max * 100}%` }} /></div>
        <div><span className="result-bar-b" style={{ width: `${max === 0 ? 0 : b / max * 100}%` }} /></div>
      </div>
    </div>
  )
}

export function MatchStatistics({ match, showAvatars = false, avatars, showRules = true }: { match: StatisticsMatch; showAvatars?: boolean; avatars?: MatchAvatars | null; showRules?: boolean }) {
  const { t } = useLanguage()
  const [selectedSet, setSelectedSet] = useState<number | null>(null)
  const panelId = useId()
  const selectedScore = selectedSet === null ? match : scoreForSet(match, selectedSet)
  const [a, b] = getMatchStatistics(selectedScore ?? match)
  const scopeLabel = selectedSet === null
    ? t('Celý zápas · všetky sety spolu', 'Entire match · all sets combined')
    : `${t('Set', 'Set')} ${selectedSet + 1}`
  const pointGroups: { set: number; game: number; tiebreak: boolean; superTiebreak: boolean; entries: PointHistoryEntry[] }[] = []
  for (const entry of (match.point_history ?? []).filter((point) => selectedSet === null || point.set === selectedSet + 1)) {
    const lastGroup = pointGroups.at(-1)
    if (!lastGroup || lastGroup.set !== entry.set || lastGroup.game !== entry.game
      || lastGroup.tiebreak !== entry.tiebreak || lastGroup.superTiebreak !== entry.super_tiebreak) {
      pointGroups.push({
        set: entry.set, game: entry.game, tiebreak: entry.tiebreak,
        superTiebreak: entry.super_tiebreak, entries: [],
      })
    }
    pointGroups.at(-1)?.entries.push(entry)
  }
  const names = [
    [match.team_a_player1_name, match.team_a_player2_name],
    [match.team_b_player1_name, match.team_b_player2_name],
  ]
  return (
    <div className="match-statistics">
      {showRules ? <p className="result-stat-scope">
        {match.scoring_type === 'advantage' ? t('Klasické výhody (Ad)', 'Classic advantage (Ad)') : t('Zlatá loptička (Punto de Oro)', 'Golden point (Punto de Oro)')}
        {' · '}
        {match.set_format === 'pro_set'
          ? t('Historický Pro-Set · tajbrejk za 8:8', 'Legacy Pro-Set · tiebreak at 8:8')
          : match.set_format === 'seven_games_no_tiebreak'
            ? t('Set do 7 gemov · bez tajbrejku', 'Set to 7 games · no tiebreak')
            : t('Klasický set · tajbrejk za 6:6', 'Standard set · tiebreak at 6:6')}
        {match.set_format !== 'pro_set' ? ` · ${t('3. set', 'Deciding set')}: ${match.third_set_format === 'full_set' ? t('plnohodnotný set', 'full set') : t('Super Tiebreak', 'Super Tiebreak')}` : ''}
      </p> : null}
      <div className="result-stat-filter" role="group" aria-label={t('Vybrať štatistiky zápasu alebo setu', 'Choose match or set statistics')}>
        <button type="button" aria-pressed={selectedSet === null} aria-controls={panelId} onClick={() => setSelectedSet(null)}>{t('Celý zápas', 'Entire match')}</button>
        {match.completed_sets.map((set, index) => (
          <button type="button" key={index} aria-pressed={selectedSet === index} aria-controls={panelId} onClick={() => setSelectedSet(index)}>{t('Set', 'Set')} {index + 1}<span>{set[0]} – {set[1]}</span></button>
        ))}
      </div>
      <div id={panelId} className="match-statistics">
      <p className="result-stat-scope" role="status">{scopeLabel}</p>
      <details className="result-point-history">
        <summary>
          <span>{t('Priebeh bod po bode', 'Point-by-point timeline')}</span>
          <span>{pointGroups.reduce((count, group) => count + group.entries.filter((entry) => entry.type === 'point').length, 0)} {t('bodov', 'points')}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <div className="result-point-history-content">
          {match.point_history_complete === false ? <p className="result-point-history-note" role="note">{t('Presný priebeh je dostupný len od zapnutia sledovania bodov. Predchádzajúce body tohto zápasu sa nedajú spätne obnoviť.', 'The exact timeline is available only from when point tracking was enabled. Earlier points in this match cannot be recovered.')}</p> : null}
          {pointGroups.length === 0 ? <p className="result-point-history-note" role="status">{t('V tomto období zatiaľ nie sú zaznamenané body.', 'No points have been recorded for this period yet.')}</p> : (
            <div className="result-point-history-groups">
              {pointGroups.map((group, groupIndex) => {
                const lastEntry = group.entries.at(-1)
                return (
                  <section key={`${group.set}-${group.game}-${groupIndex}`} className="result-point-history-game">
                  <h3>
                    {t('Set', 'Set')} {group.set}
                    {' · '}
                    {group.superTiebreak
                      ? t('Super Tiebreak', 'Super tiebreak')
                      : group.tiebreak
                        ? t('Tajbrejk', 'Tiebreak')
                        : `${t('Gem', 'Game')} ${group.game}`}
                  </h3>
                  <ol>
                    {group.entries.map((entry, entryIndex) => entry.type === 'reset' ? (
                      <li key={`reset-${entryIndex}`} className="result-point-history-reset">
                        {entry.super_tiebreak ? t('Super Tiebreak vynulovaný', 'Super tiebreak reset')
                          : entry.tiebreak ? t('Tajbrejk vynulovaný', 'Tiebreak reset')
                            : t('Skóre gemu vynulované', 'Game score reset')}
                      </li>
                    ) : (
                      <li key={`point-${entryIndex}`} className="result-point-history-point">
                        <span className={`result-point-history-winner ${entry.team === 'TEAM_A' ? 'team-a' : 'team-b'}`}>
                          {entry.team === 'TEAM_A' ? t('Tím 1', 'Team 1') : t('Tím 2', 'Team 2')}
                        </span>
                        <strong className="result-point-history-score">{entry.score_a} – {entry.score_b}</strong>
                        {entry.game_winner ? <span className="result-point-history-outcome">
                          {entry.super_tiebreak ? t('Super Tiebreak', 'Super tiebreak')
                            : entry.tiebreak ? t('Tajbrejk', 'Tiebreak')
                              : t('Gem', 'Game')}
                          {' · '}
                          {entry.team === 'TEAM_A' ? t('Tím 1', 'Team 1') : t('Tím 2', 'Team 2')}
                        </span> : null}
                        {entry.set_winner ? <span className="result-point-history-outcome">
                          {t('Set', 'Set')} {entry.team === 'TEAM_A' ? t('Tím 1', 'Team 1') : t('Tím 2', 'Team 2')}
                        </span> : null}
                      </li>
                    ))}
                  </ol>
                  {lastEntry?.type === 'point' && lastEntry.game_winner ? (
                    <p className="result-point-history-game-score">
                      {group.superTiebreak ? t('Výsledok Super Tiebreaku', 'Super tiebreak score')
                        : group.tiebreak ? t('Výsledok setu', 'Set score')
                          : t('Stav gemov', 'Game score')}
                      : {lastEntry.games_a} – {lastEntry.games_b}
                    </p>
                  ) : null}
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </details>
      {!selectedScore ? <p className="court-stat-warning text-app-amber-200" role="status">{t('Štatistiky tohto setu neboli zaznamenané. Staršie zápasy sa nedajú spätne presne rozdeliť na sety. Celkové štatistiky nájdeš pod „Celý zápas“.', 'Statistics for this set were not recorded. Older matches cannot be accurately split into sets retrospectively. Overall statistics are available under “Entire match”.')}</p> : <>
      <section className="result-comparison" aria-label={`${t('Porovnanie tímov', 'Team comparison')} · ${scopeLabel}`}>
        <div className="result-section-title"><Activity size={17} aria-hidden="true" /><div><h2>{t('Štatistiky tímov', 'Team statistics')}</h2><p>{scopeLabel}</p></div></div>
        <div role="table" aria-label={t('Štatistiky tímov', 'Team statistics')}>
          <div className="result-stat-team-head" role="row">
            <span role="columnheader" className="result-stat-leading-a">{t('Tím 1', 'Team 1')}</span>
            <span role="columnheader" className="sr-only">{t('Štatistika', 'Statistic')}</span>
            <span role="columnheader" className="result-stat-leading-b">{t('Tím 2', 'Team 2')}</span>
          </div>
          <div className="result-stat-group" role="rowgroup">
            <div className="result-stat-category" role="row"><span role="columnheader" aria-colspan={3}>{t('Body a série', 'Points and streaks')}</span></div>
            <ComparisonRow label={t('Body vyhraté celkovo', 'Total points won')} a={a.points.won} b={b.points.won} aLabel={successLabel(a.points)} bLabel={successLabel(b.points)} />
            <ComparisonRow label={t('Najdlhšia séria bodov', 'Longest point streak')} a={a.streak} b={b.streak} />
          </div>
          <div className="result-stat-group" role="rowgroup">
            <div className="result-stat-category" role="row"><span role="columnheader" aria-colspan={3}>{t('Podanie a príjem', 'Serve and return')}</span></div>
            <ComparisonRow label={t('Body vyhraté na podaní', 'Serve points won')} a={a.serve.percent ?? 0} b={b.serve.percent ?? 0} aLabel={successLabel(a.serve)} bLabel={successLabel(b.serve)} />
            <ComparisonRow label={t('Body stratené na podaní', 'Serve points lost')} a={a.serve.lost} b={b.serve.lost} />
            <ComparisonRow label={t('Body vyhraté na príjme', 'Return points won')} a={a.receive.percent ?? 0} b={b.receive.percent ?? 0} aLabel={successLabel(a.receive)} bLabel={successLabel(b.receive)} />
          </div>
          <div className="result-stat-group" role="rowgroup">
            <div className="result-stat-category" role="row"><span role="columnheader" aria-colspan={3}>{t('Brejkbaly', 'Break points')}</span></div>
            <ComparisonRow label={t('Získané brejkbaly', 'Break point opportunities')} a={a.breakPoints} b={b.breakPoints} />
            <ComparisonRow label={t('Využité brejkbaly', 'Break points converted')} a={a.breaksConverted} b={b.breaksConverted} />
            <ComparisonRow label={t('Zahodené brejkbaly', 'Break points missed')} a={a.breaksMissed} b={b.breaksMissed} />
            <ComparisonRow label={t('Úspešnosť brejkbalov', 'Break point conversion')} a={a.breakSuccess.percent ?? 0} b={b.breakSuccess.percent ?? 0} aLabel={successLabel(a.breakSuccess)} bLabel={successLabel(b.breakSuccess)} />
          </div>
          <div className="result-stat-group" role="rowgroup">
            <div className="result-stat-category" role="row"><span role="columnheader" aria-colspan={3}>{t('Gemy a sety', 'Games and sets')}</span></div>
            <ComparisonRow label={t('Vyhraté gemy', 'Games won')} a={a.games} b={b.games} />
            <ComparisonRow label={t('Udržané podanie (gemy)', 'Hold serve (games)')} a={a.hold?.percent ?? 0} b={b.hold?.percent ?? 0} aLabel={a.hold ? successLabel(a.hold) : '—'} bLabel={b.hold ? successLabel(b.hold) : '—'} />
            <ComparisonRow label={t('Vyhraté sety', 'Sets won')} a={a.sets} b={b.sets} />
          </div>
        </div>
      </section>
      <section className="result-player-section" aria-label={t('Štatistiky hráčov', 'Player statistics')}>
        <div className="result-section-title"><Users size={17} aria-hidden="true" /><div><h2>{t('Štatistiky hráčov', 'Player statistics')}</h2><p>{t('Bod sa pripisuje hráčovi, ktorý práve podával.', 'Points are attributed to the player serving at that moment.')}</p></div></div>
        <div className="result-player-grid">
          {[a, b].map((team, teamIndex) => (
            <div key={teamIndex} className="result-player-team" data-team={teamIndex}>
              <h3>{teamIndex === 0 ? t('Tím 1', 'Team 1') : t('Tím 2', 'Team 2')}</h3>
              {team.players.map((player, index) => (
                <article key={index} className="result-player-card">
                  <div className="result-player-heading">{showAvatars ? <PlayerAvatar name={names[teamIndex][index]} src={avatars?.[teamIndex * 2 + index]} className="size-9 text-xs" /> : <span className="result-player-number">{index + 1}</span>}<h4>{names[teamIndex][index]}</h4><Target size={16} aria-hidden="true" /></div>
                  <div className="result-player-rate"><span>{t('Úspešnosť na podaní', 'Serve success')}</span><strong>{player.percent === null ? '—' : `${player.percent}%`}</strong></div>
                  <div className="result-player-progress" aria-hidden="true"><span style={{ width: `${player.percent ?? 0}%` }} /></div>
                  <dl className="result-player-counters">
                    <div><dt>{t('Vyhraté', 'Won')}</dt><dd>{player.won}</dd></div>
                    <div><dt>{t('Stratené', 'Lost')}</dt><dd>{player.lost}</dd></div>
                    <div><dt>{t('Body na podaní', 'Serve points')}</dt><dd>{player.total}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          ))}
        </div>
      </section>
      <p className="result-stat-note"><Trophy size={14} aria-hidden="true" />{t('Percentá ukazujú úspešnosť, zlomky počet vyhratých bodov z celkového počtu. Pomlčka znamená, že nebola zaznamenaná žiadna príležitosť.', 'Percentages show success rates; fractions show wins out of all opportunities. A dash means no opportunities were recorded.')}</p>
      {!a.hold || !b.hold ? <p className="result-stat-note">{t('Gemy na vlastnom podaní neboli zaznamenané. Staršie zápasy sa nedajú spätne presne doplniť.', 'Service games were not recorded. Historical matches cannot be accurately backfilled.')}</p> : null}
      </>}
      </div>
    </div>
  )
}
