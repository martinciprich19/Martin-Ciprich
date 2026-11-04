import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createDatabaseClient } from '@supabase/supabase-js'

const PROTECTED_PREFIXES = ['/profile']
const GUEST_ONLY_PATHS = ['/auth/login', '/auth/sign-up']
const KIOSK_COOKIE = 'riva-kiosk-mode'
const KIOSK_ALLOWED_PATHS = new Set(['/match', '/kiosk'])
const KIOSK_ALLOWED_API_PATHS = new Set(['/api/match-speech', '/api/pause-match', '/api/match-resume'])

function redirectKeepingCookies(url: URL, from: NextResponse) {
  const response = NextResponse.redirect(url)
  from.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get('riva-kiosk-device')?.value
  let kioskActive = false
  let kioskCourtId: string | null = null
  let kioskAvailable = true
  let deviceRole = 'kiosk'
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    try {
      const database = createDatabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
        (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
        })
      const { data, error } = await database.rpc('get_paired_device_context', { p_token: token })
      if (error) throw error
      if (!Array.isArray(data) || data.length > 1) throw new Error('Neplatná odpoveď autorizácie kiosku.')
      if (data.length) {
        const context = data[0]
        if (!['kiosk', 'scoreboard'].includes(context.device_role) || typeof context.available !== 'boolean'
          || (context.court_id !== null && (!/^[1-9]\d*$/.test(String(context.court_id))
            || !Number.isSafeInteger(Number(context.court_id))))) {
          throw new Error('Neplatné priradenie kurtu.')
        }
        kioskActive = true
        kioskAvailable = context.available
        kioskCourtId = context.court_id === null ? null : String(context.court_id)
        deviceRole = context.device_role
      }
    } catch (error) {
      console.error('Overenie kioskového zariadenia zlyhalo:', error)
      return NextResponse.json({ error: 'Autorizáciu zariadenia sa nepodarilo overiť. Skús znova.' }, { status: 503 })
    }
  }

  const hadLegacyCookie = request.cookies.has(KIOSK_COOKIE)
  if (kioskActive) request.cookies.set(KIOSK_COOKIE, '1')
  else request.cookies.delete(KIOSK_COOKIE)
  const finish = (response: NextResponse) => {
    const options = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: request.nextUrl.protocol === 'https:' }
    if (kioskActive) response.cookies.set(KIOSK_COOKIE, '1', options)
    else {
      if (hadLegacyCookie) response.cookies.set(KIOSK_COOKIE, '', { ...options, maxAge: 0 })
      if (token) response.cookies.set('riva-kiosk-device', '', { ...options, maxAge: 0 })
    }
    return response
  }
  if (kioskActive) {
    if (!kioskAvailable) {
      const message = 'Aréna alebo kurt sú pozastavené. Kontaktuj správcu. Po aktivácii obnov stránku.'
      console.warn('Kiosk blocked because its arena or court is inactive.')
      const response = pathname.startsWith('/api/')
        ? NextResponse.json({ error: message }, { status: 403 })
        : new NextResponse(`<!doctype html><html lang="sk"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kiosk pozastavený</title><body style="background:#080d10;color:white;font-family:system-ui;padding:40px"><h1>Kiosk pozastavený</h1><p>${message}</p><a style="color:#ccff00" href="/kiosk">Obnoviť kiosk</a></body></html>`, {
          status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      response.headers.set('Cache-Control', 'no-store')
      return finish(response)
    }
    if (deviceRole === 'scoreboard') {
      if (!kioskCourtId) throw new Error('Monitor nemá priradený kurt.')
      const destination = `/scoreboard/${kioskCourtId}`
      if (pathname !== destination) {
        if (pathname.startsWith('/api/')) return finish(NextResponse.json({ error: 'Monitor je iba na čítanie skóre.' }, { status: 403 }))
        return finish(redirectKeepingCookies(new URL(destination, request.url), NextResponse.next({ request })))
      }
      return finish(NextResponse.next({ request }))
    }
    if (pathname.startsWith('/api/') && !KIOSK_ALLOWED_API_PATHS.has(pathname)) {
      const response = NextResponse.json({ error: 'Táto akcia nie je v kioskovom režime dostupná.' }, { status: 403 })
      response.headers.set('Cache-Control', 'no-store')
      return finish(response)
    }

    const home = kioskCourtId ? `/match?mode=kiosk&courtId=${kioskCourtId}` : '/match?mode=kiosk'
    if (!pathname.startsWith('/api/') && !KIOSK_ALLOWED_PATHS.has(pathname)) {
      const response = NextResponse.redirect(new URL(home, request.url))
      response.headers.set('Cache-Control', 'no-store')
      return finish(response)
    }

    if (kioskCourtId && (pathname === '/match' || pathname === '/kiosk')
      && (request.nextUrl.searchParams.get('courtId') !== kioskCourtId
        || (pathname === '/match' && (request.nextUrl.searchParams.get('mode') !== 'kiosk'
          || request.nextUrl.searchParams.has('view'))))) {
      const url = new URL(request.url)
      url.searchParams.set('courtId', kioskCourtId)
      if (pathname === '/match') {
        url.searchParams.set('mode', 'kiosk')
        url.searchParams.delete('view')
      }
      return finish(redirectKeepingCookies(url, NextResponse.next({ request })))
    }

    const response = NextResponse.next({ request })
    return finish(response)
  }

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  const isGuestOnly = GUEST_ONLY_PATHS.includes(pathname)
  if (!isProtected && !isGuestOnly) return finish(NextResponse.next({ request }))

  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null
  try {
    user = (await supabase.auth.getUser()).data.user
  } catch (error) {
    // Auth outage: let the page decide instead of locking everyone out.
    console.error('Proxy: overenie používateľa zlyhalo', error)
    return finish(response)
  }

  const search = request.nextUrl.search

  if (isProtected && !user) {
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('next', `${pathname}${search}`)
    return finish(redirectKeepingCookies(url, response))
  }

  if (user && !user.email_confirmed_at && (isProtected || isGuestOnly)) {
    await supabase.auth.signOut({ scope: 'local' })
    if (!isProtected) return finish(response)
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('verification', 'required')
    if (user.email) url.searchParams.set('email', user.email)
    return finish(redirectKeepingCookies(url, response))
  }

  if (user?.email_confirmed_at && isGuestOnly) {
    return finish(redirectKeepingCookies(new URL('/profile', request.url), response))
  }

  return finish(response)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
