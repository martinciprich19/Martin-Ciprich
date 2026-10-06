'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { Check, Clock3, MapPin, MessageSquare, RotateCcw, Search, UserPlus, UserRound, Users } from 'lucide-react'
import { getErrorMessage } from '@/lib/errors'
import { useLanguage } from '@/components/language-provider'
import { emptyPlayerFilters, fetchLeaguePlayers, MAX_ELO, filterPlayers, PLAYER_LEVELS, type LeaguePlayer, type PlayerFilters } from '@/lib/players'
import { fetchFriendshipStatuses, sendFriendRequest, type FriendshipStatus } from '@/lib/friendships'

const REGIONS = ['Bratislavský kraj', 'Trnavský kraj', 'Trenčiansky kraj', 'Nitriansky kraj', 'Žilinský kraj', 'Banskobystrický kraj', 'Prešovský kraj', 'Košický kraj']
const AVATAR_TONES = ['bg-[#ccff00] text-[#10150d]', 'bg-sky-400 text-[#0b0f17]', 'bg-emerald-400 text-[#0b0f17]', 'bg-amber-300 text-[#0b0f17]', 'bg-rose-400 text-[#0b0f17]']

const fieldClass = 'w-full rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#ccff00]/60 focus:ring-2 focus:ring-[#ccff00]/15'
const labelClass = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-white/45'

function toneFor(name: string) {
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}

function PlayerAvatar({ player, size = 'md' }: { player: LeaguePlayer; size?: 'md' | 'lg' }) {
  const dimensions = size === 'lg' ? 'h-20 w-20 text-3xl' : 'h-14 w-14 text-xl'
  if (player.avatarUrl) {
    return <img src={player.avatarUrl} alt="" className={`${dimensions} shrink-0 rounded-full object-cover ring-2 ring-white/10`} />
  }
  return <span aria-hidden="true" className={`${dimensions} ${toneFor(player.name)} flex shrink-0 items-center justify-center rounded-full font-black uppercase`}>{player.name.slice(0, 1)}</span>
}

