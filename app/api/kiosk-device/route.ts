import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Nepovolený pôvod požiadavky.' }, { status: 403 })
  }
  let input: unknown
  try { input = await request.json() } catch {
    return NextResponse.json({ error: 'Neplatná požiadavka.' }, { status: 400 })
  }
  if (!input || typeof input !== 'object' || !('arenaId' in input) || !('name' in input)
    || typeof input.arenaId !== 'string' || !/^[1-9]\d*$/.test(input.arenaId)
    || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) {
    return NextResponse.json({ error: 'Vyplň arénu a názov zariadenia.' }, { status: 400 })
  }
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError && authError.name !== 'AuthSessionMissingError') throw authError
    if (!user) return NextResponse.json({ error: 'Prihlás sa ako správca arény.' }, { status: 401 })
    const { data: allowed, error: accessError } = await supabase.rpc('is_arena_admin', { p_arena_id: input.arenaId })
    if (accessError) throw accessError
    if (!allowed) return NextResponse.json({ error: 'Nemáš oprávnenie pre túto arénu.' }, { status: 403 })
    const token = randomBytes(32).toString('hex')
    const { data: deviceId, error } = await supabase.rpc('authorize_kiosk_device', {
      p_arena_id: input.arenaId, p_name: input.name.trim(), p_token: token,
    })
    if (error) throw error
    if (typeof deviceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
      throw new Error('Databáza nevrátila platné zariadenie.')
    }
    const response = NextResponse.json({ authorized: true }, { headers: { 'Cache-Control': 'no-store' } })
    const options = { path: '/', httpOnly: true, secure: new URL(request.url).protocol === 'https:',
      sameSite: 'lax' as const, maxAge: 60 * 60 * 24 * 365 }
    response.cookies.set('riva-kiosk-device', token, options)
    response.cookies.set('riva-kiosk-mode', '1', options)
    return response
  } catch (error) {
    console.error('Autorizácia kioskového zariadenia zlyhala:', error)
    return NextResponse.json({ error: 'Zariadenie sa nepodarilo autorizovať. Over migráciu 076.' }, { status: 500 })
  }
}
