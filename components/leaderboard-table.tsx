'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { createClient } from '@/lib/supabase/client'
import { fetchPlayerProfile } from '@/lib/profiles'
import type { Gender } from '@/lib/profiles'
import { PlayerAvatar } from '@/components/player-avatar'

type Player = { id: string; full_name: string | null; region: string | null; elo_rating: number; matches_played: number; avatar_url: string | null; gender?: Gender | null }

export function LeaderboardTable({ rows }: { rows: Player[] }) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const { t } = useLanguage()

  useEffect(() => {
    void createClient().auth.getUser().then(async ({ data }) => {
      const profile = data.user?.email ? await fetchPlayerProfile(data.user.email) : null
      setCurrentUserId(profile ? String(profile.id) : null)
    }).catch((error: unknown) => console.error('Nepodarilo sa zistiť profil prihláseného používateľa:', error))
  }, [])

  return <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1b22]"><div className="hidden grid-cols-[90px_1fr_1fr_160px_180px] border-b border-white/10 px-6 py-4 text-[10px] font-bold uppercase tracking-[.15em] text-white/35 sm:grid"><span>{t('Pozícia')}</span><span>{t('HRÁČ')}</span><span>{t('Kraj')}</span><span>{t('ELO Rating')}</span><span>{t('Odohrané zápasy')}</span></div>{rows.map((player, index) => { const name = player.full_name ?? 'Hráč'; return <div key={player.id} className="grid gap-3 border-b border-white/10 px-5 py-5 last:border-0 sm:grid-cols-[90px_1fr_1fr_160px_180px] sm:items-center sm:px-6"><span className="text-lg font-black text-[#a8e63c]">{String(index + 1).padStart(2, '0')}</span><span className="flex items-center gap-3 font-semibold"><PlayerAvatar name={name} src={player.avatar_url} gender={player.gender} className="size-9 text-sm" /><span>{name}</span></span><span className="text-sm text-white/50">{player.region}</span><span className="flex items-center gap-2 font-bold"><BarChart3 size={15} className="text-[#a8e63c]" /> {player.elo_rating}</span><span className="text-sm text-white/50">{player.matches_played}</span><Link href={`/profile?view=challenges&opponent=${encodeURIComponent(name)}`} className="text-xs font-black text-[#ccff00] hover:text-white">{t('Vyzvať')}</Link></div> })}</div>
}
