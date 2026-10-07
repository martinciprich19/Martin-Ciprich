'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { Calendar, Check, MapPin, Send, Swords, Users, X } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { createClient } from '@/lib/supabase/client'
import type { Arena } from '@/lib/arenas'
import { getErrorMessage } from '@/lib/errors'
import { fetchPairs, type PairPlayer, type PlayerPair } from '@/lib/pairs'
import {
  cancelPairChallenge,
  fetchPairChallenge,
  fetchMyPairChallenges,
  type PairChallenge,
  type PairChallengeStatus,
} from '@/lib/pair-challenges'

const statusLabel: Record<PairChallengeStatus, string> = { pending: 'Čaká na odpoveď', accepted: 'Potvrdené', confirmed: 'Potvrdené', declined: 'Odmietnutá', cancelled: 'Zrušená' }
const statusStyle: Record<PairChallengeStatus, string> = {
  pending: 'bg-[#ccff00]/10 text-[#ccff00]',
  accepted: 'bg-emerald-400/10 text-emerald-300',
  confirmed: 'bg-emerald-400/10 text-emerald-300',
  declined: 'bg-red-400/10 text-red-300',
  cancelled: 'bg-white/5 text-white/40',
}

const inputClass = 'w-full rounded-lg border border-white/10 bg-[#0d121a] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#ccff00]/60 focus:ring-2 focus:ring-[#ccff00]/15'
const labelClass = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-white/45'

type PairChallengeViewProps = {
  userId: string
  userName: string
  arenas: Arena[]
  initialArena?: string
  onOpenPairs: () => void
  initialChallengedPair?: { player1Id: string; player1Name: string; player2Id: string; player2Name: string } | null
  onInitialPairApplied?: (value: null) => void
}

const winRate = (player: PairPlayer) => player.matches_played ? Math.round((player.matches_won / player.matches_played) * 100) : 0
const pairElo = (pair: PlayerPair) => Math.round((pair.player_1.elo + pair.player_2.elo) / 2)

