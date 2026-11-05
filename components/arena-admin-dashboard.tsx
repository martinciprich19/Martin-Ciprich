'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, ExternalLink, LoaderCircle, Plus, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ArenaSponsorAdsManager } from '@/components/arena-sponsor-ads-manager'
import { ArenaKioskDevices } from '@/components/arena-kiosk-devices'
import { ClickerRentals } from '@/components/clicker-rentals'

type ManagedArena = {
  id: string
  name: string
  city: string
  address: string
  countryCode: string
}

type Court = {
  id: number | string
  arena_id: number | string
  name: string
  sort_order: number
  is_active: boolean
}

export function ArenaAdminDashboard({ arenas }: { arenas: ManagedArena[] }) {
  const [selectedArenaId, setSelectedArenaId] = useState(arenas[0].id)
  const [courts, setCourts] = useState<Court[]>([])
  const [courtName, setCourtName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selectedArena = arenas.find((arena) => arena.id === selectedArenaId) ?? arenas[0]

  const loadCourts = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: queryError } = await createClient()
      .from('arena_courts')
      .select('id, arena_id, name, sort_order, is_active')
      .eq('arena_id', selectedArena.id)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })

    if (queryError) {
      console.error('Could not load arena courts:', queryError)
      setError('Kurty sa nepodarilo načítať. Skontroluj, či je spustená migrácia 071.')
    } else {
      setCourts((data ?? []) as Court[])
    }
    setLoading(false)
  }, [selectedArena.id])

  useEffect(() => {
    void loadCourts()
  }, [loadCourts])

  async function addCourt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = courtName.trim()
    if (!name || saving) return

    setSaving(true)
    setError('')
    setNotice('')
    const { error: insertError } = await createClient()
      .from('arena_courts')
      .insert({ arena_id: selectedArena.id, name, sort_order: courts.length })

    if (insertError) {
      console.error('Could not add arena court:', insertError)
      setError(insertError.code === '23505' ? 'Kurt s týmto názvom už v aréne existuje.' : 'Kurt sa nepodarilo pridať.')
    } else {
      setCourtName('')
      setNotice('Kurt bol pridaný.')
      await loadCourts()
    }
    setSaving(false)
  }

  async function toggleCourt(court: Court) {
    if (saving) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: updateError } = await createClient()
      .from('arena_courts')
      .update({ is_active: !court.is_active })
      .eq('id', court.id)
      .eq('arena_id', selectedArena.id)

    if (updateError) {
      console.error('Could not update arena court:', updateError)
      setError('Stav kurtu sa nepodarilo zmeniť.')
    } else {
      setNotice(court.is_active ? 'Kurt bol vypnutý.' : 'Kurt bol zapnutý.')
      await loadCourts()
    }
    setSaving(false)
  }

  return (
    <main className="min-h-screen bg-app-ink px-4 py-8 text-app-fg sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-5 border-b border-app-line/10 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-app-league">RIVA / SPRÁVA ARÉNY</p>
            <h1 className="mt-2 text-3xl font-black">Správcovský panel</h1>
            <p className="mt-2 text-sm text-app-fg/50">Správcovské funkcie sú dostupné len pre arény priradené k tvojmu účtu.</p>
          </div>
          <a href="/profile" className="text-sm font-bold text-app-fg/65 hover:text-app-fg">Späť do aplikácie</a>
        </header>

        <section className="mt-7 rounded-2xl border border-app-line/10 bg-app-panel p-5 sm:p-7" aria-labelledby="arena-heading">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#ccff00]/10 text-app-league">
              <Building2 size={22} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="arena-heading" className="text-xl font-black">{selectedArena.name}</h2>
              <p className="mt-1 text-sm text-app-fg/50">{[selectedArena.city, selectedArena.countryCode].filter(Boolean).join(' · ')}</p>
              {selectedArena.address ? <p className="mt-1 text-xs text-app-fg/40">{selectedArena.address}</p> : null}
            </div>
            {arenas.length > 1 ? (
              <label>
                <span className="sr-only">Vyber arénu</span>
                <select value={selectedArenaId} onChange={(event) => setSelectedArenaId(event.target.value)} className="max-w-48 rounded-lg border border-app-line/15 bg-app-ink px-3 py-2 text-sm">
                  {arenas.map((arena) => <option key={arena.id} value={arena.id}>{arena.name}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        </section>

        <section className="mt-7 rounded-2xl border border-app-line/10 bg-app-panel p-5 sm:p-7" aria-labelledby="courts-heading">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-app-league">PREVÁDZKA</p>
              <h2 id="courts-heading" className="mt-1 text-xl font-black">Správa kurtov</h2>
            </div>
            <button type="button" onClick={() => void loadCourts()} disabled={loading} aria-label="Obnoviť zoznam kurtov" className="rounded-lg border border-app-line/15 p-2 text-app-fg/60 hover:border-[#ccff00]/40 disabled:opacity-40">
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
          </div>

          <form onSubmit={addCourt} className="mt-5 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="new-court-name">Názov kurtu</label>
            <input id="new-court-name" value={courtName} onChange={(event) => setCourtName(event.target.value)} maxLength={80} required placeholder="Napríklad Kurt 1 – Center Court" className="min-h-11 flex-1 rounded-lg border border-app-line/15 bg-app-ink px-3 text-sm outline-none focus:border-[#ccff00]/60" />
            <button type="submit" disabled={saving || !courtName.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#ccff00] px-4 text-sm font-black text-[#10150d] disabled:opacity-50">
              {saving ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
              Pridať kurt
            </button>
          </form>

          {error ? <p role="alert" className="mt-4 rounded-lg border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
          {notice ? <p role="status" className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</p> : null}

          {loading ? (
            <p role="status" className="mt-6 flex items-center justify-center gap-2 py-6 text-sm text-app-fg/50"><LoaderCircle size={17} className="animate-spin" /> Načítavam kurty…</p>
          ) : courts.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-app-line/15 p-6 text-center text-sm text-app-fg/50">Zatiaľ tu nie sú nastavené žiadne kurty. Pridaj prvý kurt vyššie.</p>
          ) : (
            <ul className="mt-5 divide-y divide-app-line/10">
              {courts.map((court) => (
                <li key={court.id} className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <p className="font-bold">{court.name}</p>
                    <p className={`mt-1 text-xs ${court.is_active ? 'text-emerald-300' : 'text-app-fg/40'}`}>{court.is_active ? 'Aktívny' : 'Vypnutý'}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
                      <a href={`/kiosk-preview/${encodeURIComponent(String(court.id))}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-app-fg/65 hover:text-app-league">
                        Živý náhľad kiosku <ExternalLink size={12} aria-hidden="true" />
                      </a>
                      <a href={`/scoreboard/${encodeURIComponent(String(court.id))}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-app-fg/65 hover:text-app-league">
                        Monitor skóre <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                  <button type="button" disabled={saving} onClick={() => void toggleCourt(court)} className="rounded-lg border border-app-line/15 px-3 py-2 text-xs font-bold hover:border-[#ccff00]/40 disabled:opacity-50">
                    {court.is_active ? 'Vypnúť kurt' : 'Zapnúť kurt'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ClickerRentals key={`rentals-${selectedArena.id}`} arenaId={selectedArena.id} courts={loading ? [] : courts.filter(court => String(court.arena_id) === selectedArena.id)} />
        <ArenaKioskDevices key={selectedArena.id} arenaId={selectedArena.id} courts={courts} />
        <ArenaSponsorAdsManager arenaId={selectedArena.id} />

        <p className="mt-5 text-xs leading-5 text-app-fg/40">
          Nastavenia bodovania a formátu zápasu sa tu nemenia. Hráči si ich vyberajú priamo na kiosku pred začiatkom hry.
        </p>
      </div>
    </main>
  )
}
