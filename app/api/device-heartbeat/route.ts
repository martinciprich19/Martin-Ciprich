import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Nepovolený pôvod.' }, { status: 403 })
  const token = request.cookies.get('riva-kiosk-device')?.value
  if (!token) return NextResponse.json({ paired: false }, { headers: { 'Cache-Control': 'no-store' } })
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: 'Neplatné zariadenie.' }, { status: 401 })
  const source = request.headers.get('x-riva-source')
  const battery = request.headers.get('x-riva-battery')
  const charging = request.headers.get('x-riva-charging')
  const version = request.headers.get('x-riva-version')
  if (!['browser', 'android'].includes(source ?? '')
    || (battery !== null && (!/^\d{1,3}$/.test(battery) || Number(battery) > 100))
    || (charging !== null && !['true', 'false'].includes(charging))
    || (version !== null && !/^[A-Za-z0-9._+-]{1,40}$/.test(version))
    || (source === 'browser' && (battery !== null || charging !== null || version !== null))) {
    return NextResponse.json({ error: 'Neplatná telemetria.' }, { status: 400 })
  }
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    const { error } = await db.rpc('report_device_heartbeat', {
      p_token: token, p_source: source, p_battery: battery === null ? null : Number(battery),
      p_charging: charging === null ? null : charging === 'true', p_version: version,
    })
    if (error?.code === '42501') return NextResponse.json({ error: 'Zariadenie už nie je aktívne.' }, { status: 403 })
    if (error) throw error
    return NextResponse.json({ paired: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Device heartbeat failed:', error)
    return NextResponse.json({ error: 'Stav zariadenia sa nepodarilo odoslať. Over migráciu 084.' }, { status: 503 })
  }
}
