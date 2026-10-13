'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Dice5, RotateCcw, Undo2, Volume2, VolumeX } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'
import { useLanguage } from '@/components/language-provider'
import { getMatchVoice, speakMatchAnnouncement } from '@/lib/match-speech'
import { awardLivePoint, getPointAnnouncement, rotateServingPlayer, type LiveScore, type Team, type GameScore } from '@/lib/live-match-scoring'

type MatchRow = LiveScore & {
  id: string | number
  challenge_id: string | null
  team_a_player1_name: string
  team_b_player1_name: string
  team_a_player2_name: string
  team_b_player2_name: string
  team_a_game_score: GameScore
  team_b_game_score: GameScore
  serving_team: Team | null
  initial_server_chosen: boolean
  is_pin_activated: boolean
}
type MatchSnapshot = LiveScore
type MatchPatch = Partial<MatchSnapshot>

const MATCH_COLUMNS = 'id, challenge_id, team_a_player1_name, team_a_player2_name, team_b_player1_name, team_b_player2_name, team_a_game_score, team_b_game_score, team_a_games, team_b_games, team_a_sets, team_b_sets, serving_team, serving_player, initial_server_chosen, is_pin_activated'

function toCounter(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  throw new Error('Neplatný počet gemov alebo setov. Spusti SQL migráciu 044.')
}

function toScore(value: unknown): GameScore {
  if (value === 0 || value === 15 || value === 30 || value === 40) return value
  throw new Error(`Neplatná hodnota skóre zápasu: ${String(value)}`)
}

function normalizeMatch(row: Record<string, unknown>): MatchRow {
  const servingTeam = row.serving_team
  if (servingTeam !== null && servingTeam !== 'TEAM_A' && servingTeam !== 'TEAM_B') {
    throw new Error('Zápas obsahuje neplatný tím podávajúceho.')
  }
  if (typeof row.initial_server_chosen !== 'boolean') {
    throw new Error('Zápas obsahuje neplatný stav úvodného žrebovania podania.')
  }
  if (row.challenge_id !== null && typeof row.challenge_id !== 'string') {
    throw new Error('Zápas obsahuje neplatné ID výzvy.')
  }
  if (typeof row.is_pin_activated !== 'boolean') {
    throw new Error('Zápas obsahuje neplatný stav aktivácie PIN-u.')
  }
  if (typeof row.id !== 'string' && typeof row.id !== 'number') {
    throw new Error('Zápas neobsahuje platné ID.')
  }
  if (row.serving_player !== 1 && row.serving_player !== 2) {
    throw new Error('Neplatný podávajúci hráč. Spusti SQL migráciu 044.')
  }
  if (typeof row.team_a_player2_name !== 'string' || typeof row.team_b_player2_name !== 'string') {
    throw new Error('Chýbajú mená druhých hráčov. Spusti SQL migráciu 044.')
  }

  return {
    id: row.id,
    challenge_id: row.challenge_id,
    team_a_player1_name: typeof row.team_a_player1_name === 'string' && !['Tím A', 'Tím 1'].includes(row.team_a_player1_name) ? row.team_a_player1_name : 'Hráč 1',
    team_b_player1_name: typeof row.team_b_player1_name === 'string' && !['Tím B', 'Tím 2'].includes(row.team_b_player1_name) ? row.team_b_player1_name : 'Hráč 1',
    team_a_player2_name: row.team_a_player2_name,
    team_b_player2_name: row.team_b_player2_name,
    team_a_games: toCounter(row.team_a_games),
    team_b_games: toCounter(row.team_b_games),
    team_a_sets: toCounter(row.team_a_sets),
    team_b_sets: toCounter(row.team_b_sets),
    serving_player: row.serving_player,
    team_a_game_score: toScore(row.team_a_game_score),
    team_b_game_score: toScore(row.team_b_game_score),
    serving_team: servingTeam,
    initial_server_chosen: row.initial_server_chosen,
    is_pin_activated: row.is_pin_activated,
  }
}

