'use client'

import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { useLeague } from '@/components/league-provider'
import { useLanguage } from '@/components/language-provider'
import { useEffect } from 'react'

export function RegionFilter({ selectedRegion }: { selectedRegion: string }) {
  const router = useRouter()
  const { country, regions, isLoading } = useLeague()
  const { t } = useLanguage()
  const region = regions.includes(selectedRegion) ? selectedRegion : regions[0] ?? ''
  useEffect(() => {
    if (!isLoading && region !== selectedRegion) router.replace(`/rankings?view=regional&region=${encodeURIComponent(region)}`)
  }, [isLoading, region, selectedRegion, router])

  if (isLoading) return null

  return (
    <div className="relative">
      <label className="sr-only" htmlFor="region">{country === 'NL' ? t('Vyber provinciu', 'Select province') : t('Vyber kraj', 'Select region')}</label>
      <select
        id="region"
        name="region"
        value={region}
        onChange={(event) => router.replace(`/rankings?view=regional&region=${encodeURIComponent(event.target.value)}`)}
        className="appearance-none rounded-lg border border-app-line/10 bg-app-court px-4 py-3 pr-10 text-xs font-semibold text-app-fg outline-none focus:border-[#a8e63c]"
      >
        {regions.map((region) => <option key={region} value={region}>{region}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-app-fg/50" size={14} />
    </div>
  )
}
