'use client'

import useSWR from 'swr'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { deviceConnectionState, type DeviceTelemetry } from '@/lib/device-telemetry'

async function loadTelemetry(): Promise<DeviceTelemetry[]> {
  const { data, error } = await createClient().from('arena_kiosk_devices')
    .select('id,last_seen_at,battery_percent,is_charging,app_version,telemetry_source')
  if (error) {
    console.error('Device telemetry load failed:', error)
    throw error
  }
  return data ?? []
}

export function DeviceTelemetryStatus({ deviceId, revoked }: { deviceId: string; revoked: boolean }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])
  const { data, error, isValidating } = useSWR('device-telemetry', loadTelemetry, { refreshInterval: 15000 })
  if (revoked) return null
  if (error) return <p role="alert" className="mt-2 text-xs text-amber-300">Stav zariadenia nie je dostupný. Over pripojenie a migráciu 084.</p>
  const row = data?.find(device => device.id === deviceId)
  const state = deviceConnectionState(row?.last_seen_at ?? null, now)
  return <div className="mt-2 space-y-1 text-xs">
    <p className={state === 'online' ? 'text-emerald-300' : state === 'offline' ? 'text-red-300' : 'text-app-fg/50'}>
      <span aria-hidden="true">● </span>{!data && isValidating ? 'Načítavam stav…' : state === 'online' ? 'Online' : state === 'offline' ? 'Bez spojenia' : 'Zatiaľ bez signálu'}
    </p>
    {row?.last_seen_at ? <p className="text-app-fg/50">Posledný signál: <time dateTime={row.last_seen_at}>{new Date(row.last_seen_at).toLocaleString('sk-SK')}</time></p> : null}
    <p className="text-app-fg/60">Batéria: {row?.battery_percent === null || row?.battery_percent === undefined ? 'nedostupná' : `${row.battery_percent} %`}{row?.is_charging === true ? ' · nabíja sa' : row?.is_charging === false ? ' · nenabíja sa' : ''} · APK: {row?.app_version ?? 'nedostupná'}</p>
    {row?.telemetry_source === 'browser' ? <p className="text-app-fg/45">Webový prehliadač neposkytuje stav batérie ani verziu APK.</p> : null}
  </div>
}