function snapshot(match: MatchRow): MatchSnapshot {
  return {
    team_a_game_score: match.team_a_game_score,
    team_b_game_score: match.team_b_game_score,
    serving_team: match.serving_team,
    initial_server_chosen: match.initial_server_chosen,
    serving_player: match.serving_player,
    team_a_games: match.team_a_games,
    team_b_games: match.team_b_games,
    team_a_sets: match.team_a_sets,
    team_b_sets: match.team_b_sets,
  }
}

function useBleClicker(onTeamAPoint: () => void, onTeamBPoint: () => void, onUndo: () => void, onReset: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select, button'))) return
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return

      switch (event.key.toLowerCase()) {
        case 'a':
          event.preventDefault()
          onTeamAPoint()
          break
        case 'l':
          event.preventDefault()
          onTeamBPoint()
          break
        case 'z':
          event.preventDefault()
          onUndo()
          break
        case 'm':
          event.preventDefault()
          onReset()
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, onTeamAPoint, onTeamBPoint, onUndo, onReset])
}

function formatScore(score: GameScore) {
  return String(score)
}

export function MatchView({ matchId }: { matchId: string }) {
  const { language, setLanguage, t } = useLanguage()
  const languageRef = useRef(language)
  languageRef.current = language
  const [speechStatus, setSpeechStatus] = useState<'loading' | 'ready' | 'unsupported' | 'missing' | 'failed'>('loading')
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)
  const [match, setMatch] = useState<MatchRow | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matchRef = useRef<MatchRow | null>(null)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const historyRef = useRef<MatchSnapshot[]>([])
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const writeRevisionRef = useRef(0)

  useEffect(() => {
    const saved = window.localStorage.getItem('riva-match-muted') === 'true'
    mutedRef.current = saved
    setMuted(saved)
    if (saved && 'speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])

  function toggleMute() {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    window.localStorage.setItem('riva-match-muted', String(next))
  }

  useEffect(() => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setSpeechStatus('unsupported')
      return
    }
    const synthesis = window.speechSynthesis
    synthesis.cancel()
    const updateVoices = () => {
      setSpeechStatus(getMatchVoice(synthesis.getVoices(), language) ? 'ready' : 'missing')
    }
    updateVoices()
    synthesis.addEventListener('voiceschanged', updateVoices)
    return () => {
      synthesis.removeEventListener('voiceschanged', updateVoices)
      synthesis.cancel()
    }
  }, [language])

  const announce = useCallback((slovak: string, english: string) => {
    if (mutedRef.current) return
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setSpeechStatus('unsupported')
      return
    }
    const currentLanguage = languageRef.current
    const utterance = new SpeechSynthesisUtterance(currentLanguage === 'sk' ? slovak : english)
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') return
      console.error('Hlasové hlásenie zápasu zlyhalo:', event.error)
      setSpeechStatus('failed')
    }
    const spoken = speakMatchAnnouncement(window.speechSynthesis, utterance, currentLanguage)
    setSpeechStatus(spoken ? 'ready' : 'missing')
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabaseRef.current = supabase
    let isActive = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    async function loadMatch() {
      try {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId)) {
          throw new Error('Odkaz na zápas nie je platný.')
        }
        const { data, error: queryError } = await supabase
          .from('live_matches')
          .select(MATCH_COLUMNS)
          .eq('id', matchId)
          .maybeSingle()
        if (queryError) throw queryError

        if (!data) throw new Error('Zápas sa nenašiel alebo ešte nemáš prístup.')
        const loaded = normalizeMatch(data)

        if (!isActive) return
        matchRef.current = loaded
        setMatch(loaded)

        channel = supabase
          .channel(`match-score-${loaded.id}`)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'live_matches',
            filter: `id=eq.${loaded.id}`,
          }, (payload) => {
            if (!isActive || payload.eventType === 'DELETE') return
            try {
              const updated = normalizeMatch(payload.new as unknown as Record<string, unknown>)
              const previous = matchRef.current
              const pointAnnouncement = previous ? getPointAnnouncement(previous, updated) : null
              if (pointAnnouncement) {
                announce(pointAnnouncement.sk, pointAnnouncement.en)
              } else if (previous && (updated.serving_team !== previous.serving_team || updated.serving_player !== previous.serving_player) && updated.serving_team !== null) {
                const teamNumber = updated.serving_team === 'TEAM_A' ? 1 : 2
                announce(`Podáva Tím ${teamNumber}, hráč ${updated.serving_player}.`, `Team ${teamNumber}, player ${updated.serving_player} serves.`)
              }
              matchRef.current = updated
              setMatch(updated)
            } catch (realtimeError) {
              const message = realtimeError instanceof Error ? realtimeError.message : 'Prišla neplatná aktualizácia zápasu.'
              console.error('Aktualizácia zápasu cez Realtime zlyhala:', realtimeError)
              setError(message)
            }
          })
          .subscribe((status, subscriptionError) => {
            if (!isActive || status === 'SUBSCRIBED') return
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              const message = subscriptionError?.message ?? 'Spojenie so živými aktualizáciami zápasu zlyhalo.'
              console.error('Realtime pripojenie k zápasu zlyhalo:', message)
              setError(message)
            }
          })
      } catch (loadError: unknown) {
        const message = getErrorMessage(loadError, 'Zápas sa nepodarilo načítať.')
        console.error('Načítanie zápasu zlyhalo:', loadError)
        if (isActive) setError(message)
      } finally {
        if (isActive) setIsLoading(false)
      }
    }

    void loadMatch()
    return () => {
      isActive = false
      if (channel) void supabase.removeChannel(channel)
      if (supabaseRef.current === supabase) supabaseRef.current = null
    }
  }, [matchId, announce])

  const persist = useCallback((patch: MatchPatch) => {
    const current = matchRef.current
    const supabase = supabaseRef.current
    if (!current || !supabase) return

    const optimistic = { ...current, ...patch }
    const revision = ++writeRevisionRef.current
    matchRef.current = optimistic
    setMatch(optimistic)
    setError(null)
    setIsSaving(true)

    writeQueueRef.current = writeQueueRef.current.then(async () => {
      const { data, error: updateError } = await supabase
        .from('live_matches')
        .update(snapshot(optimistic))
        .eq('id', current.id)
        .select(MATCH_COLUMNS)
        .single()
      if (updateError) throw updateError

      const saved = normalizeMatch(data as unknown as Record<string, unknown>)
      if (revision === writeRevisionRef.current) {
        matchRef.current = saved
        setMatch(saved)
      }
    }).catch((saveError: unknown) => {
      const message = saveError instanceof Error ? saveError.message : 'Zmenu zápasu sa nepodarilo uložiť.'
      console.error('Uloženie zápasu do Supabase zlyhalo:', saveError)
      if (revision === writeRevisionRef.current) {
        matchRef.current = current
        setMatch(current)
        setError(message)
      }
    }).finally(() => {
      if (revision === writeRevisionRef.current) setIsSaving(false)
    })
  }, [])

  const awardPoint = useCallback((team: Team) => {
    const current = matchRef.current
    if (!current || !current.initial_server_chosen || (current.challenge_id !== null && !current.is_pin_activated)) return
    historyRef.current.push(snapshot(current))

    const patch = awardLivePoint(snapshot(current), team)

    persist(patch)
    const pointAnnouncement = getPointAnnouncement(current, patch)
    if (pointAnnouncement) announce(pointAnnouncement.sk, pointAnnouncement.en)
  }, [persist, announce])

  const addTeamAPoint = useCallback(() => awardPoint('TEAM_A'), [awardPoint])
  const addTeamBPoint = useCallback(() => awardPoint('TEAM_B'), [awardPoint])

  const undo = useCallback(() => {
    const previous = historyRef.current.pop()
    if (!previous) return
    persist(previous)
    announce(`Posledná zmena bola vrátená. Skóre ${previous.team_a_game_score} ku ${previous.team_b_game_score}.`, `Last change undone. Score ${previous.team_a_game_score} to ${previous.team_b_game_score}.`)
  }, [persist, announce])

  const resetGame = useCallback(() => {
    const current = matchRef.current
    if (!current || (current.team_a_game_score === 0 && current.team_b_game_score === 0)) return
    historyRef.current.push(snapshot(current))
    persist({ team_a_game_score: 0, team_b_game_score: 0 })
    announce('Skóre gemu bolo vynulované.', 'Game score reset.')
  }, [persist, announce])

  const drawServe = useCallback(() => {
    const current = matchRef.current
    if (!current || (current.challenge_id !== null && !current.is_pin_activated)) return
    historyRef.current.push(snapshot(current))
    const servingTeam: Team = Math.random() < 0.5 ? 'TEAM_A' : 'TEAM_B'
    persist({ serving_team: servingTeam, serving_player: 1, initial_server_chosen: true })
    const teamNumber = servingTeam === 'TEAM_A' ? 1 : 2
    announce(`Podáva Tím ${teamNumber}.`, `Team ${teamNumber} serves.`)
  }, [persist, announce])

  function selectServer(team: Team, player: 1 | 2) {
    const current = matchRef.current
    if (!current || (current.challenge_id !== null && !current.is_pin_activated)) return
    historyRef.current.push(snapshot(current))
    persist({ serving_team: team, serving_player: player, initial_server_chosen: true })
    announce(`Podáva Tím ${team === 'TEAM_A' ? 1 : 2}, hráč ${player}.`, `Team ${team === 'TEAM_A' ? 1 : 2}, player ${player} serves.`)
  }

  function nextServer() {
    const current = matchRef.current
    if (!current || !current.initial_server_chosen || (current.challenge_id !== null && !current.is_pin_activated)) return
    const next = rotateServingPlayer(current)
    selectServer(next.serving_team, next.serving_player)
  }

  useBleClicker(addTeamAPoint, addTeamBPoint, undo, resetGame, Boolean(match?.initial_server_chosen && (match.challenge_id === null || match.is_pin_activated)))

  if (isLoading) {
    return <div className="mx-auto max-w-5xl py-24 text-center text-sm text-white/60" role="status">Načítavam zápas…</div>
  }

  if (!match) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-[#0b1b22]/90 p-8 text-center">
        <h1 className="text-3xl font-black sm:text-4xl">Priebeh zápasu</h1>
        <p role="alert" className="mt-4 text-sm text-red-300">{error ?? 'Zápas sa nepodarilo načítať.'}</p>
        <Link href="/match" className="mt-6 inline-block rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold hover:bg-white/5">Späť na výber hry</Link>
      </section>
    )
  }

  const scoreReady = match.initial_server_chosen && (match.challenge_id === null || match.is_pin_activated)

  return (
    <section className="live-court mx-auto max-w-5xl">
      <header className="text-center">
        <Link href="/match" className="mb-5 inline-block text-sm text-white/55 transition hover:text-[#a8e63c]">Späť na výber hry</Link>
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#a8e63c]">RIVA / LIVE SCORE</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Priebeh zápasu</h1>
        <p className="mt-3 text-sm text-white/55">Sleduj skóre naživo a ovládaj ho priamo z kurtu.</p>
      </header>

      <div className="court-toolbar mt-8 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={drawServe} disabled={match.challenge_id !== null && !match.is_pin_activated} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#a8e63c] px-5 py-3 text-sm font-black text-[#061016] transition hover:bg-[#c1fa66] disabled:cursor-not-allowed disabled:opacity-40">
          <Dice5 size={18} aria-hidden="true" /> 🎲 Vylosovať podanie
        </button>
        <div className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#0b1b22]/80 px-4 py-3 text-xs font-semibold text-white/65">
          <span className={`h-2.5 w-2.5 rounded-full ${isSaving ? 'animate-pulse bg-amber-300' : 'bg-[#a8e63c]'}`} />
          {isSaving ? 'Ukladám…' : 'Zápas synchronizovaný'}
        </div>
      </div>

      {error ? <p className="court-error mx-auto mt-4 max-w-2xl rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-center text-sm text-red-200" role="alert">{error}</p> : null}

      <div className="court-summary mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-white/10 bg-[#0b1b22]/90 p-5 text-center">
        <div><p className="text-sm text-white/60">{t('Gemy v aktuálnom sete', 'Games in current set')}</p><p className="mt-2 text-3xl font-black">{match.team_a_games} – {match.team_b_games}</p></div>
        <div><p className="text-sm text-white/60">{t('Sety', 'Sets')}</p><p className="mt-2 text-3xl font-black">{match.team_a_sets} – {match.team_b_sets}</p></div>
      </div>
      <p className="mt-2 text-center text-xs text-white/45">{t('Set do 6 gemov s rozdielom 2, bez tajbrejku.', 'First to at least 6 games with a two-game lead, no tie-break.')}</p>

      <div className="court-teams mt-8 grid gap-4 md:grid-cols-2">
        {([
          { team: 'TEAM_A', label: t('Tím 1', 'Team 1'), players: [match.team_a_player1_name, match.team_a_player2_name], score: match.team_a_game_score },
          { team: 'TEAM_B', label: t('Tím 2', 'Team 2'), players: [match.team_b_player1_name, match.team_b_player2_name], score: match.team_b_game_score },
        ] as const).map(({ team, label, players, score }) => {
          const serving = match.serving_team === team
          return (
            <article key={team} className={`relative overflow-hidden rounded-3xl border bg-[#0b1b22]/90 p-6 transition sm:p-9 ${serving ? 'border-[#a8e63c]/70 shadow-[0_0_35px_rgba(168,230,60,0.15)]' : 'border-white/10'}`}>
              {serving ? <div className="absolute right-5 top-5 rounded-full border border-[#a8e63c]/30 bg-[#a8e63c]/10 px-3 py-1 text-xs font-bold text-[#c1fa66]">🎾 PODÁVA</div> : null}
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">{label}</p>
              <div className="court-players mt-4 grid gap-3">
                {players.map((player, index) => {
                  const playerNumber = index === 0 ? 1 : 2
                  const playerServing = serving && match.serving_player === playerNumber
                  return (
                    <button key={playerNumber} type="button"
                      disabled={match.challenge_id !== null && !match.is_pin_activated}
                      onClick={() => selectServer(team, playerNumber)}
                      aria-pressed={playerServing}
                      aria-label={`${t('Nastaviť podanie', 'Set server')}: ${label}, ${t('Hráč', 'Player')} ${playerNumber}`}
                      className={`rounded-xl border p-4 text-left transition disabled:opacity-40 ${playerServing ? 'border-[#a8e63c] bg-[#a8e63c]/10 shadow-[0_0_18px_rgba(168,230,60,0.2)]' : 'border-white/10 bg-white/[0.03] hover:border-white/30'}`}>
                      <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
                        <span>{t('Hráč', 'Player')} {playerNumber}</span>
                        {playerServing ? <span className="font-bold text-[#c1fa66]">🎾 {t('Podáva', 'Serving')}</span> : null}
                      </span>
                      <span className="mt-2 block text-lg font-bold">{player === 'Hráč 1' ? t('Hráč 1', 'Player 1') : player === 'Hráč 2' ? t('Hráč 2', 'Player 2') : player}</span>
                    </button>
                  )
                })}
              </div>
              <p className="court-points-label mt-8 text-xs font-bold uppercase tracking-[0.18em] text-white/40">Body v geme</p>
              <p className="court-points mt-3 text-center text-[clamp(7rem,18vw,12rem)] font-black leading-none tracking-tight text-white tabular-nums" aria-label={`${label}: ${formatScore(score)} bodov`}>{formatScore(score)}</p>
              <button
                type="button"
                onClick={team === 'TEAM_A' ? addTeamAPoint : addTeamBPoint}
                disabled={!scoreReady}
                aria-label={`Pridať bod pre ${label}`}
                className="mt-7 min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] text-sm font-bold transition hover:border-[#a8e63c]/50 hover:bg-[#a8e63c]/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Bod pre {label} <span className="ml-1 text-white/40">({team === 'TEAM_A' ? 'A' : 'L'})</span>
              </button>
            </article>
          )
        })}
      </div>

      <div className="court-server mt-4 text-center">
        <button type="button" onClick={nextServer} disabled={!scoreReady} className="rounded-xl border border-white/15 px-5 py-3 text-sm font-bold disabled:opacity-40">
          {t('Ďalší podávajúci hráč', 'Next serving player')}
        </button>
        <p className="mt-2 text-xs text-white/45">{t('Po každom bode sa striedajú hráči podávajúceho tímu. Po geme podáva druhý tím.', 'Serving teammates alternate after every point. The other team serves after the game.')}</p>
      </div>

      <div className="court-controls mt-5 flex flex-col items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#0b1b22]/75 p-4 sm:flex-row sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={toggleMute} aria-pressed={muted}
            aria-label={muted ? t('Zapnúť zvuk', 'Enable sound') : t('Vypnúť zvuk', 'Mute sound')}
            className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-bold ${muted ? 'border-amber-300/40 text-amber-200' : 'border-[#a8e63c]/40 text-[#a8e63c]'}`}>
            {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
            {muted ? t('Zvuk vypnutý', 'Sound off') : t('Zvuk zapnutý', 'Sound on')}
          </button>
          <div className="flex items-center gap-2 text-sm text-white/65">
            <Volume2 size={17} className="text-[#a8e63c]" aria-hidden="true" />
            {t('Jazyk hlasového hlásenia', 'Announcement language')}
          </div>
          <div className="flex items-center gap-2" role="group" aria-label={t('Jazyk hlasového hlásenia', 'Announcement language')}>
            {([
              { value: 'sk', label: 'Slovenčina', flag: 'sk' },
              { value: 'en', label: 'English', flag: 'gb' },
            ] as const).map(({ value, label, flag }) => (
              <button
                key={value}
                type="button"
                onClick={() => setLanguage(value)}
                aria-label={label}
                aria-pressed={language === value}
                title={label}
                className={`flex h-11 w-14 items-center justify-center overflow-hidden rounded-lg border p-1.5 transition-colors ${language === value ? 'border-[#ccff00] bg-[#ccff00]/15 ring-2 ring-[#ccff00]/30' : 'border-white/10 bg-[#131924] opacity-60 hover:opacity-100'}`}
              >
                <img src={`/images/flags/${flag}.svg`} alt="" className="h-full w-full rounded-sm object-cover" />
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={undo} disabled={!historyRef.current.length} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-4 text-sm font-semibold text-white/75 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"><Undo2 size={16} aria-hidden="true" /> Späť <kbd className="ml-1 rounded border border-white/15 px-1.5 py-0.5 text-[10px]">Z</kbd></button>
          <button type="button" onClick={resetGame} disabled={match.team_a_game_score === 0 && match.team_b_game_score === 0} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-4 text-sm font-semibold text-white/75 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={16} aria-hidden="true" /> Reset gemu <kbd className="ml-1 rounded border border-white/15 px-1.5 py-0.5 text-[10px]">M</kbd></button>
        </div>
      </div>

      <p role="status" className={`court-status mt-3 text-center text-xs ${speechStatus === 'ready' ? 'text-white/55' : 'text-amber-200'}`}>
        {muted ? t('Hlasové hlásenia sú stíšené.', 'Voice announcements are muted.') : speechStatus === 'ready'
          ? t('Hlasové hlásenie je zapnuté: slovenčina.', 'Voice announcements enabled: English.')
          : speechStatus === 'unsupported'
            ? t('Tento prehliadač nepodporuje hlasové hlásenia.', 'This browser does not support voice announcements.')
            : speechStatus === 'failed'
              ? t('Hlasové hlásenie zlyhalo. Skontroluj zvuk a nastavenia hlasu zariadenia.', 'Voice announcement failed. Check the device sound and voice settings.')
              : speechStatus === 'loading'
                ? t('Načítavam hlasy zariadenia…', 'Loading device voices…')
                : language === 'sk'
                  ? 'Slovenský hlas nie je dostupný. Nainštaluj alebo povoľ slovenský hlas v nastaveniach zariadenia. Anglický hlas sa nepoužije.'
                  : 'No English voice is available. Install or enable an English voice in the device settings.'}
      </p>

      <p className="mt-4 text-center text-xs text-white/35">Skratky: A = bod pre Tím 1 · L = bod pre Tím 2 · Z = späť · M = reset gemu</p>
      {!scoreReady ? <p className="mt-2 text-center text-xs text-[#c1fa66]/80">{match.challenge_id !== null && !match.is_pin_activated ? 'Najprv aktivuj zápas zadaním PIN-u v kiosku.' : 'Najprv vylosuj podanie, aby sa mohlo začať skórovať.'}</p> : null}
    </section>
  )
}
