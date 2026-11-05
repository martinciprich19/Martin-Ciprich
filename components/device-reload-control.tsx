'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'

type Command = { id: string; requested_at: string; delivered_at: string | null; acknowledged_at: string | null; expires_at: string }

export function DeviceReloadControl({ deviceId }: { deviceId: string }) {
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000)
    return () => window.clearInterval(timer)
  }, [])
  const { data, error, mutate } = useSWR(['device-reload', deviceId], async (): Promise<Command | null> => {
    const { data, error } = await createClient().from('device_reload_commands')
      .select('id,requested_at,delivered_at,acknowledged_at,expires_at').eq('device_id', deviceId).order('requested_at', { ascending: false }).limit(1)
    if (error) { console.error('Device reload status failed:', error); throw new Error('Stav obnovenia sa nepodarilo načítať. Over migráciu 088.') }
    return data?.[0] ?? null
  }, { refreshInterval: 10000 })
  async function reload() {
    if (busy || !window.confirm('Obnoviť aplikáciu na tomto zariadení? Nie je to reštart celého zariadenia. Počas zápasu je akcia blokovaná.')) return
    setBusy(true); setErrorText('')
    try {
      const { error } = await createClient().rpc('super_admin_request_device_reload', { p_device_id: deviceId })
      if (error) throw error
      await mutate()
    } catch (failure) {
      console.error('Requesting device reload failed:', failure)
      setErrorText(failure && typeof failure === 'object' && 'message' in failure ? String(failure.message) : 'Obnovenie sa nepodarilo vyžiadať.')
    } finally { setBusy(false) }
  }
  return <div className="space-y-2">
    <button disabled={busy || Boolean(error)} onClick={() => void reload()} className="rounded border border-app-line/20 px-3 py-2 text-xs font-bold disabled:opacity-40">Obnoviť aplikáciu</button>
    {data && !error ? <p className="max-w-xs text-xs text-app-fg/60">{data.acknowledged_at ? 'Obrazovka po obnovení potvrdila spojenie' : Date.parse(data.expires_at) <= now ? 'Príkaz vypršal bez potvrdenia' : data.delivered_at ? 'Doručené, čakám na spojenie po obnovení' : 'Čakám na zariadenie (najviac 5 minút)'} · {new Date(data.requested_at).toLocaleString('sk-SK')}</p> : null}
    {error || errorText ? <p role="alert" className="max-w-xs text-xs text-red-300">{errorText || error.message}</p> : null}
  </div>
}
