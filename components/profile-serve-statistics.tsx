'use client'

import { useEffect } from 'react'
import useSWR from 'swr'
import { useLanguage } from '@/components/language-provider'
import { createClient } from '@/lib/supabase/client'
import { pointSuccess } from '@/lib/match-statistics'

async function fetchServeStatistics(profileId: string) {
  const { data, error } = await createClient().rpc('profile_serve_return_statistics', { p_profile_id: profileId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : null
  if (!row || typeof row !== 'object') throw new Error('Štatistiky podania sa nenačítali.')
  const count = (key: string) => {
    const value = Number(row[key])
    if (row[key] == null || !Number.isSafeInteger(value) || value < 0) throw new Error('Neplatné štatistiky podania.')
    return value
  }
  return {
    serve: pointSuccess(count('points_won'), count('points_lost')),
    receive: pointSuccess(count('return_points_won'), count('return_points_lost')),
    recorded: count('recorded_matches'), confirmed: count('confirmed_matches'),
  }
}

export function ProfileServeStatistics({ profileId }: { profileId: string | number | null }) {
  const { t } = useLanguage()
  const { data, error, isLoading, mutate } = useSWR(
    profileId === null ? null : ['profile-serve-return-statistics', String(profileId)],
    ([, id]) => fetchServeStatistics(id),
    { refreshInterval: 15000, revalidateOnFocus: true, shouldRetryOnError: false },
  )
  useEffect(() => {
    const refresh = () => { void mutate() }
    window.addEventListener('proffiles-updated', refresh)
    return () => window.removeEventListener('proffiles-updated', refresh)
  }, [mutate])
  return <>
    {[
      { label: t('Úspešnosť vlastného podania', 'Own serve success'), stats: data?.serve,
        percentage: true,
        description: t('Body získané pri tvojom podaní / všetky body pri tvojom podaní.', 'Points won on your serve / all points on your serve.') },
      { label: t('Úspešnosť súperovho podania', 'Success on opponents’ serve'), stats: data?.receive,
        percentage: true,
        description: t('Body získané tvojou dvojicou pri podaní súperov / všetky body pri podaní súperov.', 'Points won by your pair on opponents’ serve / all points on opponents’ serve.') },
      { label: t('Vyhraté body z podania', 'Points won on own serve'), stats: data?.serve,
        percentage: false,
        description: t('Počet bodov získaných pri tvojom podaní.', 'Number of points won on your serve.') },
      { label: t('Vyhraté body zo súperovho podania', 'Points won on opponents’ serve'), stats: data?.receive,
        percentage: false,
        description: t('Počet bodov získaných tvojou dvojicou pri podaní súperov.', 'Number of points won by your pair on opponents’ serve.') },
    ].map(({ label, stats, description, percentage }) => (
      <article key={label} className="rounded-2xl border border-white/[0.08] bg-[#111722] p-5" title={description}>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{label}</h3>
        <p className="mt-4 text-3xl font-black text-[#ccff00]">{error || isLoading || !stats ? '—'
          : percentage ? stats.percent === null ? '—' : `${stats.percent}%` : stats.won}</p>
        {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error instanceof Error ? error.message : t('Štatistiky sa nepodarilo načítať.', 'Could not load statistics.')} <button type="button" className="underline" onClick={() => void mutate()}>{t('Skúsiť znova', 'Retry')}</button></p>
          : isLoading || !data || !stats
            ? <p role="status" className="mt-2 text-xs text-white/55">{isLoading ? t('Načítavam…', 'Loading…') : t('Zatiaľ bez údajov.', 'No data yet.')}</p>
            : null}
      </article>
    ))}
  </>
}
