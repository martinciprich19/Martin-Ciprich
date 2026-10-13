'use client'

import { Activity, Target, Trophy, Users } from 'lucide-react'
import { useId, useState } from 'react'
import { useLanguage } from '@/components/language-provider'
import { getMatchStatistics, scoreForSet, type pointSuccess } from '@/lib/match-statistics'
import type { LiveScore } from '@/lib/live-match-scoring'
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

export function MatchStatistics({ match, showAvatars = false, avatars }: { match: StatisticsMatch; showAvatars?: boolean; avatars?: MatchAvatars | null }) {
  const { t } = useLanguage()
  const [selectedSet, setSelectedSet] = useState<number | null>(null)
  const panelId = useId()
  const selectedScore = selectedSet === null ? match : scoreForSet(match, selectedSet)
  const [a, b] = getMatchStatistics(selectedScore ?? match)
  const scopeLabel = selectedSet === null
    ? t('Celý zápas · všetky sety spolu', 'Entire match · all sets combined')
    : `${t('Set', 'Set')} ${selectedSet + 1}`
  const names = [
    [match.team_a_player1_name, match.team_a_player2_name],
    [match.team_b_player1_name, match.team_b_player2_name],
  ]
  return (
    <div className="match-statistics">
      <p className="result-stat-scope">{t('Režim', 'Mode')}: {match.scoring_type === 'advantage' ? t('So zhodou (Výhoda)', 'Standard / Advantage') : 'Golden Point'}</p>
      <div className="result-stat-filter" role="group" aria-label={t('Vybrať štatistiky zápasu alebo setu', 'Choose match or set statistics')}>
        <button type="button" aria-pressed={selectedSet === null} aria-controls={panelId} onClick={() => setSelectedSet(null)}>{t('Celý zápas', 'Entire match')}</button>
        {match.completed_sets.map((set, index) => (
          <button type="button" key={index} aria-pressed={selectedSet === index} aria-controls={panelId} onClick={() => setSelectedSet(index)}>{t('Set', 'Set')} {index + 1}<span>{set[0]} – {set[1]}</span></button>
        ))}
      </div>
      <div id={panelId} className="match-statistics">
      <p className="result-stat-scope" role="status">{scopeLabel}</p>
      {!selectedScore ? <p className="court-stat-warning text-amber-200" role="status">{t('Štatistiky tohto setu neboli zaznamenané. Staršie zápasy sa nedajú spätne presne rozdeliť na sety. Celkové štatistiky nájdeš pod „Celý zápas“.', 'Statistics for this set were not recorded. Older matches cannot be accurately split into sets retrospectively. Overall statistics are available under “Entire match”.')}</p> : <>
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
