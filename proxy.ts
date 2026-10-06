import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED_PREFIXES = ['/profile']
const GUEST_ONLY_PATHS = ['/auth/login', '/auth/sign-up']

function redirectKeepingCookies(url: URL, from: NextResponse) {
  const response = NextResponse.redirect(url)
  from.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  response.headers.set('Cache-Control', 'no-store')
  return response
}

// Refreshes the Supabase session cookie and blocks unauthenticated / unverified users
// from the app before any protected page is rendered.
export async function proxy(request: NextRequest) {
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

  const { pathname, search } = request.nextUrl
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

  if (isProtected && !user) {
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('next', `${pathname}${search}`)
    return redirectKeepingCookies(url, response)
  }

  if (user && !user.email_confirmed_at && (isProtected || GUEST_ONLY_PATHS.includes(pathname))) {
    await supabase.auth.signOut({ scope: 'local' })
    if (!isProtected) return response
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('verification', 'required')
    if (user.email) url.searchParams.set('email', user.email)
    return redirectKeepingCookies(url, response)
  }

  if (user?.email_confirmed_at && GUEST_ONLY_PATHS.includes(pathname)) {
    return redirectKeepingCookies(new URL('/profile', request.url), response)
  }

  return response
}

export const config = {
  matcher: ['/profile/:path*', '/auth/login', '/auth/sign-up'],
}
