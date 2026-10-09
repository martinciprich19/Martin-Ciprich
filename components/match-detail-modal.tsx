'use client'

import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Calendar, Check, Clock, Hourglass, MapPin, Swords, TrendingDown, TrendingUp, Trophy, X } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { PlayerAvatar as GenderAvatar } from '@/components/player-avatar'
import { fetchArenas } from '@/lib/arenas'
import { fetchMatchDetail, type MatchDetail, type MatchDetailPlayer, type MatchDetailStatus } from '@/lib/match-details'

export const matchDetailKey = (matchId: string) => ['match-detail', matchId] as const

const STATUS_STYLES: Record<MatchDetailStatus, string> = {
  confirmed: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  pending: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  rejected: 'border-red-400/30 bg-red-400/10 text-red-300',
  cancelled: 'border-white/15 bg-white/5 text-white/55',
}

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value)}`

function DeltaBadge({ value, muted = false }: { value: number | null; muted?: boolean }) {
  if (value === null) return <span className="text-white/30">–</span>
  const tone = value > 0 ? 'text-emerald-300' : value < 0 ? 'text-red-300' : 'text-white/60'
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : null
  return <span className={`inline-flex items-center gap-1 font-black tabular-nums ${tone} ${muted ? 'text-xs opacity-80' : 'text-sm'}`}>{Icon ? <Icon size={muted ? 12 : 14} aria-hidden="true" /> : null}{signed(value)}</span>
}

function PlayerAvatar({ player, size = 'md' }: { player: MatchDetailPlayer; size?: 'sm' | 'md' }) {
  const dimension = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-11 w-11 text-sm'
  if (!player.deleted) return <GenderAvatar name={player.name} src={player.avatarUrl} gender={player.gender} className={dimension} />
  return <span aria-hidden="true" className={`${dimension} flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#1d2b44] font-black text-white/80`}>{player.deleted ? '?' : player.name.slice(0, 1).toUpperCase()}</span>
}

