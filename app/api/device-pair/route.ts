import { createClient } from '@supabase/supabase-js'
import { randomBytes, createHmac } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Nepovolený pôvod požiadavky.' }, { status: 403 })
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    console.error('Device pairing requires SUPABASE_SERVICE_ROLE_KEY.')
    return NextResponse.json({ error: 'Párovanie nie je nakonfigurované na serveri.' }, { status: 503 })
  }
  try {
    const token = randomBytes(32).toString('hex')
    const code = randomBytes(4).toString('hex').toUpperCase()
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local'
    const clientKey = createHmac('sha256', key).update(ip).digest('hex')
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await admin.rpc('create_device_pairing_request', {
      p_token: token, p_code: code, p_client_key: clientKey,
    })
    if (error) {
      console.error('Device pairing creation failed:', { code: error.code, message: error.message })
      return NextResponse.json({ error: error.code === 'P0001' ? error.message : 'Párovanie zlyhalo. Over migráciu 081.' },
        { status: error.code === 'P0001' ? 429 : 503 })
    }
    if (typeof data !== 'string') throw new Error('Invalid pairing expiry.')
    const response = NextResponse.json({ code, expiresAt: data }, { headers: { 'Cache-Control': 'no-store' } })
    response.cookies.set('riva-pairing-token', token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', maxAge: 600,
    })
    return response
  } catch (error) {
    console.error('Device pairing failed:', error)
    return NextResponse.json({ error: 'Párovanie zariadenia sa nepodarilo.' }, { status: 503 })
  }
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get('riva-pairing-token')?.value
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: 'Párovací kód vypršal. Vytvor nový.' }, { status: 410 })
  }
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    const { data, error } = await db.rpc('get_paired_device_context', { p_token: token })
    if (error) throw error
    if (!Array.isArray(data) || data.length > 1) throw new Error('Invalid device context.')
    if (!data.length) return NextResponse.json({ paired: false }, { headers: { 'Cache-Control': 'no-store' } })
    const context = data[0]
    if (!Number.isSafeInteger(Number(context.court_id)) || Number(context.court_id) < 1
      || !['kiosk', 'scoreboard'].includes(context.device_role)) throw new Error('Invalid device assignment.')
    const destination = context.device_role === 'scoreboard'
      ? `/scoreboard/${context.court_id}` : `/match?mode=kiosk&courtId=${context.court_id}`
    const response = NextResponse.json({ paired: true, destination }, { headers: { 'Cache-Control': 'no-store' } })
    response.cookies.set('riva-kiosk-device', token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', maxAge: 31536000,
    })
    response.cookies.set('riva-pairing-token', '', { path: '/', maxAge: 0 })
    return response
  } catch (error) {
    console.error('Device pairing status failed:', error)
    return NextResponse.json({ error: 'Stav párovania sa nepodarilo overiť. Over migráciu 081.' }, { status: 503 })
  }
}
