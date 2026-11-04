'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'

type Device = { id: string; name: string; court_id: number | string | null; device_role: string; created_at: string; revoked_at: string | null }
type Court = { id: number | string; name: string; is_active: boolean }

export function ArenaKioskDevices({ arenaId, courts }: { arenaId: string; courts: Court[] }) {
  const [devices, setDevices] = useState<Device[]>([])
  const [name, setName] = useState('')
  const [courtId, setCourtId] = useState('')
  const [code, setCode] = useState('')
  const [role, setRole] = useState('kiosk')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const { data, error } = await createClient().from('arena_kiosk_devices')
        .select('id, name, court_id, device_role, created_at, revoked_at').eq('arena_id', arenaId)
        .order('created_at', { ascending: false })
      if (error) throw error
      setDevices(data ?? [])
    } catch (error) {
      console.error('Načítanie kioskových zariadení zlyhalo:', error)
      setError(getErrorMessage(error, 'Zariadenia sa nepodarilo načítať. Over migráciu 081.'))
    }
  }, [arenaId])
  useEffect(() => { void load() }, [load])

  async function authorize(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data, error } = await createClient().rpc('claim_device_pairing', {
        p_code: code.trim().toUpperCase(), p_arena_id: arenaId, p_court_id: courtId,
        p_name: name.trim(), p_role: role,
      })
      if (error) throw error
      if (data?.paired !== true) throw new Error(data?.error ?? 'Priradenie zariadenia zlyhalo.')
      setCode('')
      setName('')
      setNotice('Zariadenie bolo priradené. Na cieľovej obrazovke sa režim otvorí automaticky.')
      await load()
    } catch (error) {
      console.error('Zapnutie autorizovaného kiosku zlyhalo:', error)
      setError(getErrorMessage(error, 'Autorizácia zariadenia zlyhala.'))
    } finally { setBusy(false) }
  }

  async function revoke(id: string) {
    if (busy || !window.confirm('Odvolať toto zariadenie? Pri ďalšom otvorení stránky sa jeho režim zruší.')) return
    setBusy(true)
    setError('')
    try {
      const { error } = await createClient().rpc('revoke_kiosk_device', { p_device_id: id })
      if (error) throw error
      await load()
    } catch (error) {
      console.error('Zrušenie autorizácie kiosku zlyhalo:', error)
      setError(getErrorMessage(error, 'Autorizáciu sa nepodarilo zrušiť.'))
    } finally { setBusy(false) }
  }

  return <section className="mt-7 rounded-2xl border border-app-line/10 bg-app-panel p-5 sm:p-7">
    <h2 className="text-xl font-black">Tablety a monitory kurtov</h2>
    <p className="mt-2 text-sm text-app-fg/60">Na cieľovom tablete v RIVA aplikácii alebo na TV otvor /device-pair a zobraz kód. Tu na svojom adminskom zariadení zadaj kód, vyber kurt a režim.</p>
    <form onSubmit={authorize} className="mt-5 flex flex-col gap-3 sm:flex-row">
      <input aria-label="Párovací kód" required pattern="[A-Fa-f0-9]{8}" maxLength={8} value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="Párovací kód" className="min-h-12 min-w-0 rounded-xl border border-app-line/15 bg-app-ink px-4" />
      <label className="sr-only" htmlFor="kiosk-court">Kurt pre tento tablet</label>
      <select id="kiosk-court" required value={courtId} onChange={event => setCourtId(event.target.value)} className="min-h-12 rounded-xl border border-app-line/15 bg-app-ink px-4">
        <option value="">Vyber kurt</option>
        {courts.filter(court => court.is_active).map(court => <option key={court.id} value={String(court.id)}>{court.name}</option>)}
      </select>
      <select aria-label="Režim zariadenia" value={role} onChange={event => setRole(event.target.value)} className="min-h-12 rounded-xl border border-app-line/15 bg-app-ink px-4">
        <option value="kiosk">Tablet – kiosk</option><option value="scoreboard">TV – monitor skóre</option>
      </select>
      <label className="sr-only" htmlFor="kiosk-device-name">Názov zariadenia</label>
      <input id="kiosk-device-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required placeholder="Napríklad Tablet – Kurt 1" className="min-h-12 flex-1 rounded-xl border border-app-line/15 bg-app-ink px-4" />
      <button disabled={busy || !name.trim() || !courtId || code.length !== 8} className="min-h-12 rounded-xl bg-app-highlight px-5 font-bold text-app-ink disabled:opacity-40">Priradiť zariadenie</button>
    </form>
    <p className="mt-3 text-xs text-app-fg/45">Admin zostáva prihlásený iba tu. Kód je jednorazový; každý kurt má jeden tablet a jeden monitor. Vymazanie údajov cieľovej aplikácie alebo prehliadača odstráni lokálne oprávnenie.</p>
    {error ? <p role="alert" className="mt-4 text-sm text-app-red-200">{error}</p> : null}
    {notice ? <p role="status" className="mt-4 text-sm text-emerald-300">{notice}</p> : null}
    <ul className="mt-5 space-y-3">{devices.map(device => <li key={device.id} className="flex items-center justify-between gap-3 rounded-xl border border-app-line/10 p-4">
      <div><p className="font-bold">{device.name}</p><p className="text-xs text-app-fg/50">{device.revoked_at ? 'Autorizácia zrušená' : device.device_role === 'scoreboard' ? 'Monitor skóre' : 'Tablet – kiosk'} · {device.court_id === null ? 'Bez priradeného kurtu (staršia autorizácia)' : courts.find(court => String(court.id) === String(device.court_id))?.name ?? `Kurt ${device.court_id}`}</p></div>
      {!device.revoked_at ? <button disabled={busy} onClick={() => void revoke(device.id)} className="rounded-lg border border-app-line/20 px-3 py-2 text-sm disabled:opacity-40">Zrušiť autorizáciu</button> : null}
    </li>)}</ul>
  </section>
}
