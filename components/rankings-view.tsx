'use client'

import { useEffect, useMemo, useState } from 'react'
import { MapPin, Search, Swords } from 'lucide-react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { useLanguage } from '@/components/language-provider'
import { fetchArenas, type Arena } from '@/lib/arenas'
import { createClient } from '@/lib/supabase/client'
import { fetchPlayerProfile, fetchPlayerProfiles, refreshMyAutoVenue } from '@/lib/profiles'
import { getErrorMessage } from '@/lib/errors'
import { PlayerAvatar } from '@/components/player-avatar'
import type { Gender } from '@/lib/profiles'

type RankingTab = 'national' | 'regional' | 'arenas'
type RankingPlayer = {
  id: string
  rank: number
  name: string
  region: string
  level: string
  elo: number
  matchesPlayed: number
  wins: number
  losses: number
  avatarUrl: string | null
  gender: Gender | null
  autoVenueId: string | null
  homeVenueId: string | null
  isCurrentPlayer: boolean
}

const REGIONS = ['Všetky kraje', 'Žilinský kraj', 'Bratislavský kraj', 'Trnavský kraj', 'Nitriansky kraj', 'Banskobystrický kraj', 'Košický kraj', 'Prešovský kraj', 'Trenčiansky kraj']
const ALL_REGIONS = REGIONS[0]
const fieldClass = 'w-full rounded-lg border border-white/10 bg-[#131924] px-3 py-2.5 text-sm text-white outline-none focus:border-[#ccff00]'

function normalizeRegion(value: string) {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase().replace(/\s*kraj$/, '').trim()
}

