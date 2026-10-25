import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED_PREFIXES = ['/profile']
const GUEST_ONLY_PATHS = ['/auth/login', '/auth/sign-up']
const KIOSK_COOKIE = 'riva-kiosk-mode'
const KIOSK_ALLOWED_PATHS = new Set(['/match', '/kiosk', '/how-it-works', '/live-matches', '/rankings', '/tournaments'])
const KIOSK_ALLOWED_API_PATHS = new Set(['/api/match-speech', '/api/pause-match', '/api/match-resume'])

function redirectKeepingCookies(url: URL, from: NextResponse) {
  const response = NextResponse.redirect(url)
  from.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function setKioskCookie(response: NextResponse, request: NextRequest) {
  const options = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: request.nextUrl.protocol === 'https:' }
  response.cookies.set(KIOSK_COOKIE, '1', options)
}

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl
  const startsKiosk = searchParams.get('mode') === 'kiosk' || pathname === '/kiosk'
  const exitsKiosk = pathname === '/match' && searchParams.get('mode') === 'normal'

  if (exitsKiosk) {
    request.cookies.delete(KIOSK_COOKIE)
    const response = NextResponse.next({ request })
    response.cookies.set(KIOSK_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:' })
    return response
  }

  const kioskActive = startsKiosk || request.cookies.get(KIOSK_COOKIE)?.value === '1'
  if (kioskActive) {
    if (startsKiosk) request.cookies.set(KIOSK_COOKIE, '1')

    if (pathname.startsWith('/api/') && !KIOSK_ALLOWED_API_PATHS.has(pathname)) {
      const response = NextResponse.json({ error: 'Táto akcia nie je v kioskovom režime dostupná.' }, { status: 403 })
      response.headers.set('Cache-Control', 'no-store')
      if (startsKiosk) setKioskCookie(response, request)
      return response
    }

    if (!pathname.startsWith('/api/') && !KIOSK_ALLOWED_PATHS.has(pathname)) {
      const response = NextResponse.redirect(new URL('/match?mode=kiosk', request.url))
      response.headers.set('Cache-Control', 'no-store')
      if (startsKiosk) setKioskCookie(response, request)
      return response
    }

    const response = NextResponse.next({ request })
    if (startsKiosk) setKioskCookie(response, request)
    return response
  }

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  const isGuestOnly = GUEST_ONLY_PATHS.includes(pathname)
  if (!isProtected && !isGuestOnly) return NextResponse.next({ request })

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
    return response
  }

  const search = request.nextUrl.search

  if (isProtected && !user) {
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('next', `${pathname}${search}`)
    return redirectKeepingCookies(url, response)
  }

  if (user && !user.email_confirmed_at && (isProtected || isGuestOnly)) {
    await supabase.auth.signOut({ scope: 'local' })
    if (!isProtected) return response
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('verification', 'required')
    if (user.email) url.searchParams.set('email', user.email)
    return redirectKeepingCookies(url, response)
  }

  if (user?.email_confirmed_at && isGuestOnly) {
    return redirectKeepingCookies(new URL('/profile', request.url), response)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
