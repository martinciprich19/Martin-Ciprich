'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, MapPin, Radio, RefreshCw } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { useLeague } from '@/components/league-provider'
import { uiTranslations } from '@/lib/i18n/ui-translations'
import { createClient } from '@/lib/supabase/client'
import type { CountryCode } from '@/lib/countries'

type LiveMatch = {
  country_code: CountryCode
  id: string
  team_a_player1_name: string
  team_a_player2_name: string
  team_b_player1_name: string
  team_b_player2_name: string
  team_a_game_score: number
  team_b_game_score: number
  team_a_games: number
  team_b_games: number
  team_a_sets: number
  team_b_sets: number
  started_at: string
  paused_at: string | null
  arena_id: string | number | null
  arena_name: string | null
  city: string | null
  region: string | null
}

const ALL_REGIONS = 'all-regions'
const ALL_ARENAS = 'all-arenas'

export function LiveMatchesView() {
  const { country, isLoading } = useLeague()
  return isLoading ? null : <CountryLiveMatchesView key={country} />
}

function CountryLiveMatchesView() {
  const { t } = useLanguage()
  const { country, regions } = useLeague()
  const [matches, setMatches] = useState<LiveMatch[]>([])
  const [selectedRegion, setSelectedRegion] = useState(ALL_REGIONS)
  const [selectedArena, setSelectedArena] = useState(ALL_ARENAS)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const loadMatches = useCallback(async (background = false, isActive: () => boolean = () => true) => {
    if (background) setIsRefreshing(true)
    else setIsLoading(true)

    try {
      const { data, error } = await createClient().rpc('get_public_live_matches', { p_country_code: country })
      if (error) throw error
      if (!isActive()) return
      setMatches(((data ?? []) as LiveMatch[]).filter((match) => match.country_code === country))
      setLoadError(false)
    } catch (error: unknown) {
      console.error('Načítanie prebiehajúcich zápasov zlyhalo:', error)
      if (isActive()) setLoadError(true)
    } finally {
      if (isActive()) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [country])

  useEffect(() => {
    let active = true
    const checkActive = () => active
    void loadMatches(false, checkActive)
    const interval = window.setInterval(() => void loadMatches(true, checkActive), 15_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [loadMatches])

  const arenas = useMemo(() => {
    const filtered = selectedRegion === ALL_REGIONS ? matches : matches.filter((match) => match.region === selectedRegion)
    return [...new Map(filtered.filter((match) => match.arena_id !== null && match.arena_name).map((match) => [String(match.arena_id), match.arena_name as string])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
  }, [matches, selectedRegion])
  const visibleMatches = matches.filter((match) =>
    (selectedRegion === ALL_REGIONS || match.region === selectedRegion) &&
    (selectedArena === ALL_ARENAS || String(match.arena_id) === selectedArena))

  return (
    <section className="mx-auto max-w-[1120px] py-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-app-league">RIVA / LIVE</p>
        <h1 className="mt-2 text-3xl font-black">{t('Prebiehajúce zápasy', 'Live matches')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-app-fg/50">{t('Sleduj hrané aj prerušené zápasy v aplikácii RIVA Padel a filtruj ich podľa kraja alebo arény.', 'Follow live and paused matches in RIVA Padel and filter by region or arena.')}</p>
      </header>

      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-app-fg/65">{country === 'NL' ? t('Provincia', 'Province') : t('Kraj', 'Region')}</span>
          <select value={selectedRegion} onChange={(event) => { setSelectedRegion(event.target.value); setSelectedArena(ALL_ARENAS) }} className="w-full rounded-xl border border-app-line/10 bg-app-panel px-4 py-3 text-sm text-app-fg outline-none focus:border-[#a8e63c]">
            <option value={ALL_REGIONS}>{country === 'NL' ? t('Všetky provincie', 'All provinces') : t('Všetky kraje', 'All regions')}</option>
            {regions.map((region) => <option key={region} value={region}>{t(region, uiTranslations[region] ?? region)}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-app-fg/65">{t('Aréna', 'Arena')}</span>
          <select value={selectedArena} onChange={(event) => setSelectedArena(event.target.value)} className="w-full rounded-xl border border-app-line/10 bg-app-panel px-4 py-3 text-sm text-app-fg outline-none focus:border-[#a8e63c]">
            <option value={ALL_ARENAS}>{t('Všetky arény', 'All arenas')}</option>
            {arenas.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-app-fg/45">
        <p>{t('Počet zápasov', 'Matches')}: <strong className="text-app-fg">{visibleMatches.length}</strong></p>
        <button type="button" onClick={() => void loadMatches(true)} disabled={isRefreshing} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-app-line/10 px-3 py-2 font-semibold text-app-fg/70 transition hover:border-app-line/30 disabled:opacity-50">
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />{t('Obnoviť', 'Refresh')}
        </button>
      </div>

      {loadError ? (
        <p role="alert" className="mt-6 rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-center text-sm text-app-red-200">{t('Prebiehajúce zápasy sa nepodarilo načítať. Skontroluj nasadenie SQL migrácií 067–069.', 'Could not load live matches. Check that SQL migrations 067–069 have been applied.')}</p>
      ) : isLoading ? (
        <p role="status" className="mt-6 rounded-2xl border border-app-line/10 bg-app-panel p-8 text-center text-sm text-app-fg/50">{t('Načítavam zápasy…', 'Loading matches…')}</p>
      ) : visibleMatches.length === 0 ? (
        <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-app-line/10 bg-app-panel p-6 text-center">
          <Radio size={34} className="text-app-highlight" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-black">{matches.length === 0 ? t('Momentálne nie sú žiadne hrané ani prerušené zápasy.', 'There are no live or paused matches right now.') : t('Pre tento filter sa nenašli zápasy.', 'No matches found for these filters.')}</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-app-fg/45">{t('Zobrazujú sa spustené zápasy vrátane prerušených. Ukončené zápasy sa nezobrazujú.', 'Started matches, including paused matches, are shown. Finished matches are not shown.')}</p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 lg:grid-cols-2">
          {visibleMatches.map((match) => (
            <li key={match.id}>
              <Link href={`/match?id=${encodeURIComponent(match.id)}&view=viewer`} className="group block rounded-2xl border border-app-line/10 bg-app-panel p-5 transition hover:border-[#a8e63c]/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8e63c]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs text-app-fg/50"><MapPin size={13} aria-hidden="true" />{match.arena_name || t('Aréna neuvedená', 'Arena not specified')}{match.city ? ` · ${match.city}` : ''}</p>
                    {match.region ? <p className="mt-1 text-[11px] text-app-fg/35">{t(match.region, uiTranslations[match.region] ?? match.region)}</p> : null}
                  </div>
                  {match.paused_at ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-300">{t('Prerušený zápas', 'Paused match')}</span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />{t('Naživo', 'Live')}</span>
                  )}
                </div>

                <div className="mt-5 flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <p className="truncate text-sm font-bold text-app-fg">{match.team_a_player1_name} / {match.team_a_player2_name}</p>
                    <p className="truncate text-sm font-bold text-app-fg">{match.team_b_player1_name} / {match.team_b_player2_name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-app-fg/40">{t('Sety', 'Sets')}</p>
                    <p className="mt-1 text-xl font-black tabular-nums text-app-fg">{match.team_a_sets} : {match.team_b_sets}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-app-line/10 pt-3 text-xs text-app-fg/45">
                  <span>{t('Gemy', 'Games')} {match.team_a_games}:{match.team_b_games} · {t('Body', 'Points')} {match.team_a_game_score}:{match.team_b_game_score}</span>
                  <span className="inline-flex items-center gap-1 font-bold text-app-highlight">{t('Otvoriť zápas', 'Open match')}<ArrowRight size={13} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" /></span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
