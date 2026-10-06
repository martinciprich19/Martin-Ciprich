import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/auth-redirect'

const EMAIL_OTP_TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

function loginRedirect(request: Request, verification: 'expired' | 'failed' | 'login', email?: string | null) {
  const url = new URL('/auth/login', request.url)
  url.searchParams.set('verification', verification)
  if (email) url.searchParams.set('email', email)
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store' } })
}

// Target of the links in Supabase e-mails (sign-up confirmation, magic link, password recovery).
// Supports both the default PKCE link (?code=…) and the token-hash template (?token_hash=…&type=…).
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const errorCode = url.searchParams.get('error_code')
  const errorDescription = url.searchParams.get('error_description')

  if (errorCode || url.searchParams.get('error')) {
    console.error('Overenie e-mailu zlyhalo:', errorCode, errorDescription)
    return loginRedirect(request, errorCode === 'otp_expired' ? 'expired' : 'failed')
  }

  const supabase = await createClient()
  let verifiedType: EmailOtpType | null = null

  if (tokenHash && type && EMAIL_OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (error) {
      console.error('Overenie e-mailového tokenu zlyhalo:', error.code, error.message)
      return loginRedirect(request, error.code === 'otp_expired' ? 'expired' : 'failed')
    }
    verifiedType = type
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      // Typically the link was opened in a different browser than the sign-up (no PKCE verifier).
      // Supabase has already confirmed the e-mail at this point, so the user can simply log in.
      console.error('Výmena overovacieho kódu zlyhala:', error.code, error.message)
      return loginRedirect(request, 'login')
    }
  } else {
    return loginRedirect(request, 'failed')
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return loginRedirect(request, 'failed')
  if (!user.email_confirmed_at) {
    await supabase.auth.signOut()
    return loginRedirect(request, 'failed', user.email)
  }

  const fallback = verifiedType === 'recovery' ? '/auth/update-password' : '/profile'
  const destination = new URL(safeNextPath(url.searchParams.get('next'), fallback), request.url)
  if (verifiedType !== 'recovery' && destination.pathname === '/profile') destination.searchParams.set('verified', '1')
  return NextResponse.redirect(destination, { headers: { 'Cache-Control': 'no-store' } })
}
