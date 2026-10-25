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
    || typeof input.deviceToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.deviceToken)) {
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
    const { data, error } = await admin.rpc('resume_paused_live_match', {
      p_pin: input.pin, p_device_token: input.deviceToken, p_client_key: clientKey,
    })
    if (error) throw error
    if (data?.error) return Response.json({ error: data.error }, { status: 400 })
    if (typeof data?.matchId !== 'string') throw new Error('Databáza nevrátila zápas.')
    return Response.json({ matchId: data.matchId }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Pokračovanie prerušeného zápasu zlyhalo:', error)
    return Response.json({ error: 'Zápas sa nepodarilo obnoviť. Over SQL migráciu 060 a skús znova.' }, { status: 500 })
  }
}
