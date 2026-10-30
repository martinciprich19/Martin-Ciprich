'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { createClient } from '@/lib/supabase/client'
import { fetchPlayerProfile, fetchPlayerProfiles } from '@/lib/profiles'
import type { Gender } from '@/lib/profiles'
import { PlayerAvatar } from '@/components/player-avatar'
import { useLeague } from '@/components/league-provider'
import type { CountryCode } from '@/lib/countries'

type Player = { id: string; full_name: string | null; region: string | null; elo_rating: number; matches_played: number; avatar_url: string | null; gender?: Gender | null; country_code?: CountryCode }

export function LeaderboardTable({ rows }: { rows: Player[] }) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const { t } = useLanguage()
  const { country, isLoading: leagueLoading } = useLeague()
  const rowIds = rows.map((player) => player.id)
  const players = useSWR(leagueLoading ? null : ['leaderboard-players', country, rowIds.join(',')], async () => {
    const profiles = new Map((await fetchPlayerProfiles(country)).map((player) => [String(player.id), player]))
    return rowIds.flatMap((id) => {
      const player = profiles.get(id)
      return player ? [{ ...player, id }] : []
    })
  })
  const countryRows = players.data ?? rows.filter((player) => player.country_code === country)

  useEffect(() => {
    void createClient().auth.getUser().then(async ({ data }) => {
      const profile = data.user?.email ? await fetchPlayerProfile(data.user.email) : null
      setCurrentUserId(profile ? String(profile.id) : null)
    }).catch((error: unknown) => console.error('Nepodarilo sa zistiť profil prihláseného používateľa:', error))
  }, [])

  if (leagueLoading) return null

  return <div className="overflow-hidden rounded-2xl border border-app-line/10 bg-app-court">
    <div className="hidden grid-cols-[90px_1fr_1fr_160px_180px] border-b border-app-line/10 px-6 py-4 text-[10px] font-bold uppercase tracking-[.15em] text-app-fg/35 sm:grid">
      <span>{t('Pozícia')}</span><span>{t('HRÁČ')}</span><span>{country === 'NL' ? t('Provincia', 'Province') : t('Kraj')}</span><span>{t('ELO Rating')}</span><span>{t('Odohrané zápasy')}</span>
    </div>
    {players.error ? <p role="alert" className="p-5 text-sm text-app-red-200">{t('Hráčov sa nepodarilo načítať.', 'Could not load players.')}</p> : null}
    {countryRows.map((player, index) => {
      const name = player.full_name ?? t('Hráč', 'Player')
      return <div key={player.id} className="grid gap-3 border-b border-app-line/10 px-5 py-5 last:border-0 sm:grid-cols-[90px_1fr_1fr_160px_180px] sm:items-center sm:px-6">
        <span className="text-lg font-black text-app-accent">{String(index + 1).padStart(2, '0')}</span>
        <span className="flex items-center gap-3 font-semibold"><PlayerAvatar name={name} src={player.avatar_url} gender={player.gender} className="size-9 text-sm" /><span>{name}</span></span>
        <span className="text-sm text-app-fg/50">{player.region}</span>
        <span className="flex items-center gap-2 font-bold"><BarChart3 size={15} className="text-app-accent" /> {player.elo_rating}</span>
        <span className="text-sm text-app-fg/50">{player.matches_played}</span>
        <Link href={`/profile?view=challenges&opponent=${encodeURIComponent(name)}`} className="text-xs font-black text-app-league hover:text-app-fg">{t('Vyzvať')}</Link>
      </div>
    })}
  </div>
}
