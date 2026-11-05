'use client'

import { useRef, useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'

type Court = { id: string | number; name: string; is_active: boolean }
type Summary = {
  arena_id: number; court_id: number; arena_name: string; court_name: string
  count_90: number; count_120: number; revenue_cents: number; owner_cents: number
}
type Rental = {
  id: string; arena_name: string; court_name: string; duration_minutes: number
  price_cents: number; owner_share_cents: number; created_at: string; created_by: string
  voided_at: string | null; void_reason: string | null
}
type Report = { summary: Summary[]; rentals: Rental[]; total_count: number; as_of: string }
const money = (cents: number) => new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' }).format(cents / 100)
const timestamp = (value: string) => new Date(value).toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' })
const failureMessage = (failure: unknown) => failure && typeof failure === 'object' && 'message' in failure && typeof failure.message === 'string' ? failure.message : 'Neznáma chyba spojenia.'

function currentMonth() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`
}

export function ClickerRentals({ arenaId, courts = [], superAdmin = false }: { arenaId?: string; courts?: Court[]; superAdmin?: boolean }) {
  const [month, setMonth] = useState(currentMonth)
  const [offset, setOffset] = useState(0)
  const [courtId, setCourtId] = useState('')
  const [duration, setDuration] = useState('90')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const [voidId, setVoidId] = useState('')
  const [reason, setReason] = useState('')
  const request = useRef<{ key: string; id: string } | null>(null)
  const submitting = useRef(false)
  const { data, error, isLoading, mutate } = useSWR(
    month ? ['clicker-rentals', arenaId ?? null, month, offset] as const : null,
    async ([, id, selectedMonth, selectedOffset]): Promise<Report> => {
      const { data: report, error: queryError } = await createClient().rpc('clicker_rental_report', { p_month: selectedMonth, p_arena_id: id, p_offset: selectedOffset })
      if (queryError) {
        console.error('Clicker rental report failed:', queryError)
        throw new Error('Prenájmy sa nepodarilo načítať. Over pripojenie a migráciu 086.')
      }
      if (!report || !Array.isArray(report.summary) || !Array.isArray(report.rentals)) throw new Error('Neplatná odpoveď evidencie prenájmov.')
      return report
    }, { refreshInterval: 60000 },
  )

  async function saveRental(event: React.FormEvent) {
    event.preventDefault()
    if (submitting.current || !confirmed || !courtId) return
    submitting.current = true
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      const key = `${courtId}:${duration}`
      if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
      const { error: saveError } = await createClient().rpc('record_clicker_rental', {
        p_request_id: request.current.id, p_court_id: courtId, p_duration_minutes: Number(duration),
      })
      if (saveError) throw saveError
      request.current = null
      setCourtId('')
      setConfirmed(false)
      setMonth(currentMonth())
      setOffset(0)
      setNotice('Prenájom bol zaevidovaný. Odveta ani ďalší zápas nevytvoria nový prenájom.')
      await mutate()
    } catch (failure) {
      console.error('Recording clicker rental failed:', failure)
      setActionError(`Prenájom sa nepodarilo potvrdiť: ${failureMessage(failure)} Skontroluj históriu; pri opakovaní rovnakého formulára sa táto požiadavka nezapočíta dvakrát.`)
    } finally { submitting.current = false; setBusy(false) }
  }

  async function voidRental(event: React.FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      const { error: voidError } = await createClient().rpc('void_clicker_rental', { p_rental_id: voidId, p_reason: reason.trim() })
      if (voidError) throw voidError
      setVoidId('')
      setReason('')
      setNotice('Prenájom bol stornovaný. Záznam a dôvod zostávajú v histórii.')
      await mutate()
    } catch (failure) {
      console.error('Voiding clicker rental failed:', failure)
      setActionError(`Storno sa nepodarilo potvrdiť: ${failureMessage(failure)}`)
    } finally { submitting.current = false; setBusy(false) }
  }

  const groups = new Map<string, { name: string; rows: Summary[] }>()
  for (const row of data?.summary ?? []) {
    const key = String(row.arena_id)
    if (!groups.has(key)) groups.set(key, { name: row.arena_name, rows: [] })
    groups.get(key)!.rows.push(row)
  }
  const sum = (rows: Summary[], key: 'count_90' | 'count_120' | 'revenue_cents' | 'owner_cents') => rows.reduce((total, row) => total + Number(row[key]), 0)

  return <section className="mt-7 space-y-5 rounded-2xl border border-app-line/10 bg-app-panel p-5 sm:p-7">
    <h2 className="text-xl font-black">Prenájmy klikrov</h2>
    <p className="text-sm text-app-fg/60">Jeden prenájom = celá sada pre kurt, nie jeden zápas. 90 min: 2 € (podiel prevádzkovateľa aplikácie 1 €), 120 min: 2,50 € (podiel 1,25 €). Podiel prevádzkovateľa aplikácie je 50 %.</p>
    {arenaId ? <form onSubmit={saveRental} className="space-y-3 rounded-xl border border-app-line/15 p-4">
      <h3 className="font-bold">Obsluha: odovzdanie sady klikrov</h3>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">Kurt<select required disabled={busy} value={courtId} onChange={event => { setCourtId(event.target.value); setConfirmed(false) }} className="mt-1 block rounded-lg bg-app-ink p-3">
          <option value="">Vyber kurt</option>{courts.filter(court => court.is_active).map(court => <option key={court.id} value={court.id}>{court.name}</option>)}
        </select></label>
        <label className="text-sm">Dĺžka a cena<select disabled={busy} value={duration} onChange={event => { setDuration(event.target.value); setConfirmed(false) }} className="mt-1 block rounded-lg bg-app-ink p-3">
          <option value="90">90 minút / 2 €</option><option value="120">120 minút / 2,50 €</option>
        </select></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" required disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Potvrdzujem nové odovzdanie celej sady. Nejde o ďalší zápas v rámci existujúceho prenájmu.</label>
      <button disabled={busy || !confirmed || !courtId} className="rounded-lg bg-app-league px-4 py-3 font-bold text-app-ink disabled:opacity-40">Zaevidovať prenájom</button>
      <p className="text-xs text-app-fg/50">Uloží sa aktuálny čas servera. Omyl môže stornovať Super Admin; aréna nemôže záznam vymazať.</p>
    </form> : null}
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Mesiac vyúčtovania<input type="month" min="2000-01" max="2099-12" required value={month} onChange={event => { setMonth(event.target.value); setOffset(0); setVoidId('') }} className="mt-1 block rounded-lg bg-app-ink p-3" /></label>
      <button disabled={!month || busy} onClick={() => void mutate()} className="rounded-lg border border-app-line/20 px-4 py-3 disabled:opacity-40">Obnoviť</button>
    </div>
    <p className="text-xs text-app-fg/50">Kalendárny mesiac podľa času Europe/Bratislava, podľa odovzdania sady. Toto je evidencia a podklad na vyúčtovanie, nie potvrdenie platby ani faktúra. Počty vychádzajú zo záznamov obsluhy, nie z automatickej kontroly fyzického prenájmu.</p>
    {actionError || error ? <p role="alert" className="text-red-300">{actionError || error.message}</p> : null}
    {notice ? <p role="status" className="text-emerald-300">{notice}</p> : null}
    {isLoading ? <p role="status">Načítavam prenájmy…</p> : null}
    {data && !error && month ? <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([['90 minút', String(sum(data.summary, 'count_90'))], ['120 minút', String(sum(data.summary, 'count_120'))], ['Tržba od hráčov', money(sum(data.summary, 'revenue_cents'))], ['Podiel pre prevádzkovateľa', money(sum(data.summary, 'owner_cents'))]]).map(([label, value]) => <div key={label} className="rounded-lg bg-app-ink p-4"><p className="text-xs text-app-fg/60">{label}</p><p className="mt-2 text-xl font-black text-app-league">{value}</p></div>)}
      </div>
      {[...groups].map(([id, arena]) => <div key={id}>
        <h3 className="font-bold">{arena.name} · podiel {money(sum(arena.rows, 'owner_cents'))}</h3>
        <div className="overflow-x-auto"><table className="mt-2 w-full min-w-[460px] text-left text-sm">
          <caption className="sr-only">Prenájmy v aréne {arena.name}</caption>
          <thead><tr><th scope="col" className="py-2">Kurt</th><th scope="col">90 min</th><th scope="col">120 min</th><th scope="col">Tržba</th><th scope="col">Podiel 50 %</th></tr></thead>
          <tbody>{arena.rows.map((row, index) => <tr key={`${row.court_id}:${index}`} className="border-t border-app-line/10"><th scope="row" className="py-3 font-medium">{row.court_name}</th><td>{row.count_90}</td><td>{row.count_120}</td><td>{money(row.revenue_cents)}</td><td>{money(row.owner_cents)}</td></tr>)}</tbody>
          <tfoot><tr className="border-t border-app-line/20 font-bold"><th scope="row" className="py-3">Aréna spolu</th><td>{sum(arena.rows, 'count_90')}</td><td>{sum(arena.rows, 'count_120')}</td><td>{money(sum(arena.rows, 'revenue_cents'))}</td><td>{money(sum(arena.rows, 'owner_cents'))}</td></tr></tfoot>
        </table></div>
      </div>)}
      <h3 className="font-bold">História · {data.rentals.length ? offset + 1 : 0} až {offset + data.rentals.length} z {data.total_count} záznamov</h3>
      <p className="text-xs text-app-fg/50">Súčty zahŕňajú celý zvolený mesiac, nie iba zobrazených 100 záznamov. Storná sa do súčtov nezapočítavajú. Čas posledného výpočtu: {timestamp(data.as_of)}.</p>
      {data.total_count === 0 ? <p>V tomto mesiaci zatiaľ nie sú evidované prenájmy.</p> : null}
      <ul className="divide-y divide-app-line/10">{data.rentals.map(rental => <li key={rental.id} className="space-y-1 py-3 text-sm">
        <p className="font-bold">{rental.arena_name} / {rental.court_name} · {rental.duration_minutes} min · {money(rental.price_cents)} · podiel {money(rental.owner_share_cents)}</p>
        <p className="text-xs text-app-fg/60">{timestamp(rental.created_at)} · ID: {rental.id} · obsluha: {rental.created_by}</p>
        {rental.voided_at ? <p className="text-amber-200">Stornované {timestamp(rental.voided_at)}: {rental.void_reason}</p> : superAdmin ? <button disabled={busy} onClick={() => { setVoidId(rental.id); setReason('') }} className="rounded border border-app-line/20 px-3 py-2">Stornovať s dôvodom</button> : null}
      </li>)}</ul>
      <div className="flex gap-3">
        <button disabled={busy || offset === 0} onClick={() => { setOffset(Math.max(0, offset - 100)); setVoidId('') }} className="rounded border border-app-line/20 px-3 py-2 disabled:opacity-40">Predchádzajúce</button>
        <button disabled={busy || offset + 100 >= data.total_count} onClick={() => { setOffset(offset + 100); setVoidId('') }} className="rounded border border-app-line/20 px-3 py-2 disabled:opacity-40">Ďalšie</button>
      </div>
      {superAdmin && voidId ? <form onSubmit={voidRental} className="space-y-3 rounded-lg border border-amber-300/30 p-4">
        <p className="text-sm">Storno prenájmu {voidId}. Suma sa odpočíta z pôvodného mesiaca; záznam zostane zachovaný.</p>
        <label className="block text-sm">Dôvod storna<input required minLength={3} maxLength={300} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 block w-full rounded-lg bg-app-ink p-3" /></label>
        <button disabled={busy || reason.trim().length < 3} className="rounded-lg border border-amber-300/40 px-4 py-2 disabled:opacity-40">Potvrdiť storno</button>
        <button type="button" disabled={busy} onClick={() => setVoidId('')} className="ml-3 px-4 py-2">Zrušiť</button>
      </form> : null}
    </> : null}
  </section>
}