export function PlayerSearchView({ currentPlayerId, currentPlayerAvatarUrl, defaultRegion, onMessage, showCurrentPlayer = false }: { currentPlayerId?: string; currentPlayerAvatarUrl?: string | null; defaultRegion?: string; onMessage: (player: LeaguePlayer) => void; showCurrentPlayer?: boolean }) {
  const router = useRouter()
  const { t } = useLanguage()
  const { data: players = [], error, isLoading, mutate } = useSWR('league-players', fetchLeaguePlayers, { revalidateOnFocus: false })
  const friendships = useSWR(currentPlayerId ? ['friendship-statuses', currentPlayerId] : null, ([, profileId]) => fetchFriendshipStatuses(profileId))
  const [filters, setFilters] = useState<PlayerFilters>({ ...emptyPlayerFilters, region: REGIONS.includes(defaultRegion ?? '') ? defaultRegion! : '' })
  const [requestingFriendId, setRequestingFriendId] = useState<string | null>(null)
  const visiblePlayers = useMemo(() => filterPlayers(players, filters, showCurrentPlayer ? undefined : currentPlayerId), [players, filters, currentPlayerId, showCurrentPlayer])
  const hasFilters = Object.values(filters).some(Boolean)
  const update = (key: keyof PlayerFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }))

  async function addFriend(player: LeaguePlayer) {
    if (!currentPlayerId) return
    setRequestingFriendId(player.id)
    try {
      await sendFriendRequest(currentPlayerId, player.id)
      await friendships.mutate()
    } catch (requestError: unknown) {
      await friendships.mutate()
      window.alert(getErrorMessage(requestError, t('Žiadosť o priateľstvo sa nepodarilo odoslať.')))
    } finally {
      setRequestingFriendId(null)
    }
  }

  return (
    <div id="players" className="mx-auto max-w-[1120px]">
      <section aria-label={t('Nájsť hráčov')} className="mt-5 rounded-2xl border border-white/[0.08] bg-[#111722] p-4 sm:p-5">
        <label htmlFor="player-search" className="sr-only">{t('Hľadať podľa mena')}</label>
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" aria-hidden="true" />
          <input id="player-search" type="search" value={filters.search} onChange={(event) => update('search', event.target.value)} placeholder={t('Hľadať podľa mena')} className={`${fieldClass} py-3 pl-11`} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_120px_120px_auto] lg:items-end">
          <div>
            <label htmlFor="player-region" className={labelClass}>{t('Kraj')}</label>
            <select id="player-region" value={filters.region} onChange={(event) => update('region', event.target.value)} className={fieldClass}>
              <option value="">{t('Všetky kraje')}</option>
              {REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="player-level" className={labelClass}>{t('Úroveň')}</label>
            <select id="player-level" value={filters.level} onChange={(event) => update('level', event.target.value)} className={fieldClass}>
              <option value="">{t('Všetky úrovne')}</option>
              {PLAYER_LEVELS.map((level) => <option key={level} value={level}>{t(level)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="player-elo-min" className={labelClass}>{t('ELO od')}</label>
            <input id="player-elo-min" type="number" inputMode="numeric" min={0} step={50} value={filters.eloMin} onChange={(event) => update('eloMin', event.target.value)} placeholder="0" className={fieldClass} />
          </div>
          <div>
            <label htmlFor="player-elo-max" className={labelClass}>{t('ELO do')}</label>
            <input id="player-elo-max" type="number" inputMode="numeric" min={0} max={MAX_ELO} step={50} value={filters.eloMax} onChange={(event) => update('eloMax', event.target.value === '' ? '' : String(Math.min(MAX_ELO, Math.max(0, Number(event.target.value)))))} placeholder={String(MAX_ELO)} className={fieldClass} />
          </div>
          <button type="button" onClick={() => setFilters(emptyPlayerFilters)} disabled={!hasFilters} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-xs font-bold text-white/60 transition hover:border-[#ccff00]/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
            <RotateCcw size={14} aria-hidden="true" /> {t('Zrušiť filtre')}
          </button>
        </div>
      </section>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/40">{t('Nájdení hráči')}: <span className="text-[#ccff00]">{visiblePlayers.length}</span></p>
      </div>

      {isLoading ? (
        <p role="status" className="mt-4 rounded-2xl border border-white/[0.08] bg-[#111722] p-10 text-center text-sm text-white/50">{t('Načítavam hráčov…')}</p>
      ) : error ? (
        <div role="alert" className="mt-4 flex flex-col items-center gap-4 rounded-2xl border border-red-400/20 bg-red-400/[0.04] p-10 text-center">
          <p className="text-sm text-red-200">{getErrorMessage(error, t('Hráčov sa nepodarilo načítať.'))}</p>
          <button type="button" onClick={() => void mutate()} className="rounded-lg border border-white/10 px-4 py-2 text-xs font-bold text-white/70 hover:text-white">{t('Skúsiť znova')}</button>
        </div>
      ) : visiblePlayers.length === 0 ? (
        <div className="mt-4 flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ccff00]/10 text-[#ccff00]"><Users size={22} aria-hidden="true" /></div>
          <p className="mt-4 text-sm font-semibold text-white/75">{players.length === 0 ? t('Zatiaľ žiadni hráči') : t('Filtrom nezodpovedá žiadny hráč')}</p>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-white/40">{players.length === 0 ? t('Keď sa do ligy zaregistrujú ďalší hráči, nájdeš ich tu.') : t('Skús upraviť vyhľadávanie alebo rozsah ELO.')}</p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiblePlayers.map((player) => {
            const isCurrentPlayer = player.id === currentPlayerId
            const displayPlayer = isCurrentPlayer && currentPlayerAvatarUrl ? { ...player, avatarUrl: currentPlayerAvatarUrl } : player
            const friendshipStatus: FriendshipStatus = friendships.data?.[player.id] ?? 'none'
            const friendButtonLabel = isCurrentPlayer ? t('Tvoj profil') : friendshipStatus === 'accepted' ? t('Priatelia', 'Friends') : friendshipStatus === 'pending_sent' ? t('Žiadosť odoslaná', 'Request sent') : friendshipStatus === 'pending_received' ? t('Čaká na tvoju odpoveď', 'Request awaiting response') : t('Pridať priateľa', 'Add friend')
            return <li key={player.id} className={`flex flex-col rounded-2xl border bg-[#111722] p-5 transition hover:border-[#ccff00]/40 ${isCurrentPlayer ? 'border-[#ccff00]/40' : 'border-white/[0.08]'}`}>
              <div className="flex items-start gap-4">
                <PlayerAvatar player={displayPlayer} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-white">{player.name}</p>
                  {isCurrentPlayer ? <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ccff00]">{t('Tvoj profil')}</p> : null}
                  <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-white/45"><MapPin size={13} aria-hidden="true" /> {player.region || t('Kraj neuvedený')}</p>
                  <p className="mt-1 text-xs text-white/45">{player.level ? t(player.level) : t('Úroveň neuvedená')}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">ELO</p>
                  <p className="font-mono text-2xl font-black text-[#ccff00]">{player.elo}</p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => router.push(`/players/${player.id}`)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2.5 text-xs font-bold text-white/70 transition hover:border-white/30 hover:text-white">
                  <UserRound size={14} aria-hidden="true" /> {t('Zobraziť profil')}
                </button>
                <button type="button" disabled={isCurrentPlayer || friendshipStatus !== 'none' || !friendships.data || requestingFriendId !== null} onClick={() => void addFriend(player)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2.5 text-xs font-bold text-white/70 transition hover:border-[#ccff00]/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {isCurrentPlayer || friendshipStatus === 'pending_received' ? <UserRound size={14} aria-hidden="true" /> : friendshipStatus === 'accepted' ? <Check size={14} aria-hidden="true" /> : friendshipStatus === 'pending_sent' || requestingFriendId === player.id ? <Clock3 size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />}
                  {requestingFriendId === player.id ? t('Odosielam…', 'Sending…') : friendButtonLabel}
                </button>
              </div>
            </li>
          })}
        </ul>
      )}

    </div>
  )
}
