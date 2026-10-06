import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Neplatný pôvod prihlasovacej požiadavky.' }, { status: 403 })
  }

  let credentials: unknown
  try {
    credentials = await request.json()
  } catch {
    return NextResponse.json({ error: 'Neplatná prihlasovacia požiadavka.' }, { status: 400 })
  }
  if (!credentials || typeof credentials !== 'object'
    || !('email' in credentials) || typeof credentials.email !== 'string'
    || !('password' in credentials) || typeof credentials.password !== 'string'
    || !credentials.email.trim() || !credentials.password) {
    return NextResponse.json({ error: 'Vyplň e-mail a heslo.' }, { status: 400 })
  }

  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const supabase = await createClient(controller.signal)
    const response = await Promise.race([
      supabase.auth.signInWithPassword({ email: credentials.email.trim(), password: credentials.password }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('LOGIN_TIMEOUT'))
        }, 20000)
      }),
    ])
    if (response.error || !response.data.session) {
      const notConfirmed = response.error?.code === 'email_not_confirmed'
      const message = notConfirmed
        ? 'Najprv potvrď svoju e-mailovú adresu – klikni na odkaz, ktorý sme ti poslali e-mailom.'
        : 'Nesprávny e-mail alebo heslo, prípadne účet ešte nie je potvrdený.'
      return NextResponse.json({ error: message, code: notConfirmed ? 'email_not_confirmed' : 'invalid_credentials' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    }
    if (!response.data.user?.email_confirmed_at) {
      await supabase.auth.signOut({ scope: 'local' })
      return NextResponse.json({ error: 'Najprv potvrď svoju e-mailovú adresu – klikni na odkaz, ktorý sme ti poslali e-mailom.', code: 'email_not_confirmed' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Prihlásenie sa nepodarilo dokončiť. Skontroluj pripojenie a skús to znova.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}