export function PairChallengeView({ userId, arenas, initialArena, onOpenPairs, initialChallengedPair, onInitialPairApplied }: PairChallengeViewProps) {
  const { language, t } = useLanguage()
  const [region, setRegion] = useState('')
  const [target, setTarget] = useState<PlayerPair | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const pairs = useSWR('league-pairs', fetchPairs)
  const challenges = useSWR(userId ? ['pair-challenges', userId] : null, () => fetchMyPairChallenges(userId), { refreshInterval: 15000 })
  const dateFormatter = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sk-SK', { dateStyle: 'medium', timeStyle: 'short' })

  const allPairs = pairs.data ?? []
  const myPairs = allPairs.filter((pair) => pair.player_1_id === userId || pair.player_2_id === userId)
  const regions = Array.from(new Set(allPairs.flatMap((pair) => [pair.player_1.region, pair.player_2.region]).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'sk'))
  const opponentPairs = allPairs
    .filter((pair) => !myPairs.includes(pair) && (!region || pair.player_1.region === region || pair.player_2.region === region))
    .sort((a, b) => pairElo(b) - pairElo(a))

  useEffect(() => {
    if (!initialChallengedPair || !pairs.data) return
    const pair = pairs.data.find((item) => item.player_1_id === initialChallengedPair.player1Id && item.player_2_id === initialChallengedPair.player2Id)
    if (pair) setTarget(pair)
    onInitialPairApplied?.(null)
  }, [initialChallengedPair, onInitialPairApplied, pairs.data])

  async function handleCancel(id: string) {
    try {
      await challenges.mutate(async (current: PairChallenge[] | undefined) => {
        await cancelPairChallenge(id, userId)
        return (current ?? []).map((challenge) => challenge.id === id ? { ...challenge, status: 'cancelled' as const } : challenge)
      }, { revalidate: false })
    } catch (error: unknown) {
      const message = getErrorMessage(error, t('Výzvu sa nepodarilo zrušiť.'))
      console.error('Zrušenie výzvy zlyhalo:', message)
      setFeedback({ tone: 'error', message })
    }
  }

  function pairLabel(id1: string, id2: string, player1: PairChallenge['challenger_1'], player2: PairChallenge['challenger_2']) {
    const getName = (profile: PairChallenge['challenger_1'], id: string) => {
      const joinedProfile = Array.isArray(profile) ? profile[0] : profile
      return joinedProfile?.full_name?.trim() || t(`Hráč ${id}`)
    }
    return `${getName(player1, id1)} & ${getName(player2, id2)}`
  }

  return (
    <div className="mx-auto max-w-[1120px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">RIVA /</p>
          <h1 className="mt-2 text-3xl font-black text-balance">{t('Vyzvať dvojicu')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/45 text-pretty">{t('Vyber súperiacu dvojicu vo svojom okolí a navrhni termín zápasu.')}</p>
        </div>
        <button type="button" onClick={onOpenPairs} className="inline-flex items-center gap-2 rounded-lg border border-[#ccff00]/30 px-4 py-2.5 text-sm font-bold text-[#ccff00] transition hover:bg-[#ccff00]/10"><Users size={16} />{t('Pridať dvojicu')}</button>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="block w-full sm:w-72">
          <span className="sr-only">{t('Filtrovať podľa kraja')}</span>
          <select aria-label={t('Filtrovať podľa kraja')} value={region} onChange={(event) => setRegion(event.target.value)} className={inputClass}>
            <option value="">{t('Všetky kraje')}</option>
            {regions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <p className="text-xs text-white/40">{opponentPairs.length} {t('dvojíc')}</p>
      </div>

      {feedback ? <p role="status" className={`mt-4 rounded-lg px-3 py-2 text-sm font-semibold ${feedback.tone === 'success' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'}`}>{feedback.message}</p> : null}
      {pairs.error ? <p role="alert" className="mt-6 rounded-lg border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{getErrorMessage(pairs.error, t('Dvojice sa nepodarilo načítať.'))}</p> : null}
      {pairs.isLoading ? <p role="status" className="py-12 text-center text-sm text-white/50">{t('Načítavam dvojice…')}</p> : null}
      {!pairs.isLoading && !pairs.error && !myPairs.length ? <p className="mt-4 rounded-lg border border-[#ccff00]/20 bg-[#ccff00]/5 px-3 py-2 text-sm text-white/70">{t('Aby si mohol vyzývať, najprv si vytvor dvojicu so spoluhráčom.')}</p> : null}
      {!pairs.isLoading && !pairs.error && !opponentPairs.length ? <div className="mt-6 rounded-xl border border-white/10 bg-[#111722] p-8 text-center text-sm text-white/55">{t('Žiadne dvojice v tomto kraji.')}</div> : null}

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {opponentPairs.map((pair) => (
          <li key={pair.id} className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#131924] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-black">{pair.player_1.full_name} <span className="text-white/40">&</span> {pair.player_2.full_name}</p>
                <p className="mt-1 text-xs text-white/45">{[pair.player_1.region, pair.player_2.region].filter((item, index, list) => item && list.indexOf(item) === index).join(' · ') || '—'}</p>
              </div>
              <div className="shrink-0 text-right"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">{t('Priem. ELO')}</p><p className="text-xl font-bold text-[#ccff00]">{pairElo(pair)}</p></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[pair.player_1, pair.player_2].map((player, index) => (
                <div key={index} className="rounded-xl border border-white/10 bg-[#0b0f17] p-3">
                  <p className="truncate text-xs font-bold">{player.full_name}</p>
                  <dl className="mt-2 space-y-1 text-xs text-white/50">
                    <div className="flex justify-between"><dt>ELO</dt><dd className="font-bold text-white">{player.elo}</dd></div>
                    <div className="flex justify-between"><dt>{t('Zápasy')}</dt><dd className="font-bold text-white">{player.matches_played}</dd></div>
                    <div className="flex justify-between"><dt>{t('Úspešnosť')}</dt><dd className="font-bold text-white">{winRate(player)}%</dd></div>
                  </dl>
                </div>
              ))}
            </div>
            <button type="button" disabled={!myPairs.length} onClick={() => { setFeedback(null); setTarget(pair) }} className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-[#ccff00] px-4 py-3 text-xs font-black text-[#10150d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><Swords size={15} />{t('Vyzvať dvojicu')}</button>
          </li>
        ))}
      </ul>

      <section className="mt-10 rounded-2xl border border-white/[0.08] bg-[#131924] p-5">
        <h2 className="text-sm font-black uppercase tracking-[0.14em]">{t('Moje výzvy')}</h2>
        {!challenges.data?.length ? (
          <p className="mt-4 text-sm leading-relaxed text-white/45">{userId ? t('Zatiaľ si neodoslal žiadnu výzvu.') : t('Prihlás sa, aby si mohol vyzývať dvojice.')}</p>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {challenges.data.map((challenge) => (
              <li key={challenge.id} className="rounded-xl border border-white/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-bold leading-5">{pairLabel(challenge.challenger_1_id, challenge.challenger_2_id, challenge.challenger_1, challenge.challenger_2)} <span className="text-white/40">vs</span> {pairLabel(challenge.challenged_1_id, challenge.challenged_2_id, challenge.challenged_1, challenge.challenged_2)}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${statusStyle[challenge.status]}`}>
                    {challenge.status === 'pending'
                      ? `${Number(challenge.challenger_2_accepted) + Number(challenge.challenged_1_accepted) + Number(challenge.challenged_2_accepted)}/3 ${t('potvrdenia', 'confirmations')}`
                      : t(statusLabel[challenge.status])}
                  </span>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-white/45"><Calendar size={12} />{dateFormatter.format(new Date(challenge.match_date))}</p>
                {challenge.arena_id ? <p className="mt-1 flex items-center gap-1.5 text-xs text-white/45"><MapPin size={12} />{arenas.find((arena) => arena.id === challenge.arena_id)?.name ?? t('Aréna')}</p> : null}
                {challenge.status === 'pending' ? <button type="button" onClick={() => void handleCancel(challenge.id)} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-white/50 hover:text-red-300"><X size={12} />{t('Zrušiť výzvu')}</button> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {target ? (
        <ChallengeDialog
          key={target.id}
          userId={userId}
          target={target}
          myPairs={myPairs}
          arenas={arenas}
          initialArena={initialArena}
          onClose={() => setTarget(null)}
          onSent={async (created) => {
            await challenges.mutate((current: PairChallenge[] | undefined) => [...(current ?? []), created], { revalidate: false })
            setTarget(null)
            setFeedback({ tone: 'success', message: t('Výzva bola odoslaná.') })
          }}
        />
      ) : null}
    </div>
  )
}

function ChallengeDialog({ userId, target, myPairs, arenas, initialArena, onClose, onSent }: {
  userId: string
  target: PlayerPair
  myPairs: PlayerPair[]
  arenas: Arena[]
  initialArena?: string
  onClose: () => void
  onSent: (created: PairChallenge) => Promise<void>
}) {
  const { t } = useLanguage()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [arenaId, setArenaId] = useState(() => arenas.find((arena) => arena.name === initialArena)?.id ?? '')
  const [myPairId, setMyPairId] = useState(myPairs[0]?.id ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    const myPair = myPairs.find((pair) => pair.id === myPairId)
    if (!userId || !myPair) return setError(t('Najprv si vytvor dvojicu so spoluhráčom.'))
    const partnerId = myPair.player_1_id === userId ? myPair.player_2_id : myPair.player_1_id
    if (new Set([userId, partnerId, target.player_1_id, target.player_2_id]).size !== 4) return setError(t('Každý hráč v zápase musí byť odlišný.'))
    const matchDate = new Date(`${date}T${time}`)
    if (Number.isNaN(matchDate.getTime()) || matchDate.getTime() <= Date.now()) return setError(t('Termín musí byť v budúcnosti.'))
    if (!arenaId) return setError(t('Vyber arénu.'))

    setSubmitting(true)
    try {
      const currentUser = { id: Number(userId) }
      const selectedTeammateId = Number(partnerId)
      const opponent1Id = Number(target.player_1_id)
      const opponent2Id = Number(target.player_2_id)
      const matchDateTime = matchDate.toISOString()
      const selectedArenaId = arenaId
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('create_challenge', {
        p_challenger_1_id: currentUser.id,
        p_challenger_2_id: selectedTeammateId,
        p_challenged_1_id: opponent1Id,
        p_challenged_2_id: opponent2Id,
        p_match_date: matchDateTime,
        p_arena_id: selectedArenaId,
      })
      if (rpcError) {
        console.error('Chyba pri vytváraní výzvy:', rpcError)
        throw rpcError
      }
      if (!data) throw new Error(t('Databáza nevrátila vytvorenú výzvu.'))
      const created = await fetchPairChallenge(String(data))
      await onSent(created)
    } catch (sendError: unknown) {
      const message = getErrorMessage(sendError, t('Výzvu sa nepodarilo uložiť.'))
      console.error('Uloženie výzvy zlyhalo:', message)
      setError(message)
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose() }}>
      <form role="dialog" aria-modal="true" onSubmit={(event) => void submit(event)} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#131924] p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">{t('Vyzvať dvojicu')}</h2>
          <button type="button" onClick={onClose} aria-label={t('Zavrieť')} className="text-white/50 hover:text-white"><X size={18} /></button>
        </div>
        <p className="mt-2 text-sm font-semibold text-[#ccff00]">{target.player_1.full_name} &amp; {target.player_2.full_name}</p>
        <div className="mt-5 grid gap-4">
          {myPairs.length > 1 ? (
            <label>
              <span className={labelClass}>{t('Tvoja dvojica')}</span>
              <select value={myPairId} onChange={(event) => setMyPairId(event.target.value)} className={inputClass}>
                {myPairs.map((pair) => <option key={pair.id} value={pair.id}>{pair.player_1.full_name} &amp; {pair.player_2.full_name}</option>)}
              </select>
            </label>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelClass}>{t('Dátum zápasu')}</span>
              <input type="date" required value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} className={`${inputClass} [color-scheme:dark]`} />
            </label>
            <label>
              <span className={labelClass}>{t('Čas zápasu')}</span>
              <input type="time" required step={900} value={time} onChange={(event) => setTime(event.target.value)} className={`${inputClass} [color-scheme:dark]`} />
            </label>
          </div>
          <label>
            <span className={labelClass}>{t('Aréna')}</span>
            <select required value={arenaId} onChange={(event) => setArenaId(event.target.value)} className={inputClass}>
              <option value="">{t('Vyber arénu')}</option>
              {arenas.map((arena) => <option key={arena.id} value={arena.id}>{arena.name} · {arena.city}</option>)}
            </select>
          </label>
        </div>
        {error ? <p role="alert" className="mt-4 rounded-lg bg-red-400/10 px-3 py-2 text-sm font-semibold text-red-300">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-white/10 px-4 py-2.5 text-xs font-bold text-white/70">{t('Zrušiť')}</button>
          <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-[#ccff00] px-4 py-2.5 text-xs font-black text-[#10150d] disabled:opacity-60"><Send size={14} />{submitting ? t('Odosielam…') : t('Odoslať výzvu')}</button>
        </div>
      </form>
    </div>
  )
}
