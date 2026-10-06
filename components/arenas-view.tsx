'use client'

import { useMemo } from 'react'
import { Clock, MapPin, Search } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import type { Arena } from '@/lib/arenas'

export const ALL_CITIES = 'Všetky mestá'
export const ALL_REGIONS = ALL_CITIES

type ArenasViewProps = {
  arenas: Arena[]
  totalCount?: number
  isLoading: boolean
  loadError: boolean
  isAdmin?: boolean
  region: string
  setRegion: (value: string) => void
  search: string
  setSearch: (value: string) => void
  onChallenge: (arena: Arena) => void
  onMatch: (arena: Arena) => void
  onSetHome: (id: string) => void
  onSaved?: (arena: Arena) => void
  onDeleted?: (id: string) => void
}

export function ArenasView({ arenas, isLoading, loadError, region, setRegion, search, setSearch, onChallenge, onMatch, onSetHome }: ArenasViewProps) {
  const { t } = useLanguage()
  const cities = useMemo(() => [...new Set(arenas.map((arena) => arena.city).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [arenas])
  const visibleArenas = arenas.filter((arena) =>
    (region === ALL_CITIES || arena.city === region) &&
    `${arena.name} ${arena.city} ${arena.address}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <div id="arenas" className="mx-auto max-w-[1120px]">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">SPL /</p>
        <h1 className="mt-2 text-3xl font-black">{t('Arény')}</h1>
        <p className="mt-2 text-sm text-white/45">{t('Partnerské arény ligy SPL. Nájdi svoj domovský klub a rezervuj si kurt.')}</p>
      </div>

      <div className="mt-8 flex flex-col gap-3 lg:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">{t('Hľadať arénu, mesto alebo adresu')}</span>
          <Search size={17} className="absolute left-3 top-3 text-white/35" aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Hľadať arénu, mesto alebo adresu')} className="w-full rounded-xl border border-white/10 bg-[#131924] py-3 pl-10 pr-4 text-sm text-white outline-none focus:border-[#ccff00]" />
        </label>
        <label className="sr-only" htmlFor="arena-city">{t('Mesto')}</label>
        <select id="arena-city" value={region} onChange={(event) => setRegion(event.target.value)} className="rounded-xl border border-white/10 bg-[#131924] px-4 py-3 text-sm text-white outline-none focus:border-[#ccff00]">
          <option value={ALL_CITIES}>{t(ALL_CITIES)}</option>
          {cities.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <p className="mt-4 text-xs text-white/45">{t('Zobrazené arény')}: <span className="font-bold text-white">{visibleArenas.length}</span></p>

      {isLoading ? (
        <p className="mt-8 rounded-2xl border border-white/10 bg-[#131924] p-8 text-center text-sm text-white/50">{t('Načítavam arény…')}</p>
      ) : loadError ? (
        <p role="alert" className="mt-8 rounded-2xl border border-red-400/30 bg-red-500/10 p-8 text-center text-sm text-red-200">{t('Arény sa nepodarilo načítať. Skontroluj tabuľku arenas v Supabase.')}</p>
      ) : visibleArenas.length === 0 ? (
        <div className="mt-8 flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#131924] p-6 text-center">
          <MapPin size={36} className="text-[#ccff00]" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-black">{arenas.length === 0 ? t('Zatiaľ žiadne partnerské arény') : t('V tomto výbere nie je žiadna aréna')}</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-white/45">{arenas.length === 0 ? t('Liga práve pripravuje spoluprácu s arénami. Prvé kluby sa tu zobrazia čoskoro.') : t('Skús iné mesto alebo vyhľadávanie.')}</p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visibleArenas.map((arena) => (
            <li key={arena.id}>
              <ArenaCard arena={arena} onChallenge={onChallenge} onMatch={onMatch} onSetHome={onSetHome} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ArenaCard({ arena, onChallenge, onMatch, onSetHome }: { arena: Arena; onChallenge: (arena: Arena) => void; onMatch: (arena: Arena) => void; onSetHome: (id: string) => void }) {
  const { t } = useLanguage()

  return (
    <article className={`flex h-full flex-col rounded-xl border bg-[#131924] p-5 ${arena.isHomeClub ? 'border-[#ccff00]' : 'border-white/10'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-black">{arena.name}</h2>
          <p className="mt-1 text-xs text-white/45">{arena.city}</p>
        </div>
        {arena.isHomeClub ? <span className="shrink-0 rounded-full bg-[#ccff00]/15 px-2 py-1 text-[10px] font-black text-[#ccff00]">{t('Tvoj domovský klub')}</span> : null}
      </div>

      {arena.address ? <p className="mt-4 flex items-start gap-1.5 text-xs text-white/55"><MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{arena.address}</p> : null}
      <p className="mt-4 rounded-lg bg-white/5 p-3 text-xs text-white/60">{t('Počet kurtov')}: <b className="text-white">{arena.courtsCount}</b></p>

      <section className="mt-4 rounded-lg bg-white/[0.03] p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-bold text-white/75"><Clock size={13} aria-hidden="true" />{t('Otváracie hodiny')}</h3>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-white/45">{t('Pracovné dni')}</dt>
          <dd className="text-right text-white/75">{arena.openingHoursWeekday || t('Neuvedené')}</dd>
          <dt className="text-white/45">{t('Víkend')}</dt>
          <dd className="text-right text-white/75">{arena.openingHoursWeekend || t('Neuvedené')}</dd>
        </dl>
        {arena.openingHoursNote ? <p className="mt-2 border-t border-white/10 pt-2 text-xs leading-relaxed text-white/45">{arena.openingHoursNote}</p> : null}
      </section>

      <div className="mt-auto grid gap-2 pt-5">
        <button type="button" onClick={() => onChallenge(arena)} className="rounded-lg bg-[#ccff00] py-2.5 text-xs font-black text-[#10150d]">{t('Vytvoriť výzvu tu')}</button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onMatch(arena)} className="rounded-lg border border-white/10 py-2.5 text-[11px] font-bold text-white/70 hover:border-[#ccff00]/50">{t('Zadať zápas')}</button>
          <button type="button" onClick={() => onSetHome(arena.id)} className="rounded-lg border border-white/10 py-2.5 text-[11px] font-bold text-white/70 hover:border-[#ccff00]/50">{t('Nastaviť ako domov')}</button>
        </div>
      </div>
    </article>
  )
}