'use client'

import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

const regions = ['Bratislavský kraj', 'Trnavský kraj', 'Žilinský kraj', 'Nitriansky kraj', 'Trenčiansky kraj', 'Banskobystrický kraj', 'Prešovský kraj', 'Košický kraj']

export function RegionFilter({ selectedRegion }: { selectedRegion: string }) {
  const router = useRouter()

  return (
    <div className="relative">
      <label className="sr-only" htmlFor="region">Vyber kraj</label>
      <select
        id="region"
        name="region"
        value={selectedRegion}
        onChange={(event) => router.replace(`/rankings?view=regional&region=${encodeURIComponent(event.target.value)}`)}
        className="appearance-none rounded-lg border border-white/10 bg-[#0b1b22] px-4 py-3 pr-10 text-xs font-semibold text-white outline-none focus:border-[#a8e63c]"
      >
        {regions.map((region) => <option key={region} value={region}>{region}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/50" size={14} />
    </div>
  )
}
