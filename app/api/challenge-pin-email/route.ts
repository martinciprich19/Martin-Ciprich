import { createClient } from '@/lib/supabase/server'
import { dispatchChallengePinEmails } from '@/lib/challenge-pin-dispatch'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const url = new URL(request.url)
  if (request.headers.get('origin') !== `${url.protocol}//${request.headers.get('host') ?? url.host}`) {
    return Response.json({ error: 'Nepovolený pôvod požiadavky.' }, { status: 403 })
  }
  let input: unknown
  try { input = await request.json() } catch { return Response.json({ error: 'Neplatná požiadavka.' }, { status: 400 }) }
  if (!input || typeof input !== 'object' || !('challengeId' in input)
    || typeof input.challengeId !== 'string' || !/^[1-9]\d*$/.test(input.challengeId)) {
    return Response.json({ error: 'Neplatná výzva.' }, { status: 400 })
  }
  const client = await createClient()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Najprv sa prihlás.' }, { status: 401 })
  const { data, error } = await client.rpc('get_challenge_match_pin', { p_challenge_id: input.challengeId })
  if (error) {
    console.error('Overenie účastníka výzvy zlyhalo:', error)
    return Response.json({ error: 'Prístup k výzve sa nepodarilo overiť.' }, { status: 502 })
  }
  if (!Array.isArray(data) || data.length !== 1) return Response.json({ error: 'PIN výzvy nie je dostupný.' }, { status: 403 })
  try {
    return Response.json(await dispatchChallengePinEmails(input.challengeId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Odoslanie PIN-u výzvy zlyhalo:', error)
    return Response.json({ error: 'PIN je uložený, ale e-maily sa nepodarilo odoslať. Skús znova.' }, { status: 502 })
  }
}
