'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, Radio, WifiOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { PageReloadButton } from '@/components/page-reload-button'

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
  const hasMatch = court?.match_id !== null && court?.match_id !== undefined

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
    setAds([])
    setCurrentAdIndex(0)
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
        const nextAds = (data ?? []) as SponsorAd[]
        setAds(previous => {
          const unchanged = previous.length === nextAds.length && previous.every((ad, index) => {
            const next = nextAds[index]
            return ad.id === next.id && ad.image_path === next.image_path
              && ad.sponsor_name === next.sponsor_name && ad.display_seconds === next.display_seconds
              && ad.sort_order === next.sort_order
          })
          return unchanged ? previous : nextAds
        })
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
    if (hasMatch) return
    if (ads.length < 2) {
      setCurrentAdIndex(0)
      return
    }
    const activeAd = ads[currentAdIndex % ads.length]
    const duration = Number.isInteger(activeAd?.display_seconds)
      ? Math.min(60, Math.max(5, activeAd.display_seconds))
      : 10
    const timer = window.setTimeout(
      () => setCurrentAdIndex((index) => index + 1),
      duration * 1000,
    )
    return () => window.clearTimeout(timer)
  }, [ads, currentAdIndex, hasMatch])

  const currentAd = ads.length ? ads[currentAdIndex % ads.length] : null
  const previousAd = ads.length > 1 && currentAdIndex > 0
    ? ads[(currentAdIndex - 1) % ads.length] : null

  return (
    <main className="court-scoreboard">
      <header className="court-scoreboard-header">
        <div className="min-w-0">
          <p className="court-scoreboard-brand">RIVA PADEL / LIVE</p>
          <h1 className="court-scoreboard-title">{court?.court_name ?? 'Skóre kurtu'}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-300" aria-label="Obrazovka je aktívna">
            <Radio size={16} aria-hidden="true" /> LIVE
          </span>
          <PageReloadButton />
        </div>
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
      ) : !hasMatch && currentAd ? (
        <section className="court-scoreboard-ad" aria-live="polite">
          <div key={`${currentAd.id}-${currentAdIndex}`} className="court-scoreboard-ad-window">
            {previousAd ? <img
              src={createClient().storage.from('arena-sponsor-ads').getPublicUrl(previousAd.image_path).data.publicUrl}
              alt=""
              aria-hidden="true"
              className="court-scoreboard-ad-image court-scoreboard-ad-outgoing"
            /> : null}
            <img
              src={createClient().storage.from('arena-sponsor-ads').getPublicUrl(currentAd.image_path).data.publicUrl}
              alt={`Reklama sponzora ${currentAd.sponsor_name}`}
              className={`court-scoreboard-ad-image${previousAd ? ' court-scoreboard-ad-incoming' : ''}`}
            />
          </div>
          <p className="court-scoreboard-ad-caption">{currentAd.sponsor_name}</p>
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
        <section className="court-scoreboard-match" aria-live="polite">
          {court.paused_at ? <p className="court-scoreboard-paused">Zápas je pozastavený</p> : null}
          <div className="court-scoreboard-table">
            <div className="court-scoreboard-columns">
              <span className="text-left">Hráči</span>
              <span>Sety</span>
              <span>Gemy</span>
              <span>{court.tiebreak_score ? 'Tie-break' : 'Body'}</span>
            </div>
            {[
              {
                label: 'TÍM A',
                players: [court.team_a_player1_name, court.team_a_player2_name].filter(Boolean),
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
                players: [court.team_b_player1_name, court.team_b_player2_name].filter(Boolean),
                sets: court.team_b_sets,
                games: court.team_b_games,
                points: court.tiebreak_score
                  ? String(court.tiebreak_score.b)
                  : court.advantage_team === 'TEAM_B'
                    ? 'AD'
                    : formatGameScore(court.team_b_game_score),
              },
            ].map((team) => (
              <div key={team.label} className="court-scoreboard-team">
                <div className="min-w-0 text-left">
                  <p className="court-scoreboard-team-label">{team.label}</p>
                  <div className="court-scoreboard-players">
                    {team.players.length ? team.players.map((name, index) => <p key={index} title={name ?? undefined}>{name}</p>) : <p>—</p>}
                  </div>
                </div>
                <span className="court-scoreboard-number">{team.sets ?? 0}</span>
                <span className="court-scoreboard-number">{team.games ?? 0}</span>
                <span className="court-scoreboard-points">{team.points}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <footer className="court-scoreboard-footer">RIVA PADEL · ŽIVÉ SKÓRE</footer>
    </main>
  )
}
