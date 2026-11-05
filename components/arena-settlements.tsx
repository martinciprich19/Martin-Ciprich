'use client'

import { useRef, useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'

type Summary = { arena_id: number; arena_name: string; due_cents: number; paid_cents: number; balance_cents: number }
type Payment = { id: string; arena_id: number; amount_cents: number; received_on: string; note: string; created_by: string; created_at: string; voided_at: string | null; void_reason: string | null }
type Report = { summary: Summary[]; payments: Payment[]; total_count: number; as_of: string }
const money = (cents: number) => new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' }).format(cents / 100)
const message = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Neznáma chyba spojenia.'
const localDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export function ArenaSettlements({ arenaId, superAdmin = false }: { arenaId?: string; superAdmin?: boolean }) {
  const [month, setMonth] = useState(() => localDate().slice(0, 7))
  const [offset, setOffset] = useState(0)
  const [selectedArena, setSelectedArena] = useState(arenaId ?? '')
  const [amount, setAmount] = useState('')
  const [receivedOn, setReceivedOn] = useState(localDate)
  const [note, setNote] = useState('')
  const [voidId, setVoidId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const request = useRef<{ key: string; id: string } | null>(null)
  const { data, error, mutate, isLoading } = useSWR(month ? ['settlements', month, arenaId ?? null, offset] as const : null,
    async ([, period, id, start]): Promise<Report> => {
      const { data: report, error: failure } = await createClient().rpc('arena_settlement_report', { p_month: period, p_arena_id: id, p_offset: start })
      if (failure) { console.error('Settlement report failed:', failure); throw new Error('Vyúčtovanie sa nepodarilo načítať. Over migráciu 087 a pripojenie.') }
      if (!report || !Array.isArray(report.summary) || !Array.isArray(report.payments)) throw new Error('Neplatná odpoveď vyúčtovania.')
      return report
    }, { refreshInterval: 60000 })

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setErrorText(''); setNotice('')
    try {
      const normalized = amount.trim().replace(',', '.')
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized)) throw new Error('Zadaj kladnú sumu najviac s dvoma desatinnými miestami.')
      const cents = Math.round(Number(normalized) * 100)
      if (cents < 1 || cents > 100000000) throw new Error('Suma musí byť od 0,01 do 1 000 000 €.')
      const args = { p_arena_id: selectedArena, p_month: month, p_cents: cents, p_received_on: receivedOn, p_note: note.trim() }
      const key = JSON.stringify(args)
      if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
      const { error: failure } = await createClient().rpc('super_admin_record_payment', { ...args, p_id: request.current.id })
      if (failure) throw failure
      request.current = null; setAmount(''); setNote(''); setOffset(0)
      setNotice('Prijatá platba bola zaevidovaná.'); await mutate()
    } catch (failure) { console.error('Recording payment failed:', failure); setErrorText(message(failure)) }
    finally { lock.current = false; setBusy(false) }
  }
  async function voidPayment(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setErrorText(''); setNotice('')
    try {
      const { error: failure } = await createClient().rpc('super_admin_void_payment', { p_id: voidId, p_reason: reason.trim() })
      if (failure) throw failure
      setVoidId(''); setReason(''); setNotice('Platba bola stornovaná; história zostáva zachovaná.'); await mutate()
    } catch (failure) { console.error('Voiding payment failed:', failure); setErrorText(message(failure)) }
    finally { lock.current = false; setBusy(false) }
  }
  const input = 'mt-1 block w-full rounded-lg border border-app-line/15 bg-app-ink p-3'
  return <section className="mt-7 space-y-4 rounded-2xl border border-app-line/10 bg-app-panel p-5">
    <h2 className="text-xl font-black">Vyúčtovanie arén a prijaté platby</h2>
    <p className="text-sm text-app-fg/60">Predpis je 50 % z nestornovaných prenájmov za kalendárny mesiac Europe/Bratislava. Platby zaznamenáva Super Admin ručne podľa skutočne prijatých peňazí. Nejde o faktúru ani synchronizáciu s bankou.</p>
    <label className="block text-sm">Mesiac vyúčtovania<input type="month" min="2000-01" max="2099-12" value={month} disabled={busy} onChange={e => { setMonth(e.target.value); setOffset(0); setVoidId('') }} className={input} /></label>
    <button onClick={() => void mutate()} disabled={busy || !month} className="rounded border border-app-line/20 px-3 py-2">Obnoviť</button>
    {error || errorText ? <p role="alert" className="text-red-300">{errorText || error.message}</p> : null}
    {notice ? <p role="status" className="text-emerald-300">{notice}</p> : null}
    {isLoading ? <p role="status">Načítavam vyúčtovanie…</p> : null}
    {data && !error && month ? <>
      <div className="overflow-x-auto"><table className="w-full min-w-[510px] text-left text-sm">
        <caption className="sr-only">Mesačné vyúčtovanie arén</caption>
        <thead><tr><th scope="col">Aréna</th><th scope="col">Predpis pre teba</th><th scope="col">Prijaté</th><th scope="col">Zostáva / preplatok</th></tr></thead>
        <tbody>{data.summary.map(row => <tr key={row.arena_id} className="border-t border-app-line/10">
          <th scope="row" className="py-3">{row.arena_name}</th><td>{money(row.due_cents)}</td><td>{money(row.paid_cents)}</td>
          <td>{row.balance_cents < 0 ? `Preplatok ${money(-row.balance_cents)}` : row.balance_cents === 0 ? 'Vyrovnané' : money(row.balance_cents)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="text-xs text-app-fg/50">Súčty sa prepočítavajú aj po storne pôvodného prenájmu alebo platby. Mesiac nie je účtovne uzamknutý. Preplatok sa neprenáša automaticky do ďalšieho mesiaca.</p>
      {superAdmin ? <form onSubmit={save} className="space-y-3 rounded-xl border border-app-line/15 p-4">
        <h3 className="font-bold">Zaznamenať prijatú platbu za {month}</h3>
        <label className="block text-sm">Aréna<select required value={selectedArena} disabled={busy} onChange={e => setSelectedArena(e.target.value)} className={input}><option value="">Vyber arénu</option>{data.summary.map(row => <option key={row.arena_id} value={row.arena_id}>{row.arena_name}</option>)}</select></label>
        <label className="block text-sm">Prijatá suma v €<input required inputMode="decimal" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} placeholder="Napríklad 25,50" className={input} /></label>
        <label className="block text-sm">Dátum prijatia<input type="date" min="2000-01-01" max={localDate()} required value={receivedOn} disabled={busy} onChange={e => setReceivedOn(e.target.value)} className={input} /></label>
        <label className="block text-sm">Poznámka / referencia platby<input required minLength={3} maxLength={300} value={note} disabled={busy} onChange={e => setNote(e.target.value)} className={input} /></label>
        <button disabled={busy || !selectedArena} className="rounded-lg bg-app-league px-4 py-3 font-bold text-app-ink disabled:opacity-40">Potvrdiť prijatú platbu</button>
      </form> : null}
      <h3 className="font-bold">História platieb · {data.total_count} záznamov</h3>
      <ul className="divide-y divide-app-line/10">{data.payments.map(payment => <li key={payment.id} className="space-y-2 py-3 text-sm">
        <p className="font-bold">{data.summary.find(row => row.arena_id === payment.arena_id)?.arena_name} · {money(payment.amount_cents)} · prijaté {payment.received_on}</p>
        <p>{payment.note}</p><p className="break-all text-xs text-app-fg/50">ID {payment.id} · zaevidoval {payment.created_by} · {new Date(payment.created_at).toLocaleString('sk-SK')}</p>
        {payment.voided_at ? <p className="text-amber-200">Storno {new Date(payment.voided_at).toLocaleString('sk-SK')}: {payment.void_reason}</p> : superAdmin ? <button disabled={busy} onClick={() => { setVoidId(payment.id); setReason('') }} className="rounded border border-app-line/20 px-3 py-2">Stornovať platbu</button> : null}
      </li>)}</ul>
      {data.total_count === 0 ? <p>Za tento mesiac nie sú evidované žiadne prijaté platby.</p> : null}
      <div className="flex gap-3"><button disabled={busy || offset === 0} onClick={() => setOffset(offset - 100)} className="rounded border border-app-line/20 px-3 py-2 disabled:opacity-40">Predchádzajúce</button><button disabled={busy || offset + 100 >= data.total_count} onClick={() => setOffset(offset + 100)} className="rounded border border-app-line/20 px-3 py-2 disabled:opacity-40">Ďalšie</button></div>
      {superAdmin && voidId ? <form onSubmit={voidPayment} className="space-y-3 rounded border border-amber-200/30 p-4"><p>Storno platby {voidId}</p><label className="block text-sm">Dôvod<input required minLength={3} maxLength={300} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} className={input} /></label><button disabled={busy} className="rounded border border-amber-200/30 px-3 py-2">Potvrdiť storno</button><button type="button" disabled={busy} onClick={() => setVoidId('')} className="ml-3">Zrušiť</button></form> : null}
    </> : null}
  </section>
}
