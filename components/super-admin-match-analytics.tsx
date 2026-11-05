'use client'

import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'

type CourtAnalytics = {
  arena_id: number | string
  arena_name: string
  court_id: number | string | null
  court_name: string | null
  last_day: number
  last_week: number
  last_month: number
  last_year: number
  as_of: string
}
const periods = [
  ['last_day', '24 hodín'], ['last_week', '7 dní'],
  ['last_month', 'Mesiac'], ['last_year', 'Rok'],
] as const

async function loadAnalytics(): Promise<CourtAnalytics[]> {
  const { data, error } = await createClient().rpc('super_admin_match_analytics')
  if (error) {
    console.error('Super Admin match analytics failed:', error)
    throw new Error('Štatistiky sa nepodarilo načítať. Over pripojenie a migráciu 085.')
  }
  if (!Array.isArray(data)) throw new Error('Neplatná odpoveď štatistík zápasov.')
  return data
}

export function SuperAdminMatchAnalytics() {
  const { data, error, isLoading, mutate } = useSWR('super-admin-match-analytics', loadAnalytics, { refreshInterval: 60000 })
  const arenas = new Map<string, { name: string; courts: CourtAnalytics[] }>()
  for (const row of data ?? []) {
    const key = String(row.arena_id)
    if (!arenas.has(key)) arenas.set(key, { name: row.arena_name, courts: [] })
    arenas.get(key)!.courts.push(row)
  }
  const total = (rows: CourtAnalytics[], key: typeof periods[number][0]) => rows.reduce((sum, row) => sum + Number(row[key]), 0)
  return <section className="mt-5 space-y-5">
    <div className="rounded-2xl border border-app-line/10 bg-app-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black">Odohrané zápasy</h2>
        <button onClick={() => void mutate()} className="rounded-lg border border-app-line/20 px-3 py-2 text-sm">Obnoviť štatistiky</button>
      </div>
      <p className="mt-3 text-sm text-app-fg/60">Priebežné obdobia spätne od času výpočtu: 24 hodín, 7 dní, jeden mesiac a jeden rok. Počíta sa čas dohrania zápasu, nie začiatok kalendárneho dňa či mesiaca.</p>
      <p className="mt-2 text-xs text-app-fg/50">Iba riadne dohrané hry priradené ku kurtu, vrátane rýchlych hier a odviet. Predčasne ukončené, prerušené a rozpracované hry sa nepočítajú. Ručne zadané výsledky bez záznamu hry na kurte nie sú zahrnuté. Pozastavené arény a kurty zostávajú v histórii.</p>
      {data?.[0]?.as_of ? <p className="mt-2 text-xs text-app-fg/50">Výpočet k: {new Date(data[0].as_of).toLocaleString('sk-SK')} · automatické obnovenie každú minútu</p> : null}
      {error ? <p role="alert" className="mt-4 text-red-300">{error.message}</p> : null}
      {isLoading ? <p role="status" className="mt-4">Načítavam štatistiky…</p> : null}
      {data && !error ? <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{periods.map(([key, label]) => <div key={key} className="rounded-xl bg-app-ink p-4"><p className="text-xs text-app-fg/60">{key === 'last_month' ? 'Posledný mesiac' : key === 'last_year' ? 'Posledný rok' : `Posledných ${label}`}</p><p className="mt-2 text-3xl font-black text-app-league">{total(data, key)}</p></div>)}</div> : null}
    </div>
    {!error && data?.length === 0 ? <p className="text-app-fg/60">Zatiaľ nie sú registrované arény.</p> : null}
    {!error && [...arenas].map(([id, arena]) => <section key={id} className="rounded-2xl border border-app-line/10 bg-app-panel p-5">
      <h3 className="text-lg font-bold">{arena.name}</h3>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[440px] text-left text-sm">
        <caption className="sr-only">Počty zápasov v aréne {arena.name}</caption>
        <thead><tr className="border-b border-app-line/15"><th scope="col" className="py-3">Kurt</th>{periods.map(([key, label]) => <th key={key} scope="col" className="px-3 py-3 text-right">{label}</th>)}</tr></thead>
        <tbody>
          <tr className="border-b border-app-line/10 font-bold text-app-league"><th scope="row" className="py-3">Aréna spolu</th>{periods.map(([key]) => <td key={key} className="px-3 py-3 text-right tabular-nums">{total(arena.courts, key)}</td>)}</tr>
          {arena.courts.filter(row => row.court_id !== null).map(row => <tr key={String(row.court_id)} className="border-b border-app-line/10"><th scope="row" className="py-3 font-medium">{row.court_name}</th>{periods.map(([key]) => <td key={key} className="px-3 py-3 text-right tabular-nums">{row[key]}</td>)}</tr>)}
        </tbody>
      </table></div>
      {arena.courts.every(row => row.court_id === null) ? <p className="mt-3 text-xs text-app-fg/50">Aréna zatiaľ nemá vytvorené kurty.</p> : null}
    </section>)}
  </section>
}
