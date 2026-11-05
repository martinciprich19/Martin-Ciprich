export type DeviceTelemetry = {
  id: string
  last_seen_at: string | null
  battery_percent: number | null
  is_charging: boolean | null
  app_version: string | null
  telemetry_source: 'android' | 'browser' | null
}

export function deviceConnectionState(lastSeen: string | null, now: number): 'unknown' | 'online' | 'offline' {
  if (!lastSeen || !Number.isFinite(Date.parse(lastSeen))) return 'unknown'
  return now - Date.parse(lastSeen) <= 90000 ? 'online' : 'offline'
}
