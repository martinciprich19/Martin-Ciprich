'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, Radio, WifiOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type CourtScore = {
  court_id: number | string
  arena_id: number | string
  court_name: string
  match_id: string | null
  team_a_player1_name: string | null
  team_a_player2_name: string | null
  team_b_player1_name: string | null
  team_b_player2_name: string | null
  team_a_game_score: number | null
  team_b_game_score: number | null
  advantage_team: 'TEAM_A' | 'TEAM_B' | null
  tiebreak_score: { a: number; b: number } | null
  team_a_games: number | null
  team_b_games: number | null
  team_a_sets: number | null
  team_b_sets: number | null
  started_at: string | null
  paused_at: string | null
}

type SponsorAd = {
  id: string
  sponsor_name: string
  image_path: string
  display_seconds: number
  sort_order: number
}

function formatGameScore(score: number | null): string {
  if (score === 0) return '0'
  if (score === 15 || score === 30 || score === 40) return String(score)
  return '—'
}

export function ScoreboardView({ courtId }: { courtId: string }) {
  const [court, setCourt] = useState<CourtScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [ads, setAds] = useState<SponsorAd[]>([])
  const [currentAdIndex, setCurrentAdIndex] = useState(0)
  const failureLogged = useRef(false)

  const refresh = useCallback(async (active: () => boolean = () => true) => {
    try {
      const { data, error } = await createClient().rpc('get_court_scoreboard', {
        p_court_id: Number(courtId),
      })
      if (error) throw error
      if (!active()) return
      if (!Array.isArray(data) || data.length > 1) throw new Error('Neočakávaná odpoveď obrazovky kurtu.')
      const row = data[0] as CourtScore | undefined
      if (row && (typeof row.court_name !== 'string' || String(row.court_id) !== courtId
        || !Number.isSafeInteger(Number(row.arena_id)))) {
        throw new Error('Odpoveď nepatrí tejto obrazovke kurtu.')
      }
      setCourt(row ?? null)
      setFailed(false)
      failureLogged.current = false
    } catch (error) {
      if (!failureLogged.current) {
        console.error('Načítanie skóre kurtu zlyhalo:', error)
        failureLogged.current = true
      }
      if (active()) setFailed(true)
    } finally {
      if (active()) setLoading(false)
    }
  }, [courtId])

  useEffect(() => {
    let active = true
    const isActive = () => active
    void refresh(isActive)
    const timer = window.setInterval(() => void refresh(isActive), 2500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [refresh])

  useEffect(() => {
    if (!court) return
    let active = true
    const loadAds = async () => {
      const { data, error } = await createClient()
        .from('arena_sponsor_ads')
        .select('id, sponsor_name, image_path, display_seconds, sort_order')
        .eq('arena_id', court.arena_id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) {
        console.error('Načítanie reklám sponzorov zlyhalo:', error)
        if (active) setAds([])
        return
      }
      if (active) {
        setAds((data ?? []) as SponsorAd[])
        setCurrentAdIndex(0)
      }
    }
    void loadAds()
    const timer = window.setInterval(() => void loadAds(), 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [court?.arena_id])

  useEffect(() => {
    if (ads.length < 2) {
      setCurrentAdIndex(0)
      return
    }
    const activeAd = ads[currentAdIndex % ads.length]
    const duration = Number.isInteger(activeAd?.display_seconds)
      ? Math.min(60, Math.max(5, activeAd.display_seconds))
      : 10
    const timer = window.setTimeout(
      () => setCurrentAdIndex((index) => (index + 1) % ads.length),
      duration * 1000,
    )
    return () => window.clearTimeout(timer)
  }, [ads, currentAdIndex])

  const hasMatch = court?.match_id !== null && court?.match_id !== undefined

  return (
    <main className="flex min-h-screen flex-col bg-[#080d10] px-5 py-5 text-white sm:px-10 sm:py-8">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.3em] text-[#ccff00]">RIVA PADEL / LIVE</p>
          <h1 className="mt-1 text-xl font-bold sm:text-2xl">{court?.court_name ?? 'Skóre kurtu'}</h1>
        </div>
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-300" aria-label="Obrazovka je aktívna">
          <Radio size={16} aria-hidden="true" /> LIVE
        </span>
      </header>

      {failed ? (
        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <WifiOff size={48} className="text-amber-300" aria-hidden="true" />
          <h2 className="mt-5 text-2xl font-black">Skóre sa nepodarilo načítať</h2>
          <p className="mt-2 max-w-lg text-sm text-white/55">Obrazovka sa automaticky pokúsi znovu pripojiť. Skontroluj, či je spustená SQL migrácia 072.</p>
        </section>
      ) : loading ? (
        <section role="status" className="flex flex-1 items-center justify-center gap-3 text-white/60">
          <LoaderCircle size={22} className="animate-spin" /> Pripájam obrazovku…
        </section>
      ) : !court ? (
        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <WifiOff size={48} className="text-white/35" aria-hidden="true" />
          <h2 className="mt-5 text-2xl font-black">Kurt sa nenašiel</h2>
          <p className="mt-2 text-sm text-white/50">Skontroluj adresu monitora v správcovskom paneli arény.</p>
        </section>
      ) : !hasMatch && ads.length > 0 ? (
        <section className="flex flex-1 flex-col items-center justify-center py-4" aria-live="polite">
          <div className="flex min-h-0 flex-1 w-full items-center justify-center">
            <img
              key={ads[currentAdIndex % ads.length].id}
              src={createClient().storage.from('arena-sponsor-ads').getPublicUrl(ads[currentAdIndex % ads.length].image_path).data.publicUrl}
              alt={`Reklama sponzora ${ads[currentAdIndex % ads.length].sponsor_name}`}
              className="max-h-[78vh] max-w-full object-contain"
            />
          </div>
          <p className="pt-4 text-sm font-semibold text-white/50">{ads[currentAdIndex % ads.length].sponsor_name}</p>
        </section>
      ) : !hasMatch ? (
        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="rounded-full border border-[#ccff00]/20 bg-[#ccff00]/10 p-5 text-[#ccff00]">
            <Radio size={40} aria-hidden="true" />
          </div>
          <h2 className="mt-7 text-4xl font-black sm:text-6xl">Kurt je pripravený</h2>
          <p className="mt-3 text-lg text-white/50">Skóre zápasu sa zobrazí po jeho spustení na kiosku tohto kurtu.</p>
        </section>
      ) : (
        <section className="flex flex-1 flex-col justify-center" aria-live="polite">
          <div className="mx-auto w-full max-w-6xl">
            {court.paused_at ? <p className="mb-5 text-center text-lg font-black uppercase tracking-[0.2em] text-amber-300">Zápas je pozastavený</p> : null}
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-b border-white/10 px-2 py-3 text-center text-xs font-black uppercase tracking-[0.18em] text-white/45 sm:grid-cols-[minmax(0,1fr)_minmax(90px,0.3fr)_minmax(90px,0.3fr)_minmax(100px,0.35fr)] sm:gap-x-8 sm:px-8 sm:text-sm">
              <span className="text-left">Hráči</span>
              <span className="hidden sm:block">Sety</span>
              <span className="hidden sm:block">Gemy</span>
              <span>{court.tiebreak_score ? 'Tie-break' : 'Body'}</span>
            </div>
            {[
              {
                label: 'TÍM A',
                players: [court.team_a_player1_name, court.team_a_player2_name].filter(Boolean).join(' / '),
                sets: court.team_a_sets,
                games: court.team_a_games,
                points: court.tiebreak_score
                  ? String(court.tiebreak_score.a)
                  : court.advantage_team === 'TEAM_A'
                    ? 'AD'
                    : formatGameScore(court.team_a_game_score),
              },
              {
                label: 'TÍM B',
                players: [court.team_b_player1_name, court.team_b_player2_name].filter(Boolean).join(' / '),
                sets: court.team_b_sets,
                games: court.team_b_games,
                points: court.tiebreak_score
                  ? String(court.tiebreak_score.b)
                  : court.advantage_team === 'TEAM_B'
                    ? 'AD'
                    : formatGameScore(court.team_b_game_score),
              },
            ].map((team) => (
              <div key={team.label} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-b border-white/10 px-2 py-7 text-center sm:grid-cols-[minmax(0,1fr)_minmax(90px,0.3fr)_minmax(90px,0.3fr)_minmax(100px,0.35fr)] sm:gap-x-8 sm:px-8 sm:py-10">
                <div className="min-w-0 text-left">
                  <p className="text-[10px] font-black tracking-[0.2em] text-[#ccff00] sm:text-xs">{team.label}</p>
                  <p className="mt-2 truncate text-xl font-black sm:text-4xl">{team.players || '—'}</p>
                  <p className="mt-2 text-xs text-white/35 sm:hidden">Sety {team.sets ?? 0} · Gemy {team.games ?? 0}</p>
                </div>
                <span className="hidden text-3xl font-bold tabular-nums sm:block sm:text-5xl">{team.sets ?? 0}</span>
                <span className="hidden text-3xl font-bold tabular-nums sm:block sm:text-5xl">{team.games ?? 0}</span>
                <span className="text-4xl font-black tabular-nums text-[#ccff00] sm:text-7xl">{team.points}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <footer className="pt-4 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-white/25">RIVA PADEL · ŽIVÉ SKÓRE</footer>
    </main>
  )
}
