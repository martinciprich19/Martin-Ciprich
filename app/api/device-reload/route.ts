import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' }
  const origin = request.headers.get('origin')
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Nepovolený pôvod.' }, { status: 403, headers })
  const token = request.cookies.get('riva-kiosk-device')?.value
  if (!token) return NextResponse.json({ paired: false }, { headers })
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: 'Neplatné zariadenie.' }, { status: 401, headers })
  const ack = request.headers.get('x-riva-reload-ack')
  if (ack !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ack)) return NextResponse.json({ error: 'Neplatný príkaz.' }, { status: 400, headers })
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    const { data, error } = await db.rpc('poll_device_reload', { p_token: token, p_ack: ack })
    if (error?.code === '42501') return NextResponse.json({ error: 'Zariadenie už nie je aktívne.' }, { status: 403, headers })
    if (error?.code === '22023') return NextResponse.json({ error: 'Potvrdenie nezodpovedá doručenému príkazu zariadenia.' }, { status: 409, headers })
    if (error) throw error
    return NextResponse.json({ paired: true, command: data }, { headers })
  } catch (error) {
    console.error('Device reload poll failed:', error)
    return NextResponse.json({ error: 'Obnovenie zariadenia zlyhalo. Over migráciu 088.' }, { status: 503, headers })
  }
}
