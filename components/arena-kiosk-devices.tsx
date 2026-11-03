'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'

type Device = { id: string; name: string; created_at: string; revoked_at: string | null }

export function ArenaKioskDevices({ arenaId }: { arenaId: string }) {
  const [devices, setDevices] = useState<Device[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const { data, error } = await createClient().from('arena_kiosk_devices')
        .select('id, name, created_at, revoked_at').eq('arena_id', arenaId)
        .order('created_at', { ascending: false })
      if (error) throw error
      setDevices(data ?? [])
    } catch (error) {
      console.error('Načítanie kioskových zariadení zlyhalo:', error)
      setError(getErrorMessage(error, 'Zariadenia sa nepodarilo načítať. Over migráciu 076.'))
    }
  }, [arenaId])
  useEffect(() => { void load() }, [load])

  async function authorize(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/kiosk-device', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arenaId, name }), signal: AbortSignal.timeout(20_000),
      })
      const result = await response.json()
      if (!response.ok || result.authorized !== true) throw new Error(result.error ?? 'Autorizácia zariadenia zlyhala.')
      window.location.assign('/match')
    } catch (error) {
      console.error('Zapnutie autorizovaného kiosku zlyhalo:', error)
      setError(getErrorMessage(error, 'Autorizácia zariadenia zlyhala.'))
    } finally { setBusy(false) }
  }

  async function revoke(id: string) {
    if (busy || !window.confirm('Zrušiť kiosk na tomto zariadení? Pri ďalšom otvorení stránky sa vráti do bežného režimu.')) return
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
    <h2 className="text-xl font-black">Kioskové zariadenia</h2>
    <p className="mt-2 text-sm text-app-fg/60">Otvor tento panel priamo na tablete v aplikácii, ktorú chceš používať ako kiosk. Autorizuje sa iba táto inštalácia, nie tvoj účet ani ostatné telefóny.</p>
    <form onSubmit={authorize} className="mt-5 flex flex-col gap-3 sm:flex-row">
      <label className="sr-only" htmlFor="kiosk-device-name">Názov zariadenia</label>
      <input id="kiosk-device-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required placeholder="Napríklad Tablet – Kurt 1" className="min-h-12 flex-1 rounded-xl border border-app-line/15 bg-app-ink px-4" />
      <button disabled={busy || !name.trim()} className="min-h-12 rounded-xl bg-app-highlight px-5 font-bold text-app-ink disabled:opacity-40">Autorizovať toto zariadenie ako kiosk</button>
    </form>
    <p className="mt-3 text-xs text-app-fg/45">Správu a zrušenie autorizácie potom vykonávaj z iného zariadenia. Autorizácia je uložená na rok; vymazanie údajov aplikácie ju odstráni.</p>
    {error ? <p role="alert" className="mt-4 text-sm text-app-red-200">{error}</p> : null}
    <ul className="mt-5 space-y-3">{devices.map(device => <li key={device.id} className="flex items-center justify-between gap-3 rounded-xl border border-app-line/10 p-4">
      <div><p className="font-bold">{device.name}</p><p className="text-xs text-app-fg/50">{device.revoked_at ? 'Autorizácia zrušená' : 'Autorizovaný kiosk'}</p></div>
      {!device.revoked_at ? <button disabled={busy} onClick={() => void revoke(device.id)} className="rounded-lg border border-app-line/20 px-3 py-2 text-sm disabled:opacity-40">Zrušiť autorizáciu</button> : null}
    </li>)}</ul>
  </section>
}
