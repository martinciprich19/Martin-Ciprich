import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const url = new URL(request.url)
  const expectedOrigin = `${url.protocol}//${request.headers.get('host') ?? url.host}`
  if (request.headers.get('origin') !== expectedOrigin) {
    return Response.json({ error: 'Nepovolený pôvod požiadavky.' }, { status: 403 })
  }
  let input: unknown
  try { input = await request.json() } catch {
    return Response.json({ error: 'Neplatná požiadavka.' }, { status: 400 })
  }
  if (!input || typeof input !== 'object' || !('pin' in input) || !('deviceToken' in input)
    || typeof input.pin !== 'string' || !/^\d{4}$/.test(input.pin)
    || typeof input.deviceToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.deviceToken)
    || ('resolve' in input && typeof input.resolve !== 'boolean')) {
    return Response.json({ error: 'Zadaj platný 4-miestny PIN.' }, { status: 400 })
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    console.error('Pokračovanie zápasu: chýba SUPABASE_SERVICE_ROLE_KEY.')
    return Response.json({ error: 'Pokračovanie nie je nakonfigurované. Na serveri nastav SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 })
  }
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local'
    const clientKey = createHmac('sha256', key).update(ip).digest('hex')
    const resolve = 'resolve' in input && input.resolve === true
    const { data, error } = await admin.rpc(resolve ? 'resolve_kiosk_pin' : 'resume_paused_live_match', {
      p_pin: input.pin, p_device_token: input.deviceToken, p_client_key: clientKey,
    })
    if (error) throw error
    if (data?.error) return Response.json({ error: data.error }, { status: 400 })
    if (resolve && data?.kind === 'new') {
      return Response.json({ kind: 'new' }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (typeof data?.matchId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.matchId)
      || (resolve && data.kind !== 'resume')) throw new Error('Databáza nevrátila platný zápas.')
    return Response.json({ matchId: data.matchId, ...(resolve ? { kind: 'resume' } : {}) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Pokračovanie prerušeného zápasu zlyhalo:', error)
    return Response.json({ error: 'PIN sa nepodarilo overiť. Over SQL migrácie 060, 062 a 075 a skús znova.' }, { status: 500 })
  }
}