function StatBar({ label, left, right, format = (value: number) => String(value) }: { label: string; left: number; right: number; format?: (value: number) => string }) {
  const total = left + right
  const leftShare = total ? (left / total) * 100 : 50
  return <div>
    <div className="flex items-center justify-between text-sm font-black tabular-nums"><span className={left >= right ? 'text-[#ccff00]' : 'text-white/70'}>{format(left)}</span><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{label}</span><span className={right >= left ? 'text-[#ccff00]' : 'text-white/70'}>{format(right)}</span></div>
    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true"><div className="h-full bg-[#ccff00]" style={{ width: `${leftShare}%` }} /><div className="h-full flex-1 bg-[#35d6a2]/60" /></div>
  </div>
}

export function MatchDetailModal({ matchId, currentProfileId, onClose }: { matchId: string; currentProfileId?: string | number | null; onClose: () => void }) {
  const { language, t } = useLanguage()
  const { data: match, error, isLoading } = useSWR(matchDetailKey(matchId), ([, id]) => fetchMatchDetail(id), { revalidateOnFocus: true })
  const { data: arenas = [] } = useSWR('arenas', fetchArenas)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const me = currentProfileId == null ? null : String(currentProfileId)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [])

  const locale = language === 'en' ? 'en-GB' : 'sk-SK'
  const formatDate = (value: string | null, withTime = false) => value
    ? new Intl.DateTimeFormat(locale, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))
    : t('Neuvedené', 'Not set')
  const statusLabel = (detail: MatchDetail) => detail.status === 'confirmed' ? t('Potvrdené', 'Confirmed')
    : detail.status === 'pending' ? t(`Čaká na potvrdenie (${detail.confirmedCount}/${detail.requiredCount})`, `Awaiting confirmation (${detail.confirmedCount}/${detail.requiredCount})`)
    : detail.status === 'cancelled' ? t('Zrušené', 'Cancelled') : t('Sporné / odmietnuté', 'Disputed / rejected')
  const arena = match?.arenaName ? arenas.find((item) => item.name.trim().toLowerCase() === match.arenaName.toLowerCase()) : undefined
  const teamName = (index: 0 | 1) => match?.teams[index].players.map((player) => player.name).join(' & ') || t(`Dvojica ${index + 1}`, `Team ${index + 1}`)

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby="match-detail-title" onClick={(event) => event.stopPropagation()} className="match-detail-sheet relative max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[#0f141d] text-white shadow-2xl sm:rounded-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/[0.08] bg-[#0f141d]/95 px-5 py-4 backdrop-blur sm:px-7">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#ccff00]">{t('Detail zápasu', 'Match details')} · #{matchId}</p>
          <h2 id="match-detail-title" className="mt-1 break-words text-lg font-black sm:text-xl">{match ? `${teamName(0)} vs ${teamName(1)}` : t('Zápas', 'Match')}</h2>
          {match ? <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55"><span className="inline-flex items-center gap-1.5"><Calendar size={13} aria-hidden="true" />{formatDate(match.date)}</span><span className="inline-flex items-center gap-1.5"><MapPin size={13} aria-hidden="true" />{arena ? `${arena.name} · ${arena.city}` : match.arenaName || t('Aréna neuvedená', 'Arena not set')}</span></div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {match ? <span className={`hidden rounded-md border px-2.5 py-1 text-[11px] font-bold sm:inline-block ${STATUS_STYLES[match.status]}`}>{statusLabel(match)}</span> : null}
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={t('Zavrieť', 'Close')} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-white/60 hover:bg-white/5 hover:text-white"><X size={18} /></button>
        </div>
      </header>

      {isLoading && !match ? <p role="status" className="px-7 py-16 text-center text-sm text-white/50">{t('Načítavam detail zápasu…', 'Loading match details…')}</p>
        : error && !match ? <p role="alert" className="px-7 py-12 text-center text-sm text-red-300">{error instanceof Error ? error.message : t('Detail zápasu sa nepodarilo načítať.', 'Could not load match details.')}</p>
        : match ? <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
          <span className={`inline-block rounded-md border px-2.5 py-1 text-[11px] font-bold sm:hidden ${STATUS_STYLES[match.status]}`}>{statusLabel(match)}</span>

          {/* Scoreboard */}
          <section aria-label={t('Výsledková tabuľa', 'Scoreboard')} className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#131924]">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-5 sm:px-6">
              {([0, 1] as const).map((index) => <div key={index} className={`flex min-w-0 flex-col gap-2 ${index === 1 ? 'order-3 items-end text-right' : 'items-start'}`}>
                <div className="flex -space-x-2">{match.teams[index].players.map((player) => <PlayerAvatar key={player.id} player={player} />)}</div>
                <p className="w-full break-words text-sm font-bold leading-snug">{match.teams[index].players.map((player) => <span key={player.id} className="block">{player.name}{player.id === me ? <span className="ml-1.5 rounded bg-[#ccff00]/15 px-1 py-0.5 text-[9px] font-black uppercase text-[#ccff00]">{t('Ty', 'You')}</span> : null}</span>)}</p>
                {match.winnerTeam === index + 1 ? <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#ccff00]"><Trophy size={12} aria-hidden="true" />{t('Víťaz', 'Winner')}</span> : null}
              </div>)}
              <div className="order-2 text-center">
                <p className="text-4xl font-black tabular-nums sm:text-5xl"><span className={match.winnerTeam === 1 ? 'text-[#ccff00]' : ''}>{match.teams[0].setsWon}</span><span className="mx-2 text-white/25">:</span><span className={match.winnerTeam === 2 ? 'text-[#ccff00]' : ''}>{match.teams[1].setsWon}</span></p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{t('Sety', 'Sets')}</p>
              </div>
            </div>
            <div className="overflow-x-auto border-t border-white/[0.08]">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="text-[10px] uppercase tracking-[0.14em] text-white/40"><th scope="col" className="px-4 py-2.5 text-left font-bold sm:px-6">{t('Dvojica', 'Team')}</th>{match.sets.map((set, index) => <th key={index} scope="col" className="px-3 py-2.5 text-center font-bold">{t('Set', 'Set')} {index + 1}{set.tiebreak ? <span className="ml-1 text-[#ccff00]">TB</span> : null}</th>)}<th scope="col" className="px-3 py-2.5 text-center font-bold">{t('Sety', 'Sets')}</th><th scope="col" className="px-4 py-2.5 text-center font-bold sm:px-6">{t('Gemy', 'Games')}</th></tr></thead>
                <tbody>{([0, 1] as const).map((index) => <tr key={index} className="border-t border-white/[0.06]">
                  <th scope="row" className="max-w-[180px] truncate px-4 py-3 text-left font-bold sm:px-6">{match.winnerTeam === index + 1 ? <Trophy size={12} className="mr-1.5 inline text-[#ccff00]" aria-label={t('Víťaz', 'Winner')} /> : null}{teamName(index)}</th>
                  {match.sets.map((set, setIndex) => { const won = set.winner === index + 1; return <td key={setIndex} className={`px-3 py-3 text-center text-base tabular-nums ${won ? 'font-black text-white' : 'text-white/40'}`}>{index === 0 ? set.team1Score : set.team2Score}</td> })}
                  <td className={`px-3 py-3 text-center text-base font-black tabular-nums ${match.winnerTeam === index + 1 ? 'text-[#ccff00]' : 'text-white/60'}`}>{match.teams[index].setsWon}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-white/70 sm:px-6">{match.teams[index].gamesWon}</td>
                </tr>)}</tbody>
              </table>
              {!match.sets.length ? <p className="px-6 pb-4 text-xs text-white/40">{t('Výsledky jednotlivých setov neboli zaznamenané.', 'Individual set scores were not recorded.')}</p> : null}
            </div>
          </section>

          {/* Match statistics */}
          <section className="rounded-xl border border-white/[0.08] bg-[#131924] p-4 sm:p-6">
            <h3 className="flex items-center gap-2 text-sm font-black"><Swords size={15} className="text-[#ccff00]" aria-hidden="true" />{t('Štatistiky zápasu', 'Match statistics')}</h3>
            <div className="mt-5 grid gap-5">
              <StatBar label={t('Vyhraté sety', 'Sets won')} left={match.teams[0].setsWon} right={match.teams[1].setsWon} />
              <StatBar label={t('Vyhraté gemy', 'Games won')} left={match.teams[0].gamesWon} right={match.teams[1].gamesWon} />
              {match.totalGames ? <StatBar label={t('Podiel gemov', 'Games share')} left={match.teams[0].gamesWon / match.totalGames * 100} right={match.teams[1].gamesWon / match.totalGames * 100} format={(value) => `${Math.round(value)} %`} /> : null}
              {match.team1WinProbability !== null ? <StatBar label={t('Predzápasová šanca (ELO)', 'Pre-match win chance (ELO)')} left={match.team1WinProbability * 100} right={(1 - match.team1WinProbability) * 100} format={(value) => `≈${Math.round(value)} %`} /> : null}
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: t('Odohrané gemy', 'Total games'), value: match.totalGames },
                { label: t('Rozdiel gemov', 'Game difference'), value: signed(match.teams[0].gamesWon - match.teams[1].gamesWon) },
                { label: t('Tiebreaky', 'Tiebreaks'), value: match.sets.filter((set) => set.tiebreak).length },
                { label: t('Najtesnejší set', 'Closest set'), value: match.sets.length ? (() => { const closest = match.sets.reduce((best, set) => Math.abs(set.team1Score - set.team2Score) < Math.abs(best.team1Score - best.team2Score) ? set : best); return `${closest.team1Score}:${closest.team2Score}` })() : '–' },
              ].map((item) => <div key={item.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3"><dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{item.label}</dt><dd className="mt-1.5 text-xl font-black tabular-nums">{item.value}</dd></div>)}
            </dl>
          </section>

          {/* ELO */}
          <section className="rounded-xl border border-white/[0.08] bg-[#131924] p-4 sm:p-6">
            <h3 className="flex items-center gap-2 text-sm font-black"><TrendingUp size={15} className="text-[#ccff00]" aria-hidden="true" />{t('Zmeny ELO', 'ELO changes')}</h3>
            {match.status !== 'confirmed' ? <p className="mt-2 text-xs text-white/45">{match.status === 'pending' ? t('ELO a štatistiky sa započítajú až po potvrdení výsledku všetkými hráčmi.', 'ELO and statistics are applied once all players confirm the result.') : t('Tento zápas sa nezapočítava do ELO.', 'This match does not count towards ELO.')}</p> : null}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <thead><tr className="text-[10px] uppercase tracking-[0.14em] text-white/40"><th scope="col" className="py-2 text-left font-bold">{t('Hráč', 'Player')}</th><th scope="col" className="py-2 text-center font-bold">{t('Sezónne ELO', 'Season ELO')}</th><th scope="col" className="py-2 text-center font-bold">{t('ELO od registrácie', 'Career ELO')}</th><th scope="col" className="py-2 text-right font-bold">{t('Aktuálne ELO', 'Current ELO')}</th></tr></thead>
                <tbody>{([0, 1] as const).flatMap((index) => match.teams[index].players.map((player) => <tr key={player.id} className={`border-t border-white/[0.06] ${player.id === me ? 'bg-[#ccff00]/[0.04]' : ''}`}>
                  <td className="py-3 pr-3"><div className="flex items-center gap-2.5"><PlayerAvatar player={player} size="sm" /><div className="min-w-0"><p className="truncate font-bold">{player.name}{player.id === me ? <span className="ml-1.5 text-[10px] font-black uppercase text-[#ccff00]">{t('Ty', 'You')}</span> : null}</p><p className="text-[11px] text-white/40">{t(`Dvojica ${index + 1}`, `Team ${index + 1}`)}{match.winnerTeam === index + 1 ? ` · ${t('víťaz', 'winner')}` : ''}</p></div></div></td>
                  <td className="py-3 text-center"><DeltaBadge value={player.seasonDelta} /></td>
                  <td className="py-3 text-center"><DeltaBadge value={player.careerDelta} muted /></td>
                  <td className="py-3 text-right font-bold tabular-nums text-white/80">{player.deleted || player.currentElo === null ? '–' : player.currentElo}</td>
                </tr>))}</tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            {/* Confirmations */}
            <section className="rounded-xl border border-white/[0.08] bg-[#131924] p-4 sm:p-6">
              <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-black"><Check size={15} className="text-[#ccff00]" aria-hidden="true" />{t('Potvrdenia hráčov', 'Player confirmations')}</h3><span className="text-xs font-bold tabular-nums text-white/50">{match.confirmedCount}/{match.requiredCount}</span></div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${match.requiredCount ? match.confirmedCount / match.requiredCount * 100 : 0}%` }} /></div>
              <ul className="mt-4 space-y-2.5">{match.teams.flatMap((team) => team.players).map((player) => <li key={player.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2"><PlayerAvatar player={player} size="sm" /><span className="truncate">{player.name}</span>{player.isSubmitter ? <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white/45">{t('Zadal', 'Submitted')}</span> : null}</span>
                {player.confirmation === 'confirmed' ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-emerald-300"><Check size={13} aria-hidden="true" />{t('Potvrdil', 'Confirmed')}</span>
                  : player.confirmation === 'rejected' ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-red-300"><X size={13} aria-hidden="true" />{t('Odmietol', 'Rejected')}</span>
                  : <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-white/45"><Hourglass size={13} aria-hidden="true" />{match.status === 'pending' ? t('Čaká sa', 'Waiting') : t('Bez odpovede', 'No response')}</span>}
              </li>)}</ul>
            </section>

            {/* Arena */}
            <section className="rounded-xl border border-white/[0.08] bg-[#131924] p-4 sm:p-6">
              <h3 className="flex items-center gap-2 text-sm font-black"><MapPin size={15} className="text-[#ccff00]" aria-hidden="true" />{t('Aréna', 'Arena')}</h3>
              {arena ? <dl className="mt-4 space-y-2.5 text-sm">
                <div><dt className="sr-only">{t('Názov', 'Name')}</dt><dd className="font-bold">{arena.name}</dd></div>
                {arena.address || arena.city ? <div><dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{t('Adresa', 'Address')}</dt><dd className="mt-0.5 text-white/70">{[arena.address, arena.city].filter(Boolean).join(', ')}</dd></div> : null}
                {arena.courtsCount ? <div><dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{t('Počet kurtov', 'Courts')}</dt><dd className="mt-0.5 text-white/70">{arena.courtsCount}</dd></div> : null}
                {arena.openingHoursWeekday || arena.openingHoursWeekend ? <div><dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{t('Otváracie hodiny', 'Opening hours')}</dt><dd className="mt-0.5 text-white/70">{arena.openingHoursWeekday ? <span className="block">{t('Po–Pi', 'Mon–Fri')}: {arena.openingHoursWeekday}</span> : null}{arena.openingHoursWeekend ? <span className="block">{t('So–Ne', 'Sat–Sun')}: {arena.openingHoursWeekend}</span> : null}</dd></div> : null}
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([arena.name, arena.address, arena.city].filter(Boolean).join(', '))}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[#ccff00] hover:underline"><MapPin size={12} aria-hidden="true" />{t('Zobraziť na mape', 'Show on map')}</a>
              </dl> : <p className="mt-4 text-sm text-white/55">{match.arenaName || t('Aréna nebola zadaná.', 'No arena was recorded.')}</p>}
            </section>
          </div>

          {/* Disputes and discrepancies */}
          {match.discrepancies.length ? <section role="note" className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4 sm:p-5">
            <h3 className="flex items-center gap-2 text-sm font-black text-amber-200"><AlertTriangle size={15} aria-hidden="true" />{t('Spory a nezrovnalosti', 'Disputes & discrepancies')}</h3>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-amber-100/80">{match.discrepancies.map((item) => <li key={item}>{item}</li>)}</ul>
          </section> : null}

          <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t border-white/[0.06] pt-4 text-[11px] text-white/35">
            {match.submittedBy ? <span>{t('Výsledok zadal/a', 'Submitted by')}: <span className="text-white/55">{match.submittedBy.name}</span></span> : null}
            {match.createdAt ? <span className="inline-flex items-center gap-1"><Clock size={11} aria-hidden="true" />{t('Zaznamenané', 'Recorded')}: {formatDate(match.createdAt, true)}</span> : null}
          </footer>
        </div> : null}
    </div>
  </div>
}
