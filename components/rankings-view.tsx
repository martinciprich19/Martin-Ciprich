'use client'

import { useEffect, useMemo, useState } from 'react'
import { MapPin, Search, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { useLanguage } from '@/components/language-provider'
import { useLeague } from '@/components/league-provider'
import { fetchArenas, type Arena } from '@/lib/arenas'
import { createClient } from '@/lib/supabase/client'
import { fetchPlayerProfile, fetchPlayerProfiles, refreshMyAutoVenue } from '@/lib/profiles'
import { getErrorMessage } from '@/lib/errors'
import { PlayerAvatar } from '@/components/player-avatar'
import type { Gender } from '@/lib/profiles'
import type { CountryCode } from '@/lib/countries'

type RankingTab = 'national' | 'european' | 'arenas'
type RankingPlayer = {
  id: string
  rank: number
  name: string
  region: string
  country: CountryCode
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

const ALL_REGIONS = ''
const fieldClass = 'w-full rounded-lg border border-app-line/10 bg-app-panel px-3 py-2.5 text-sm text-app-fg outline-none focus:border-[#ccff00]'

function normalizeRegion(value: string) {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase().replace(/\s*kraj$/, '').trim()
}

type RankingsViewProps = {
  onMessage?: (player: { id: string; name: string; elo: number; region: string }) => void
  publicView?: boolean
}

export function RankingsView(props: RankingsViewProps = {}) {
  const { country, isLoading } = useLeague()
  return isLoading ? null : <CountryRankingsView key={country} {...props} />
}

function CountryRankingsView({ onMessage, publicView = false }: RankingsViewProps) {
  const router = useRouter()
  const { t } = useLanguage()
  const { country, regions } = useLeague()
  const [tab, setTab] = useState<RankingTab>('national')
  const [region, setRegion] = useState(ALL_REGIONS)
  const [arenaId, setArenaId] = useState('')
  const [search, setSearch] = useState('')
  const [players, setPlayers] = useState<RankingPlayer[]>([])
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const rankingCountry = tab === 'european' ? undefined : country
  const rankingScope = rankingCountry ?? 'european'
  const [loadedScope, setLoadedScope] = useState<string | null>(null)
  const { data: arenas = [], error: arenasError } = useSWR<Arena[]>(['arenas', country], () => fetchArenas(country))

  useEffect(() => {
    let isActive = true

    async function loadPlayers() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const profiles = await fetchPlayerProfiles(rankingCountry)
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
            country: profile.country_code,
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
        if (isActive) {
          setLoadedScope(rankingScope)
          setIsLoading(false)
        }
      }
    }

    void loadPlayers()
    return () => { isActive = false }
  }, [rankingCountry, rankingScope, publicView])

  const visiblePlayers = useMemo(() => {
    const selectedRegion = normalizeRegion(region)
    const showAllRegions = !selectedRegion || selectedRegion === normalizeRegion('Všetky kraje') || selectedRegion === normalizeRegion('Celé Slovensko')
    return players
      .filter((player) => {
        if (tab === 'arenas') return Boolean(arenaId) && (player.autoVenueId || player.homeVenueId) === arenaId
        if (tab === 'european') return true
        return showAllRegions || normalizeRegion(player.region) === selectedRegion
      })
      .filter((player) => player.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((first, second) => second.elo - first.elo || second.wins - first.wins)
      .map((player, index) => ({ ...player, rank: index + 1 }))
  }, [players, tab, arenaId, region, search])

  function openMessage(player: RankingPlayer) {
    if (onMessage) onMessage({ id: player.id, name: player.name, elo: player.elo, region: player.region })
    else router.push(`/profile?view=messages&participant=${encodeURIComponent(player.name)}&participantId=${player.id}&region=${encodeURIComponent(player.region)}&elo=${player.elo}`)
  }

  return (
    <div id="rankings" className="mx-auto max-w-[1120px]">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-app-league">RIVA / {tab === 'european' ? t('Európa', 'Europe') : country}</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight">{t('Rebríčky')}</h1>
        <p className="mt-2 text-sm text-app-fg/45">{t('Poradie hráčov podľa ELO a arén, ktoré navštevujú.', 'Player rankings by ELO and the arenas they visit.')}</p>
      </header>

      <div className="mt-8 flex flex-col gap-4 border-b border-app-line/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Typ rebríčka">
          <button type="button" role="tab" aria-selected={tab === 'european'} onClick={() => setTab('european')} className={`min-h-11 rounded-lg px-4 py-2.5 text-xs font-black ${tab === 'european' ? 'bg-[#ccff00] text-[#10150d]' : 'border border-app-line/10 text-app-fg/55'}`}>{t('Európsky rebríček', 'European rankings')}</button>
          <button type="button" role="tab" aria-selected={tab === 'national'} onClick={() => setTab('national')} className={`min-h-11 rounded-lg px-4 py-2.5 text-xs font-black ${tab === 'national' ? 'bg-[#ccff00] text-[#10150d]' : 'border border-app-line/10 text-app-fg/55'}`}>{t('Národný rebríček', 'National rankings')}</button>
          <button type="button" role="tab" aria-selected={tab === 'arenas'} onClick={() => setTab('arenas')} className={`min-h-11 rounded-lg px-4 py-2.5 text-xs font-black ${tab === 'arenas' ? 'bg-[#ccff00] text-[#10150d]' : 'border border-app-line/10 text-app-fg/55'}`}>{t('Rebríček arén', 'Arena rankings')}</button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative">
            <span className="sr-only">Hľadať hráča</span>
            <Search className="absolute left-3 top-3 text-app-fg/35" size={16} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hľadať hráča..." className="w-full rounded-lg border border-app-line/10 bg-app-panel py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#ccff00] sm:w-56" />
          </label>
          {tab === 'arenas' ? (
            <label>
              <span className="sr-only">Vybrať arénu</span>
              <select value={arenaId} onChange={(event) => setArenaId(event.target.value)} className="w-full rounded-lg border border-app-line/10 bg-app-panel px-3 py-2.5 text-xs font-bold outline-none focus:border-[#ccff00] sm:w-60">
                <option value="">Vyber arénu</option>
                {arenas.map((arena) => <option key={arena.id} value={arena.id}>{arena.name} · {arena.city}</option>)}
              </select>
            </label>
          ) : tab === 'national' ? (
            <label>
              <span className="sr-only">{country === 'NL' ? t('Provincia', 'Province') : t('Filtrovať podľa kraja', 'Filter by region')}</span>
              <select value={region} onChange={(event) => setRegion(event.target.value)} className="w-full rounded-lg border border-app-line/10 bg-app-panel px-3 py-2.5 text-xs font-bold outline-none focus:border-[#ccff00] sm:w-52">
                <option value="">{country === 'NL' ? t('Všetky provincie', 'All provinces') : t('Všetky kraje', 'All regions')}</option>
                {regions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {arenasError && tab === 'arenas' ? <p role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-app-red-200">Arény sa nepodarilo načítať.</p> : null}
      {isLoading || loadedScope !== rankingScope ? <p role="status" className="py-12 text-center text-sm text-app-fg/50">Načítavam rebríček…</p> : loadError ? (
        <p role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-app-red-200">{loadError}</p>
      ) : tab === 'arenas' && !arenaId ? (
        <p className="mt-6 rounded-xl border border-app-line/10 bg-app-surface p-6 text-center text-sm text-app-fg/50">Najprv vyber arénu.</p>
      ) : visiblePlayers.length === 0 ? (
        <p className="mt-6 rounded-xl border border-app-line/10 bg-app-surface p-6 text-center text-sm text-app-fg/50">V tomto rebríčku sa nenašli hráči.</p>
      ) : (
        <ol className="mx-auto mt-6 max-w-3xl divide-y divide-app-line/[0.08] rounded-xl border border-app-line/[0.08] bg-app-surface">
          {visiblePlayers.map((player) => (
            <li key={player.id} className={`grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 px-3 py-3 sm:grid-cols-[56px_minmax(0,1fr)_auto_auto] sm:gap-3 sm:px-5 sm:py-4 ${player.isCurrentPlayer ? 'bg-[#ccff00]/[0.04]' : ''}`}>
              <span className="font-mono text-base font-black text-app-league sm:text-lg">{String(player.rank).padStart(2, '0')}</span>
              <div className="flex min-w-0 items-center gap-3">
                <PlayerAvatar name={player.name} src={player.avatarUrl} gender={player.gender} className="size-9 text-sm sm:size-10" />
                <div className="min-w-0">
                <p className="truncate font-bold">{player.name}{player.isCurrentPlayer ? <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-app-league">Tvoj profil</span> : null}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-app-fg/45"><MapPin size={12} />{tab === 'european' ? <span>{player.country} ·</span> : null}{player.region || (player.country === 'NL' ? t('Provincia neuvedená', 'Province not specified') : t('Kraj neuvedený', 'Region not specified'))} · {player.level || t('Úroveň neuvedená', 'Level not specified')}</p>
                </div>
              </div>
              <p className="whitespace-nowrap font-mono text-base font-black text-app-fg sm:text-lg">{player.elo} <span className="text-[10px] text-app-fg/40 sm:text-xs">ELO</span></p>
              <div className="col-start-2 col-span-2 flex flex-wrap gap-2 sm:col-start-auto sm:col-span-1">
                <Link href={`/players/${encodeURIComponent(player.id)}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ccff00] px-3 py-2 text-xs font-black text-[#10150d]">
                  <UserRound size={14} aria-hidden="true" />{t('Zobraziť profil', 'View profile')}
                </Link>
                {!publicView && !player.isCurrentPlayer ? <button type="button" onClick={() => openMessage(player)} className="rounded-lg border border-app-line/10 px-3 py-2 text-xs font-bold text-app-fg/70">{t('Správa', 'Message')}</button> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}