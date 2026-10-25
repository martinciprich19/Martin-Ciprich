import { createClient } from '@supabase/supabase-js'
import { setTimeout as delay } from 'node:timers/promises'
import { sendPauseEmail } from '@/lib/match-pause-email'

export const runtime = 'nodejs'
export const maxDuration = 60

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
  if (!input || typeof input !== 'object' || !('pauseId' in input) || !('dispatchToken' in input)
    || typeof input.pauseId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.pauseId)
    || typeof input.dispatchToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.dispatchToken)
    || !('matchId' in input) || typeof input.matchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.matchId)
    || !('pinCode' in input) || typeof input.pinCode !== 'string' || !/^\d{4}$/.test(input.pinCode)
    || ('playersEmails' in input && (!Array.isArray(input.playersEmails)
      || input.playersEmails.length > 4 || input.playersEmails.some(email => typeof email !== 'string')))) {
    return Response.json({ error: 'Neplatné údaje prerušenia.' }, { status: 400 })
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.MATCH_EMAIL_FROM
  if (!key || !apiKey || !from) {
    console.error('E-maily prerušeného zápasu: chýba konfigurácia servera.')
    return Response.json({ error: 'Zápas je uložený, ale e-maily neboli odoslané. Na serveri nastav SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY a MATCH_EMAIL_FROM.' }, { status: 503 })
  }
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await admin.rpc('pending_match_pause_emails', {
      p_pause_id: input.pauseId, p_dispatch_token: input.dispatchToken,
      p_match_id: input.matchId, p_pin: input.pinCode,
    })
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Databáza nevrátila zoznam e-mailov.')
    if ('playersEmails' in input && Array.isArray(input.playersEmails) && input.playersEmails.length) {
      const allowed = new Set(data.map(job => job.recipient.toLowerCase()))
      if (input.playersEmails.some(email => !allowed.has(email.toLowerCase().trim()))) {
        return Response.json({ error: 'Príjemcovia nezodpovedajú účastníkom zápasu.' }, { status: 400 })
      }
    }
    let failed = 0
    for (const [index, job] of data.entries()) {
      if (!job || typeof job.email_id !== 'string' || typeof job.recipient !== 'string'
        || typeof job.pin !== 'string' || !/^\d{4}$/.test(job.pin)) {
        throw new Error('Databáza vrátila neplatné údaje e-mailu.')
      }
      try {
        // Space submissions to avoid per-second provider rate limits.
        if (index > 0) await delay(600)
        await sendPauseEmail(job, apiKey, from)
        const { error: markError } = await admin.rpc('mark_match_pause_email_sent', { p_email_id: job.email_id })
        if (markError) throw markError
      } catch (sendError) {
        failed++
        console.error('Odoslanie PIN-u prerušeného zápasu zlyhalo:', sendError)
      }
    }
    if (failed) return Response.json({ error: `${failed} e-mailov sa nepodarilo odoslať. Zápas aj PIN sú uložené. Skús odoslanie znova.` }, { status: 502 })
    return Response.json({ sent: data.length }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Načítanie e-mailov prerušeného zápasu zlyhalo:', error)
    return Response.json({ error: 'Zápas je uložený, ale e-maily sa nepodarilo odoslať. Skús odoslanie znova.' }, { status: 502 })
  }
}