export function RankingsView({ onChallenge, onMessage, publicView = false }: {
  onChallenge?: (player: { id: string; name: string }) => void
  onMessage?: (player: { id: string; name: string; elo: number; region: string }) => void
  publicView?: boolean
} = {}) {
  const router = useRouter()
  const { t } = useLanguage()
  const [tab, setTab] = useState<RankingTab>('national')
  const [region, setRegion] = useState(ALL_REGIONS)
  const [arenaId, setArenaId] = useState('')
  const [search, setSearch] = useState('')
  const [players, setPlayers] = useState<RankingPlayer[]>([])
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { data: arenas = [], error: arenasError } = useSWR<Arena[]>('arenas', fetchArenas)

  useEffect(() => {
    let isActive = true

    async function loadPlayers() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const profiles = await fetchPlayerProfiles()
        let myProfileId: string | null = null
        if (!publicView) try {
          const { data: { session }, error: sessionError } = await createClient().auth.getSession()
          if (sessionError) throw sessionError
          const email = session?.user.email
          if (email) {
            try {
              await refreshMyAutoVenue()
            } catch (error: unknown) {
              console.warn('Automatickú domovskú arénu sa nepodarilo obnoviť:', getErrorMessage(error, 'Obnovenie arény zlyhalo.'))
            }
            const profile = await fetchPlayerProfile(email)
            myProfileId = profile ? String(profile.id) : null
          }
        } catch (error: unknown) {
          console.warn('Voliteľné údaje prihláseného hráča sa nepodarilo načítať:', getErrorMessage(error, 'Profil sa nepodarilo načítať.'))
        }
        if (!isActive) return
        setCurrentProfileId(myProfileId)
        setPlayers(profiles
          .map((profile) => ({
            id: String(profile.id),
            rank: 0,
            name: profile.full_name,
            region: profile.region,
            level: profile.level,
            elo: profile.elo_rating,
            matchesPlayed: profile.matches_played,
            wins: profile.matches_won,
            losses: Math.max(0, profile.matches_played - profile.matches_won),
            avatarUrl: profile.avatar_url,
            gender: profile.gender,
            autoVenueId: profile.auto_venue_id,
            homeVenueId: profile.home_venue_id,
            isCurrentPlayer: String(profile.id) === myProfileId,
          }))
          .filter((profile) => profile.name.trim().length > 0))
      } catch (error: unknown) {
        const message = getErrorMessage(error, 'Hráčov sa nepodarilo načítať.')
        console.error('Načítanie rebríčka zlyhalo:', message)
        if (isActive) {
          setLoadError(message)
          setPlayers([])
        }
      } finally {
        if (isActive) setIsLoading(false)
      }
    }

    void loadPlayers()
    return () => { isActive = false }
  }, [])

  const visiblePlayers = useMemo(() => {
    const selectedRegion = normalizeRegion(region)
    const showAllRegions = !selectedRegion || selectedRegion === normalizeRegion('Všetky kraje') || selectedRegion === normalizeRegion('Celé Slovensko')
    return players
      .filter((player) => {
        if (tab === 'arenas') return Boolean(arenaId) && (player.autoVenueId || player.homeVenueId) === arenaId
        return showAllRegions || normalizeRegion(player.region) === selectedRegion
      })
      .filter((player) => player.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((first, second) => second.elo - first.elo || second.wins - first.wins)
      .map((player, index) => ({ ...player, rank: index + 1 }))
  }, [players, tab, arenaId, region, search])

  function openChallenge(player: RankingPlayer) {
    if (onChallenge) onChallenge(player)
    else router.push(`/profile?view=challenges&opponent=${encodeURIComponent(player.name)}`)
  }

  function openMessage(player: RankingPlayer) {
    if (onMessage) onMessage({ id: player.id, name: player.name, elo: player.elo, region: player.region })
    else router.push(`/profile?view=messages&participant=${encodeURIComponent(player.name)}&participantId=${player.id}&region=${encodeURIComponent(player.region)}&elo=${player.elo}`)
  }

  return (
    <div id="rankings" className="mx-auto max-w-[1120px]">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">RIVA / REBRÍČKY</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight">{t('Rebríčky')}</h1>
        <p className="mt-2 text-sm text-white/45">Poradie hráčov podľa ELO a arén, ktoré navštevujú.</p>
      </header>

      <div className="mt-8 flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Typ rebríčka">
          <button type="button" role="tab" aria-selected={tab === 'national'} onClick={() => setTab('national')} className={`min-h-11 rounded-lg px-4 py-2.5 text-xs font-black ${tab === 'national' ? 'bg-[#ccff00] text-[#10150d]' : 'border border-white/10 text-white/55'}`}>Celoslovenský rebríček</button>
          <button type="button" role="tab" aria-selected={tab === 'regional'} onClick={() => setTab('regional')} className={`min-h-11 rounded-lg px-4 py-2.5 text-xs font-black ${tab === 'regional' ? 'bg-[#ccff00] text-[#10150d]' : 'border border-white/10 text-white/55'}`}>Krajský rebríček</button>
          <button type="button" role="tab" aria-selected={tab === 'arenas'} onClick={() => setTab('arenas')} className={`min-h-11 rounded-lg px-4 py-2.5 text-xs font-black ${tab === 'arenas' ? 'bg-[#ccff00] text-[#10150d]' : 'border border-white/10 text-white/55'}`}>Rebríček arén</button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative">
            <span className="sr-only">Hľadať hráča</span>
            <Search className="absolute left-3 top-3 text-white/35" size={16} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hľadať hráča..." className="w-full rounded-lg border border-white/10 bg-[#131924] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#ccff00] sm:w-56" />
          </label>
          {tab === 'arenas' ? (
            <label>
              <span className="sr-only">Vybrať arénu</span>
              <select value={arenaId} onChange={(event) => setArenaId(event.target.value)} className="w-full rounded-lg border border-white/10 bg-[#131924] px-3 py-2.5 text-xs font-bold outline-none focus:border-[#ccff00] sm:w-60">
                <option value="">Vyber arénu</option>
                {arenas.map((arena) => <option key={arena.id} value={arena.id}>{arena.name} · {arena.city}</option>)}
              </select>
            </label>
          ) : (
            <label>
              <span className="sr-only">Filtrovať kraj</span>
              <select value={region} onChange={(event) => setRegion(event.target.value)} className="w-full rounded-lg border border-white/10 bg-[#131924] px-3 py-2.5 text-xs font-bold outline-none focus:border-[#ccff00] sm:w-52">
                {REGIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      {arenasError && tab === 'arenas' ? <p role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">Arény sa nepodarilo načítať.</p> : null}
      {isLoading ? <p role="status" className="py-12 text-center text-sm text-white/50">Načítavam rebríček…</p> : loadError ? (
        <p role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{loadError}</p>
      ) : tab === 'arenas' && !arenaId ? (
        <p className="mt-6 rounded-xl border border-white/10 bg-[#111722] p-6 text-center text-sm text-white/50">Najprv vyber arénu.</p>
      ) : visiblePlayers.length === 0 ? (
        <p className="mt-6 rounded-xl border border-white/10 bg-[#111722] p-6 text-center text-sm text-white/50">V tomto rebríčku sa nenašli hráči.</p>
      ) : (
        <ol className="mx-auto mt-6 max-w-3xl divide-y divide-white/[0.08] rounded-xl border border-white/[0.08] bg-[#111722]">
          {visiblePlayers.map((player) => (
            <li key={player.id} className={`grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 px-3 py-3 sm:grid-cols-[56px_minmax(0,1fr)_auto_auto] sm:gap-3 sm:px-5 sm:py-4 ${player.isCurrentPlayer ? 'bg-[#ccff00]/[0.04]' : ''}`}>
              <span className="font-mono text-base font-black text-[#ccff00] sm:text-lg">{String(player.rank).padStart(2, '0')}</span>
              <div className="flex min-w-0 items-center gap-3">
                <PlayerAvatar name={player.name} src={player.avatarUrl} gender={player.gender} className="size-9 text-sm sm:size-10" />
                <div className="min-w-0">
                <p className="truncate font-bold">{player.name}{player.isCurrentPlayer ? <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-[#ccff00]">Tvoj profil</span> : null}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-white/45"><MapPin size={12} />{player.region || 'Kraj neuvedený'} · {player.level || 'Úroveň neuvedená'}</p>
                </div>
              </div>
              <p className="whitespace-nowrap font-mono text-base font-black text-white sm:text-lg">{player.elo} <span className="text-[10px] text-white/40 sm:text-xs">ELO</span></p>
              {publicView || player.isCurrentPlayer ? null : <div className="col-start-2 col-span-2 flex gap-2 sm:col-start-auto sm:col-span-1">
                <button type="button" onClick={() => openChallenge(player)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ccff00] px-3 py-2 text-xs font-black text-[#10150d]"><Swords size={14} />Vyzvať</button>
                <button type="button" onClick={() => openMessage(player)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/70">Správa</button>
              </div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}