import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deliverPush, getAdminMessaging, createPushAdminClient } from '@/lib/firebase-admin'
import { createPrivateKey } from 'node:crypto'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const url = new URL(request.url)
  if (!origin || origin !== `${url.protocol}//${request.headers.get('host') ?? url.host}`) {
    return NextResponse.json({ error: 'Neplatný pôvod požiadavky.' }, { status: 403 })
  }
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Najprv sa prihlás.' }, { status: 401 })
    const requiredVariables = [
      'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
      'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    ] as const
    const missingVariables = requiredVariables.filter((name) => !process.env[name]?.trim())
    if (missingVariables.length) {
      console.error('Push test configuration missing:', missingVariables)
      return NextResponse.json({
        error: `Push sa nedá odoslať. Chýbajú serverové premenné: ${missingVariables.join(', ')}. Doplň ich do .env.local alebo nastavení nasadenia a reštartuj server. SQL migrácia tieto hodnoty nenahrádza.`,
        code: 'PUSH_CONFIG_MISSING',
        missingVariables,
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    try {
      const key = createPrivateKey((process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'))
      if (key.asymmetricKeyType !== 'rsa') throw new Error('Expected RSA private key')
    } catch {
      console.error('Push test configuration invalid: FIREBASE_PRIVATE_KEY is not a valid RSA PEM key.')
      return NextResponse.json({
        error: 'FIREBASE_PRIVATE_KEY nie je platný súkromný RSA kľúč. V nastaveniach servera vlož kompletnú hodnotu private_key zo service-account JSON vrátane BEGIN/END PRIVATE KEY. Nevkladaj celý JSON ani vonkajšie úvodzovky. Po oprave znovu nasaď aplikáciu.',
        code: 'PUSH_PRIVATE_KEY_INVALID',
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    getAdminMessaging()
    createPushAdminClient()
    const { data, error } = await supabase.rpc('reserve_push_test')
    if (error) {
      if (error.code === 'P0001') return NextResponse.json({ error: error.message }, { status: 429 })
      if (['PGRST202', '42883', '42P01', '42703'].includes(error.code)) {
        console.error('Push test database schema error:', error)
        return NextResponse.json({
          error: 'Chýba databázová funkcia alebo tabuľka pre push. Spusti celú SQL migráciu 049, nielen vytvorenie user_push_tokens.',
          code: 'PUSH_SCHEMA_MISSING',
        }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
      }
      throw error
    }
    if (!Array.isArray(data) || !data.every((token): token is string => typeof token === 'string')) {
      throw new Error('Unexpected push token response.')
    }
    if (!data.length) return NextResponse.json({ error: 'Najprv zapni notifikácie na tomto zariadení.' }, { status: 409 })
    const result = await deliverPush(data, {
      title: 'RIVA Padel – test notifikácií',
      body: 'Push notifikácie fungujú. Toto je testovacie upozornenie.',
      id: `test-${crypto.randomUUID()}`,
    })
    if (result.failed) return NextResponse.json({ ...result, error: `Test sa nepodarilo doručiť na ${result.failed} zariadení; odoslaný na ${result.sent}. Skús obnoviť registráciu.` }, { status: 502 })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Push test failed:', error)
    return NextResponse.json({ error: 'Odoslanie zlyhalo. Správca musí skontrolovať Firebase konfiguráciu a SQL migráciu 049.' }, { status: 503 })
  }
}
