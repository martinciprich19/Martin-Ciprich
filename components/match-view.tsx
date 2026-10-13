'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Dice5, RotateCcw, Undo2, Volume2, VolumeX } from 'lucide-react'
import { isAuthSessionMissingError } from '@supabase/supabase-js'
import { createQrDeviceClient, getQrDeviceToken } from '@/lib/qr-match-device'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'
import { useLanguage } from '@/components/language-provider'
import { MatchStatistics } from '@/components/match-statistics'
import { PlayerAvatar } from '@/components/player-avatar'
import { parseMatchAvatars, type MatchAvatars } from '@/lib/live-match-avatars'
import { speakMatchAnnouncement } from '@/lib/match-speech'
import { MatchAudio, type MatchSpeechStatus } from '@/lib/match-audio'
import { isTiebreak, getTiebreakScore, parseTiebreakScore } from '@/lib/live-match-scoring'
import { awardLivePoint, getPointAnnouncement, getMatchWinner, getWinnerAnnouncement, parseSetStatistics, parseServiceGameStatistics, type LiveScore, type Team, type GameScore } from '@/lib/live-match-scoring'

type MatchRow = LiveScore & {
  scoring_type: 'golden_point' | 'advantage'
  advantage_team: Team | null
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
  statistics_complete: boolean
  qr_created_by: string | null
  official_result_id: string | null
}
type MatchSnapshot = LiveScore
type MatchPatch = Partial<MatchSnapshot>

const MATCH_COLUMNS = 'id, challenge_id, team_a_player1_name, team_a_player2_name, team_b_player1_name, team_b_player2_name, team_a_game_score, team_b_game_score, team_a_games, team_b_games, team_a_sets, team_b_sets, serving_team, serving_player, initial_server_chosen, is_pin_activated, team_a_player1_serve_points_won, team_a_player1_serve_points_lost, team_a_player2_serve_points_won, team_a_player2_serve_points_lost, team_b_player1_serve_points_won, team_b_player1_serve_points_lost, team_b_player2_serve_points_won, team_b_player2_serve_points_lost, team_a_total_points_won, team_b_total_points_won, streak_team, current_point_streak, team_a_longest_point_streak, team_b_longest_point_streak, team_a_break_points, team_a_break_points_converted, team_a_break_points_missed, team_b_break_points, team_b_break_points_converted, team_b_break_points_missed, started_at, finished_at, completed_sets, statistics_complete, qr_created_by, official_result_id, set_statistics'

function toCounter(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  throw new Error('Neplatná hodnota štatistiky zápasu. Spusti potrebné SQL migrácie 044–046.')
}

function toScore(value: unknown): GameScore {
  if (value === 0 || value === 15 || value === 30 || value === 40) return value
  throw new Error(`Neplatná hodnota skóre zápasu: ${String(value)}`)
}

function toTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Neplatný časový údaj zápasu: ${label}. Spusti SQL migráciu 047.`)
  }
  return value
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

function normalizeMatch(row: Record<string, unknown>): MatchRow {
  const servingTeam = row.serving_team
  const streakTeam = row.streak_team
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
  if (typeof row.statistics_complete !== 'boolean' || !Array.isArray(row.completed_sets)) {
    throw new Error('Chýbajú štatistiky zápasu. Spusti SQL migrácie 045–047.')
  }
  if (streakTeam !== null && streakTeam !== 'TEAM_A' && streakTeam !== 'TEAM_B') {
    throw new Error('Neplatný tím v sérii bodov. Spusti SQL migráciu 047.')
  }
  if (row.qr_created_by !== null && typeof row.qr_created_by !== 'number' && typeof row.qr_created_by !== 'string') {
    throw new Error('Chýba identita organizátora QR zápasu. Spusti SQL migráciu 048.')
  }
  if (row.official_result_id !== null && typeof row.official_result_id !== 'string') {
    throw new Error('Neplatné ID ligového výsledku. Spusti SQL migráciu 048.')
  }
  const completedSets: [number, number][] = row.completed_sets.map((set: unknown) => {
    if (!Array.isArray(set) || set.length !== 2) throw new Error('Neplatné výsledky setov.')
    return [toCounter(set[0]), toCounter(set[1])]
  })
  if (row.scoring_type !== 'golden_point' && row.scoring_type !== 'advantage') {
    throw new Error('Chýbajú pravidlá bodovania. Spusti SQL migráciu 055.')
  }
  if (row.advantage_team !== null && row.advantage_team !== 'TEAM_A' && row.advantage_team !== 'TEAM_B') {
    throw new Error('Neplatný stav výhody. Spusti SQL migráciu 055.')
  }
  if (!('tiebreak_score' in row)) throw new Error('Chýba stav tajbrejku. Spusti SQL migráciu 056.')

  return {
    tiebreak_score: parseTiebreakScore(row.tiebreak_score),
    scoring_type: row.scoring_type,
    advantage_team: row.advantage_team,
    id: row.id,
    qr_created_by: row.qr_created_by === null ? null : String(row.qr_created_by),
    official_result_id: row.official_result_id,
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
    statistics_complete: row.statistics_complete,
    completed_sets: completedSets,
    set_statistics: parseSetStatistics(row.set_statistics),
    service_game_statistics: parseServiceGameStatistics(row.service_game_statistics),
    team_a_player1_serve_points_won: toCounter(row.team_a_player1_serve_points_won),
    team_a_player1_serve_points_lost: toCounter(row.team_a_player1_serve_points_lost),
    team_a_player2_serve_points_won: toCounter(row.team_a_player2_serve_points_won),
    team_a_player2_serve_points_lost: toCounter(row.team_a_player2_serve_points_lost),
    team_b_player1_serve_points_won: toCounter(row.team_b_player1_serve_points_won),
    team_b_player1_serve_points_lost: toCounter(row.team_b_player1_serve_points_lost),
    team_b_player2_serve_points_won: toCounter(row.team_b_player2_serve_points_won),
    team_b_player2_serve_points_lost: toCounter(row.team_b_player2_serve_points_lost),
    team_a_total_points_won: toCounter(row.team_a_total_points_won),
    team_b_total_points_won: toCounter(row.team_b_total_points_won),
    streak_team: streakTeam,
    current_point_streak: toCounter(row.current_point_streak),
    team_a_longest_point_streak: toCounter(row.team_a_longest_point_streak),
    team_b_longest_point_streak: toCounter(row.team_b_longest_point_streak),
    team_a_break_points: toCounter(row.team_a_break_points),
    team_a_break_points_converted: toCounter(row.team_a_break_points_converted),
    team_a_break_points_missed: toCounter(row.team_a_break_points_missed),
    team_b_break_points: toCounter(row.team_b_break_points),
    team_b_break_points_converted: toCounter(row.team_b_break_points_converted),
    team_b_break_points_missed: toCounter(row.team_b_break_points_missed),
    started_at: toTimestamp(row.started_at, 'začiatok'),
    finished_at: toTimestamp(row.finished_at, 'koniec'),
  }
}

function snapshot(match: MatchRow): MatchSnapshot {
  return {
    tiebreak_score: match.tiebreak_score,
    scoring_type: match.scoring_type,
    advantage_team: match.advantage_team,
    team_a_game_score: match.team_a_game_score,
    team_b_game_score: match.team_b_game_score,
    serving_team: match.serving_team,
    initial_server_chosen: match.initial_server_chosen,
    serving_player: match.serving_player,
    team_a_games: match.team_a_games,
    team_b_games: match.team_b_games,
    team_a_sets: match.team_a_sets,
    team_b_sets: match.team_b_sets,
    completed_sets: match.completed_sets,
    set_statistics: match.set_statistics,
    service_game_statistics: match.service_game_statistics,
    team_a_player1_serve_points_won: match.team_a_player1_serve_points_won,
    team_a_player1_serve_points_lost: match.team_a_player1_serve_points_lost,
    team_a_player2_serve_points_won: match.team_a_player2_serve_points_won,
    team_a_player2_serve_points_lost: match.team_a_player2_serve_points_lost,
    team_b_player1_serve_points_won: match.team_b_player1_serve_points_won,
    team_b_player1_serve_points_lost: match.team_b_player1_serve_points_lost,
    team_b_player2_serve_points_won: match.team_b_player2_serve_points_won,
    team_b_player2_serve_points_lost: match.team_b_player2_serve_points_lost,
    team_a_total_points_won: match.team_a_total_points_won,
    team_b_total_points_won: match.team_b_total_points_won,
    streak_team: match.streak_team,
    current_point_streak: match.current_point_streak,
    team_a_longest_point_streak: match.team_a_longest_point_streak,
    team_b_longest_point_streak: match.team_b_longest_point_streak,
    team_a_break_points: match.team_a_break_points,
    team_a_break_points_converted: match.team_a_break_points_converted,
    team_a_break_points_missed: match.team_a_break_points_missed,
    team_b_break_points: match.team_b_break_points,
    team_b_break_points_converted: match.team_b_break_points_converted,
    team_b_break_points_missed: match.team_b_break_points_missed,
    started_at: match.started_at,
    finished_at: match.finished_at,
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

function formatScore(score: number) {
  return String(score)
}

export function MatchView({ matchId }: { matchId: string }) {
  const { language, setLanguage, t } = useLanguage()
  const languageRef = useRef(language)
  languageRef.current = language
  const [speechStatus, setSpeechStatus] = useState<MatchSpeechStatus>('ready')
  const audioRef = useRef<MatchAudio | null>(null)
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)
  const [match, setMatch] = useState<MatchRow | null>(null)
  const [clockNow, setClockNow] = useState<number | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const canEditRef = useRef(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [avatars, setAvatars] = useState<MatchAvatars | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [avatarRetry, setAvatarRetry] = useState(0)
  const matchRef = useRef<MatchRow | null>(null)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const historyRef = useRef<MatchSnapshot[]>([])
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const writeRevisionRef = useRef(0)
  const writeInFlightRef = useRef(false)

  const leagueMatch = Boolean(match && (match.qr_created_by !== null || match.challenge_id !== null))
  useEffect(() => {
    let active = true
    setAvatars(null)
    setAvatarError(null)
    if (!leagueMatch || needsLogin) return
    async function loadAvatars() {
      try {
        const { data, error } = await createClient().rpc('live_match_player_avatars', { p_match_id: matchId })
        if (error) throw error
        const photos = parseMatchAvatars(data)
        if (active) setAvatars(photos)
      } catch (error) {
        console.error('Načítanie profilových fotiek zápasu zlyhalo:', error)
        if (active) setAvatarError(getErrorMessage(error, 'Profilové fotky sa nepodarilo načítať.'))
      }
    }
    void loadAvatars()
    return () => { active = false }
  }, [matchId, leagueMatch, needsLogin, match?.is_pin_activated, avatarRetry])

  useEffect(() => {
    if (!match?.started_at || match.finished_at) {
      setClockNow(null)
      return
    }
    setClockNow(Date.now())
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [match?.started_at, match?.finished_at])

  useEffect(() => {
    const saved = window.localStorage.getItem('riva-match-muted') === 'true'
    mutedRef.current = saved
    setMuted(saved)
    if (saved) audioRef.current?.stop()
  }, [])

  function toggleMute() {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    audioRef.current?.stop()
    window.localStorage.setItem('riva-match-muted', String(next))
  }

  useEffect(() => {
    const audio = new MatchAudio({
      matchId,
      isMuted: () => mutedRef.current,
      onStatus: setSpeechStatus,
      stopFallback: () => {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel()
      },
      fallback: (text, currentLanguage) => {
        if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
          setSpeechStatus('unsupported')
          return
        }
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.onerror = (event) => {
          if (event.error === 'canceled' || event.error === 'interrupted') return
          console.error('Hlasové hlásenie zápasu zlyhalo:', event.error)
          setSpeechStatus('failed')
        }
        const spoken = speakMatchAnnouncement(window.speechSynthesis, utterance, currentLanguage)
        setSpeechStatus(spoken ? 'fallback' : 'missing')
      },
    })
    audioRef.current = audio
    return () => {
      audio.stop()
      if (audioRef.current === audio) audioRef.current = null
    }
  }, [matchId])

  useEffect(() => {
    audioRef.current?.stop()
    setSpeechStatus('ready')
  }, [language])

  const announce = useCallback((slovak: string, english: string) => {
    if (mutedRef.current) return
    const currentLanguage = languageRef.current
    void audioRef.current?.speak(currentLanguage === 'sk' ? slovak : english, currentLanguage)
  }, [])

  const celebrateWinner = useCallback((announcement: { sk: string; en: string }) => {
    const currentLanguage = languageRef.current
    void audioRef.current?.celebrate(announcement[currentLanguage], currentLanguage)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabaseRef.current = supabase
    let scoreClient = supabase
    let isActive = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    async function loadMatch() {
      try {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId)) {
          throw new Error('Odkaz na zápas nie je platný.')
        }
        const { data, error: queryError } = await supabase
          .from('live_matches')
          .select(`${MATCH_COLUMNS}, service_game_statistics, scoring_type, advantage_team, tiebreak_score`)
          .eq('id', matchId)
          .maybeSingle()
        if (queryError) throw queryError

        if (!data) throw new Error('Zápas sa nenašiel alebo ešte nemáš prístup.')
        const loaded = normalizeMatch(data)
        let editable = loaded.qr_created_by === null
        let loginRequired = false
        const deviceToken = loaded.qr_created_by !== null ? getQrDeviceToken(matchId) : null
        if (deviceToken) {
          scoreClient = createQrDeviceClient(deviceToken)
          supabaseRef.current = scoreClient
          editable = true
        } else if (!editable) {
          const { data: authData, error: authError } = await supabase.auth.getUser()
          if (authError && !isAuthSessionMissingError(authError)) throw authError
          loginRequired = !authData.user
          if (authData.user?.email) {
            const { data: organizer, error: organizerError } = await supabase
              .from('proffiles').select('email').eq('id', loaded.qr_created_by).maybeSingle()
            if (organizerError) throw organizerError
            editable = typeof organizer?.email === 'string' && organizer.email.toLowerCase() === authData.user.email.toLowerCase()
          }
        }

        if (!isActive) return
        setNeedsLogin(loginRequired)
        canEditRef.current = editable
        setCanEdit(editable)
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
              const winnerAnnouncement = previous && !getMatchWinner(previous) ? getWinnerAnnouncement(updated) : null
              const pointAnnouncement = previous ? getPointAnnouncement(previous, updated) : null
              if (winnerAnnouncement) {
                if (!writeInFlightRef.current) celebrateWinner(winnerAnnouncement)
              } else if (pointAnnouncement) {
                announce(pointAnnouncement.sk, pointAnnouncement.en)
              } else if (!getMatchWinner(updated) && previous && (updated.serving_team !== previous.serving_team || updated.serving_player !== previous.serving_player) && updated.serving_team !== null) {
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
      if (supabaseRef.current === scoreClient) supabaseRef.current = null
    }
  }, [matchId, announce, celebrateWinner])

  const persist = useCallback((patch: MatchPatch, completionAnnouncement?: { sk: string; en: string }) => {
    const current = matchRef.current
    const supabase = supabaseRef.current
    if (!canEditRef.current || !current || !supabase || getMatchWinner(current) || writeInFlightRef.current) return
    writeInFlightRef.current = true

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
        .eq('team_a_player1_serve_points_won', current.team_a_player1_serve_points_won)
        .eq('team_a_player1_serve_points_lost', current.team_a_player1_serve_points_lost)
        .eq('team_a_player2_serve_points_won', current.team_a_player2_serve_points_won)
        .eq('team_a_player2_serve_points_lost', current.team_a_player2_serve_points_lost)
        .eq('team_b_player1_serve_points_won', current.team_b_player1_serve_points_won)
        .eq('team_b_player1_serve_points_lost', current.team_b_player1_serve_points_lost)
        .eq('team_b_player2_serve_points_won', current.team_b_player2_serve_points_won)
        .eq('team_b_player2_serve_points_lost', current.team_b_player2_serve_points_lost)
        .eq('team_a_total_points_won', current.team_a_total_points_won)
        .eq('team_b_total_points_won', current.team_b_total_points_won)
        .eq('team_a_break_points', current.team_a_break_points)
        .eq('team_b_break_points', current.team_b_break_points)
        .eq('team_a_games', current.team_a_games)
        .eq('team_b_games', current.team_b_games)
        .eq('team_a_sets', current.team_a_sets)
        .eq('team_b_sets', current.team_b_sets)
        .eq('team_a_game_score', current.team_a_game_score)
        .eq('team_b_game_score', current.team_b_game_score)
        .eq('scoring_type', current.scoring_type)
        .filter('advantage_team', current.advantage_team === null ? 'is' : 'eq', current.advantage_team ?? 'null')
        .filter('tiebreak_score', current.tiebreak_score == null ? 'is' : 'eq', current.tiebreak_score == null ? 'null' : JSON.stringify(current.tiebreak_score))
        .eq('set_statistics', JSON.stringify(current.set_statistics))
        .select(`${MATCH_COLUMNS}, service_game_statistics, scoring_type, advantage_team, tiebreak_score`)
        .single()
      if (updateError?.code === 'PGRST116') {
        throw new Error('Zápas sa medzičasom zmenil na inom zariadení. Obnov stránku a skús bod pridať znova.')
      }
      if (updateError) throw updateError

      const saved = normalizeMatch(data as unknown as Record<string, unknown>)
      if (revision === writeRevisionRef.current) {
        matchRef.current = saved
        setMatch(saved)
        if (completionAnnouncement) celebrateWinner(completionAnnouncement)
      }
    }).catch((saveError: unknown) => {
      const message = getErrorMessage(saveError, 'Zmenu zápasu sa nepodarilo uložiť.')
      console.error('Uloženie zápasu do Supabase zlyhalo:', saveError)
      if (revision === writeRevisionRef.current) {
        matchRef.current = current
        setMatch(current)
        setError(message)
      }
    }).finally(() => {
      writeInFlightRef.current = false
      if (revision === writeRevisionRef.current) setIsSaving(false)
    })
  }, [celebrateWinner])

  const awardPoint = useCallback((team: Team) => {
    const current = matchRef.current
    if (!canEditRef.current || !current || writeInFlightRef.current || getMatchWinner(current) || !current.initial_server_chosen || (current.challenge_id !== null && !current.is_pin_activated)) return
    historyRef.current.push(snapshot(current))

    const patch = awardLivePoint(snapshot(current), team)

    const winnerAnnouncement = getWinnerAnnouncement({ ...current, ...patch })
    persist(patch, winnerAnnouncement ?? undefined)
    const pointAnnouncement = getPointAnnouncement(current, patch)
    if (!winnerAnnouncement && pointAnnouncement) announce(pointAnnouncement.sk, pointAnnouncement.en)
  }, [persist, announce])

  const addTeamAPoint = useCallback(() => awardPoint('TEAM_A'), [awardPoint])
  const addTeamBPoint = useCallback(() => awardPoint('TEAM_B'), [awardPoint])

  const undo = useCallback(() => {
    if (!canEditRef.current || writeInFlightRef.current || (matchRef.current && getMatchWinner(matchRef.current))) return
    const previous = historyRef.current.pop()
    if (!previous) return
    persist(previous)
    if (isTiebreak(previous)) {
      announce('Posledná zmena bola vrátená. Tajbrejk.', 'Last change undone. Tiebreak.')
    } else if (previous.advantage_team) {
      announce(`Posledná zmena bola vrátená. Výhoda pre tím ${previous.advantage_team === 'TEAM_A' ? 'jedna' : 'dva'}.`, `Last change undone. Advantage for Team ${previous.advantage_team === 'TEAM_A' ? 1 : 2}.`)
    } else {
      announce(`Posledná zmena bola vrátená. Skóre ${previous.team_a_game_score} ku ${previous.team_b_game_score}.`, `Last change undone. Score ${previous.team_a_game_score} to ${previous.team_b_game_score}.`)
    }
  }, [persist, announce])

  const resetGame = useCallback(() => {
    const current = matchRef.current
    if (!canEditRef.current || !current || writeInFlightRef.current || getMatchWinner(current)) return
    const tie = isTiebreak(current) ? getTiebreakScore(current) : null
    if (tie ? tie.a + tie.b === 0 : current.team_a_game_score + current.team_b_game_score === 0) return
    historyRef.current.push(snapshot(current))
    persist({
      team_a_game_score: 0, team_b_game_score: 0, advantage_team: null,
      ...(tie ? { tiebreak_score: { ...tie, a: 0, b: 0 }, serving_team: tie.first_team, serving_player: tie.first_player } : {}),
    })
    announce(tie ? 'Skóre tajbrejku bolo vynulované.' : 'Skóre gemu bolo vynulované.', tie ? 'Tiebreak score reset.' : 'Game score reset.')
  }, [persist, announce])

  const drawServe = useCallback(() => {
    const current = matchRef.current
    if (!canEditRef.current || !current || current.initial_server_chosen || writeInFlightRef.current || getMatchWinner(current) || (current.challenge_id !== null && !current.is_pin_activated)) return
    const servingTeam: Team = Math.random() < 0.5 ? 'TEAM_A' : 'TEAM_B'
    persist({ serving_team: servingTeam, serving_player: 1, initial_server_chosen: true })
    const teamNumber = servingTeam === 'TEAM_A' ? 1 : 2
    announce(`Podáva Tím ${teamNumber}.`, `Team ${teamNumber} serves.`)
  }, [persist, announce])

  function selectServer(team: Team, player: 1 | 2) {
    const current = matchRef.current
    if (!canEditRef.current || !current || writeInFlightRef.current || getMatchWinner(current) || isTiebreak(current) || (current.challenge_id !== null && !current.is_pin_activated)) return
    if (current.initial_server_chosen) historyRef.current.push(snapshot(current))
    persist({ serving_team: team, serving_player: player, initial_server_chosen: true })
    announce(`Podáva Tím ${team === 'TEAM_A' ? 1 : 2}, hráč ${player}.`, `Team ${team === 'TEAM_A' ? 1 : 2}, player ${player} serves.`)
  }

  useBleClicker(addTeamAPoint, addTeamBPoint, undo, resetGame, Boolean(canEdit && !isSaving && match?.initial_server_chosen && !getMatchWinner(match) && (match.challenge_id === null || match.is_pin_activated)))

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

  const scoreReady = canEdit && !isSaving && match.initial_server_chosen && (match.challenge_id === null || match.is_pin_activated)
  const winner = getMatchWinner(match)
  const tie = isTiebreak(match) ? getTiebreakScore(match) : null
  const durationEnd = match.finished_at ? Date.parse(match.finished_at) : clockNow
  const durationSeconds = match.started_at && durationEnd !== null
    ? Math.floor((durationEnd - Date.parse(match.started_at)) / 1000)
    : 0
  const durationLabel = match.started_at ? formatDuration(durationSeconds) : '00:00'
  const loginNotice = needsLogin ? <p role="status" className="court-stat-warning text-center text-xs text-amber-200">{t('Nie si prihlásený. Zápas môžeš sledovať, ale skóre môže meniť iba prihlásený organizátor.', 'You are not signed in. You can watch the match, but only the signed-in organizer can change the score.')} <Link href="/auth/login" className="underline">{t('Prihlásiť sa', 'Sign in')}</Link></p> : null
  const avatarNotice = avatarError ? <div className="court-avatar-error" role="alert">{t('Profilové fotky sa nepodarilo načítať. Skontroluj SQL migráciu 051.', 'Profile photos could not be loaded. Check SQL migration 051.')} <button type="button" onClick={() => setAvatarRetry((retry) => retry + 1)}>{t('Skúsiť znova', 'Retry')}</button></div> : null
  function resultPlayer(name: string, slot: number) {
    return <span key={slot} className="result-score-player">{leagueMatch ? <PlayerAvatar name={name} src={avatars?.[slot]} className="size-8 text-xs" /> : null}<span>{name}</span></span>
  }
  if (winner) {
    return (
      <section className="live-court court-finished">
        <header><Link href="/match">{t('Späť na výber hry', 'Back to game selection')}</Link><h1>{t('Zápas skončený', 'Match finished')}</h1></header>
        <div className="court-results">
        <div className="result-scoreboard">
          <div className="result-score-team result-stat-leading-a"><h2>{t('Tím 1', 'Team 1')}</h2><div className={leagueMatch ? 'result-score-roster' : 'result-quick-roster'}>{resultPlayer(match.team_a_player1_name, 0)}{resultPlayer(match.team_a_player2_name, 1)}</div></div>
          <div className="result-score-center"><span>{t('Konečný výsledok', 'Final result')}</span><strong>{match.team_a_sets}<span>:</span>{match.team_b_sets}</strong><p>{t('Víťaz', 'Winner')}: {winner === 'TEAM_A' ? t('Tím 1', 'Team 1') : t('Tím 2', 'Team 2')}</p></div>
          <div className="result-score-team result-stat-leading-b"><h2>{t('Tím 2', 'Team 2')}</h2><div className={leagueMatch ? 'result-score-roster' : 'result-quick-roster'}>{resultPlayer(match.team_b_player1_name, 2)}{resultPlayer(match.team_b_player2_name, 3)}</div></div>
          <div className="result-match-meta">
            <span>{t('Trvanie zápasu', 'Match duration')}: <strong>{match.started_at && match.finished_at ? formatDuration(durationSeconds) : t('Nedostupné', 'Unavailable')}</strong></span>
            <div className="court-set-results">{match.completed_sets.map((set, index) => <span key={index}>{t('Set', 'Set')} {index + 1} <strong>{set[0]} – {set[1]}</strong></span>)}</div>
          </div>
          {avatarNotice}
          {loginNotice}
        </div>
        <p role="status" className="text-center text-xs">{isSaving ? t('Ukladám konečný výsledok…', 'Saving final result…') : error ? error : t('Výsledok uložený', 'Result saved')}</p>
        {match.qr_created_by !== null ? <p className="court-stat-warning text-center text-xs text-[#a8e63c]">{isSaving ? t('Odosielam ligový výsledok…', 'Submitting league result…') : match.official_result_id ? t('Ligový výsledok bol odoslaný. Každý hráč ho musí potvrdiť vo svojom profile; až potom sa započíta ELO a ligové štatistiky.', 'League result submitted. Each player must approve it in their profile before ELO and league statistics are applied.') : t('Ligový výsledok ešte nebol odoslaný.', 'League result has not been submitted yet.')}</p> : null}
        {!match.statistics_complete ? <p className="court-stat-warning text-center text-xs text-amber-200">{t('Staršie body a sety neboli zaznamenávané. Štatistiky sú iba od zapnutia sledovania.', 'Earlier points and sets were not recorded. Statistics cover only the tracked period.')}</p> : null}
        <MatchStatistics match={match} showAvatars={leagueMatch} avatars={avatars} />
        </div>
      </section>
    )
  }

  return (
    <section className="live-court mx-auto max-w-5xl">
      <header className="text-center">
        <Link href="/match" className="mb-5 inline-block text-sm text-white/55 transition hover:text-[#a8e63c]">Späť na výber hry</Link>
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#a8e63c]">RIVA / LIVE SCORE</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Priebeh zápasu</h1>
        <p className="mt-3 text-sm text-white/55">Sleduj skóre naživo a ovládaj ho priamo z kurtu.</p>
        <span className="text-xs text-white/50">{t('Režim', 'Mode')}: {match.scoring_type === 'advantage' ? t('So zhodou', 'Advantage') : 'Golden Point'}</span>
        {tie ? <strong className="text-xs text-[#a8e63c]">{t('Tajbrejk · do 7 bodov, rozdiel 2', 'Tiebreak · first to 7, win by 2')}</strong> : null}
      </header>

      {!match.initial_server_chosen ? <div className="court-toolbar mt-8 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={drawServe} disabled={!canEdit || isSaving || (match.challenge_id !== null && !match.is_pin_activated)} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#a8e63c] px-5 py-3 text-sm font-black text-[#061016] transition hover:bg-[#c1fa66] disabled:cursor-not-allowed disabled:opacity-40">
          <Dice5 size={18} aria-hidden="true" /> 🎲 Vylosovať podanie
        </button>
        {!canEdit ? <span className="text-xs text-amber-200">{t('Skóre ovláda zariadenie, ktoré zápas vytvorilo, alebo prihlásený organizátor.', 'The creating device or signed-in organizer controls the score.')}</span> : null}
      </div> : null}

      {error ? <p className="court-error mx-auto mt-4 max-w-2xl rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-center text-sm text-red-200" role="alert">{error}</p> : null}
      {avatarNotice}
      {loginNotice}

      <div className="court-summary mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-white/10 bg-[#0b1b22]/90 p-5 text-center">
        <div><p className="text-sm text-white/60">{t('Gemy v aktuálnom sete', 'Games in current set')}</p><p className="mt-2 text-3xl font-black">{match.team_a_games} – {match.team_b_games}</p></div>
        <div><p className="text-sm text-white/60">{t('Sety', 'Sets')}</p><p className="mt-2 text-3xl font-black">{match.team_a_sets} – {match.team_b_sets}</p></div>
        <div><p className="text-sm text-white/60">{t('Trvanie zápasu', 'Match duration')}</p><p className="mt-2 text-3xl font-black" aria-live="off">{durationLabel}</p></div>
        <div><p className="text-sm text-white/60">{match.streak_team ? t(`Séria bodov – Tím ${match.streak_team === 'TEAM_A' ? '1' : '2'}`, `Point streak – Team ${match.streak_team === 'TEAM_A' ? '1' : '2'}`) : t('Séria bodov', 'Point streak')}</p><p className="mt-2 text-3xl font-black">{match.current_point_streak}</p></div>
      </div>
      <p className="mt-2 text-center text-xs text-white/45">{t('Pri 6:6 tajbrejk do 7 bodov s rozdielom 2.', 'At 6:6, tiebreak to 7 points, win by 2.')}</p>

      <div className="court-teams mt-8 grid gap-4 md:grid-cols-2">
        {([
          { team: 'TEAM_A', label: t('Tím 1', 'Team 1'), players: [match.team_a_player1_name, match.team_a_player2_name], score: tie ? tie.a : match.team_a_game_score },
          { team: 'TEAM_B', label: t('Tím 2', 'Team 2'), players: [match.team_b_player1_name, match.team_b_player2_name], score: tie ? tie.b : match.team_b_game_score },
        ] as const).map(({ team, label, players, score }) => {
          const serving = match.serving_team === team
          return (
            <article key={team} data-team={team} className={`relative overflow-hidden rounded-3xl border bg-[#0b1b22]/90 p-6 transition sm:p-9 ${serving ? 'border-[#a8e63c]/70 shadow-[0_0_35px_rgba(168,230,60,0.15)]' : 'border-white/10'}`}>
              {serving ? <div className="absolute right-5 top-5 rounded-full border border-[#a8e63c]/30 bg-[#a8e63c]/10 px-3 py-1 text-xs font-bold text-[#c1fa66]">🎾 PODÁVA</div> : null}
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">{label}</p>
              <div className="court-players mt-4 grid gap-3">
                {players.map((player, index) => {
                  const playerNumber = index === 0 ? 1 : 2
                  const playerServing = serving && match.serving_player === playerNumber
                  return (
                    <button key={playerNumber} type="button"
                      disabled={!canEdit || isSaving || Boolean(tie) || (match.challenge_id !== null && !match.is_pin_activated)}
                      onClick={() => selectServer(team, playerNumber)}
                      aria-pressed={playerServing}
                      aria-label={`${t('Nastaviť podanie', 'Set server')}: ${label}, ${t('Hráč', 'Player')} ${playerNumber}`}
                      className={`rounded-xl border p-4 text-left transition disabled:opacity-40 ${playerServing ? 'border-[#a8e63c] bg-[#a8e63c]/10 shadow-[0_0_18px_rgba(168,230,60,0.2)]' : 'border-white/10 bg-white/[0.03] hover:border-white/30'}`}>
                      <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
                        <span>{t('Hráč', 'Player')} {playerNumber}</span>
                        {playerServing ? <span className="font-bold text-[#c1fa66]">🎾 {t('Podáva', 'Serving')}</span> : null}
                      </span>
                      <span className={`mt-2 block text-lg font-bold ${leagueMatch ? 'court-player-identity' : ''}`}>{leagueMatch ? <PlayerAvatar name={player} src={avatars?.[(team === 'TEAM_A' ? 0 : 2) + index]} className="size-8 text-xs" /> : null}<span>{player === 'Hráč 1' ? t('Hráč 1', 'Player 1') : player === 'Hráč 2' ? t('Hráč 2', 'Player 2') : player}</span></span>
                    </button>
                  )
                })}
              </div>
              <p className="court-points-label mt-8 text-xs font-bold uppercase tracking-[0.18em] text-white/40">{tie ? t('Body v tajbrejku', 'Tiebreak points') : t('Body v geme', 'Game points')}</p>
              <p className="court-points mt-3 text-center font-black leading-none tracking-tight text-white tabular-nums" aria-label={`${label}: ${match.advantage_team === team ? t('Výhoda', 'Advantage') : formatScore(score)}`}><span>{match.advantage_team === team ? 'AD' : formatScore(score)}</span></p>
              <button
                type="button"
                onClick={team === 'TEAM_A' ? addTeamAPoint : addTeamBPoint}
                disabled={!scoreReady}
                aria-label={`Pridať bod pre ${label}`}
                className="mt-7 min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] text-sm font-bold transition hover:border-[#a8e63c]/50 hover:bg-[#a8e63c]/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Bod pre {label} <span className="ml-1 text-white/40">({team === 'TEAM_A' ? 'A' : 'L'})</span>
              </button>
              <div className="court-breakpoint-summary text-center text-xs text-white/65">
                {t('Brejkbaly – šance / využité / zahodené', 'Break points – chances / converted / missed')}: <strong>{team === 'TEAM_A' ? match.team_a_break_points : match.team_b_break_points} / {team === 'TEAM_A' ? match.team_a_break_points_converted : match.team_b_break_points_converted} / {team === 'TEAM_A' ? match.team_a_break_points_missed : match.team_b_break_points_missed}</strong>
              </div>
            </article>
          )
        })}
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
          <button type="button" onClick={undo} disabled={!canEdit || isSaving || !historyRef.current.length} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-4 text-sm font-semibold text-white/75 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"><Undo2 size={16} aria-hidden="true" /> Späť <kbd className="ml-1 rounded border border-white/15 px-1.5 py-0.5 text-[10px]">Z</kbd></button>
          <button type="button" onClick={resetGame} disabled={!canEdit || isSaving || (tie ? tie.a + tie.b === 0 : match.team_a_game_score + match.team_b_game_score === 0)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-4 text-sm font-semibold text-white/75 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={16} aria-hidden="true" /> {tie ? t('Reset tajbrejku', 'Reset tiebreak') : t('Reset gemu', 'Reset game')} <kbd className="ml-1 rounded border border-white/15 px-1.5 py-0.5 text-[10px]">M</kbd></button>
        </div>
      </div>

      <p role="status" className={`court-status mt-3 text-center text-xs ${speechStatus === 'ready' ? 'text-white/55' : 'text-amber-200'}`}>
        {muted ? t('Hlasové hlásenia sú stíšené.', 'Voice announcements are muted.') : speechStatus === 'ready'
          ? t('Hlas Jessa je zapnutý: slovenčina.', 'Jessa voice enabled: English.')
          : speechStatus === 'fallback'
            ? t('ElevenLabs nie je dostupný. Hlásenia prehráva slovenský hlas zariadenia.', 'ElevenLabs is unavailable. Announcements use the device’s English voice.')
          : speechStatus === 'unsupported'
            ? t('Tento prehliadač nepodporuje hlasové hlásenia.', 'This browser does not support voice announcements.')
            : speechStatus === 'failed'
              ? t('Hlasové hlásenie zlyhalo. Skontroluj zvuk a nastavenia hlasu zariadenia.', 'Voice announcement failed. Check the device sound and voice settings.')
              : language === 'sk'
                  ? 'Slovenský hlas nie je dostupný. Nainštaluj alebo povoľ slovenský hlas v nastaveniach zariadenia. Anglický hlas sa nepoužije.'
                  : 'No English voice is available. Install or enable an English voice in the device settings.'}
      </p>

      <p className="mt-4 text-center text-xs text-white/35">Skratky: A = bod pre Tím 1 · L = bod pre Tím 2 · Z = späť · M = reset gemu</p>
      {!scoreReady ? <p className="mt-2 text-center text-xs text-[#c1fa66]/80">{match.challenge_id !== null && !match.is_pin_activated ? 'Najprv aktivuj zápas zadaním PIN-u v kiosku.' : 'Najprv vylosuj podanie, aby sa mohlo začať skórovať.'}</p> : null}
    </section>
  )
}
