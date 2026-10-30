'use client'

import { FormEvent, Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { RivaLogo } from '@/components/riva-logo'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'
import { emailRedirectUrl } from '@/lib/auth-redirect'
import { useLanguage } from '@/components/language-provider'

const RESEND_COOLDOWN_SECONDS = 60

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  )
}

function VerifyForm() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [email, setEmail] = useState(searchParams.get('email')?.trim() ?? '')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [resendMessage, setResendMessage] = useState<{ type: 'success' | 'error'; text: string; email?: string } | null>(null)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return

    if (!/^\d{6}$/.test(token)) {
      setError('Zadaj celý 6-miestny overovací kód.')
      return
    }

    setError('')
    setLoading(true)

    try {
      const { data, error: verifyError } = await createClient().auth.verifyOtp({
        email: email.trim(),
        token,
        type: 'signup',
      })

      if (verifyError) throw verifyError
      if (!data.session) throw new Error('Overenie sa dokončilo, ale nepodarilo sa vytvoriť reláciu. Prihlás sa.')

      router.replace('/profile')
      router.refresh()
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Kód sa nepodarilo overiť. Skontroluj ho a skús to znova.')
      console.error('Overenie e-mailového kódu zlyhalo:', message)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleResendCode() {
    const address = email.trim()
    if (countdown > 0 || resending) return
    if (!address) {
      setResendMessage({ type: 'error', text: 'Zadaj e-mail, na ktorý máme poslať nový overovací kód.' })
      return
    }

    setResending(true)
    setResendMessage(null)

    try {
      const { error: resendError } = await createClient().auth.resend({
        type: 'signup',
        email: address,
        options: { emailRedirectTo: emailRedirectUrl(window.location.origin) },
      })
      if (resendError) throw resendError

      setResendMessage({ type: 'success', text: 'Nový overovací kód bol odoslaný na {email}.', email: address })
      setCountdown(RESEND_COOLDOWN_SECONDS)
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Nový overovací kód sa nepodarilo odoslať.')
      console.error('Opätovné odoslanie overovacieho kódu zlyhalo:', message)
      setResendMessage({ type: 'error', text: message })
    } finally {
      setResending(false)
    }
  }

  return (
    <main className="min-h-screen bg-app-ink px-4 py-8 text-app-fg flex flex-col items-center justify-center sm:px-6">
      <div className="w-full max-w-sm rounded-2xl border border-app-line/10 bg-app-auth p-6 shadow-xl sm:p-8">
        <div className="mb-6 flex justify-center">
          <RivaLogo />
        </div>
        <h1 className="mb-3 text-center text-xl font-bold sm:text-2xl">{t('OVERENIE ÚČTU')}</h1>
        <p className="mb-6 text-center text-sm leading-6 text-app-fg/60">
          {t('Zadaj e-mail a číselný kód z overovacej správy.')}
        </p>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-500 bg-red-500/10 p-3 text-center text-sm text-app-red-400">
            {t(error)}
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label htmlFor="verify-email" className="text-sm text-gray-400">{t('E-mail')}</label>
            <input
              id="verify-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:border-green-400 focus:outline-none"
              placeholder={t('vas@email.sk')}
            />
          </div>

          <div>
            <label htmlFor="verify-token" className="text-sm text-gray-400">{t('Overovací kód')}</label>
            <input
              id="verify-token"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              minLength={6}
              maxLength={6}
              pattern="[0-9]{6}"
              value={token}
              onChange={(event) => setToken(event.target.value.replace(/\D/g, ''))}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-4 text-center text-3xl font-bold tracking-[.6em] text-app-fg focus:border-green-400 focus:outline-none"
              placeholder="000000"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#b5ef33] py-3 text-sm font-semibold text-black transition-colors hover:bg-[#a2db25] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(loading ? 'OVERUJEM…' : 'OVERIŤ KÓD')}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          <button
            type="button"
            onClick={handleResendCode}
            disabled={resending || countdown > 0}
            className="text-xs text-gray-400 transition-colors hover:text-app-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {resending
              ? t('ODOSIELAM…')
              : countdown > 0
                ? t('Odoslať kód znova za ({seconds}s)').replace('{seconds}', String(countdown))
                : t('Nedorazil kód? Odoslať znova')}
          </button>
          {resendMessage && (
            <span
              role={resendMessage.type === 'error' ? 'alert' : 'status'}
              className={`mt-2 block text-xs ${resendMessage.type === 'success' ? 'text-app-lime' : 'text-app-red-400'}`}
            >
              {t(resendMessage.text).replace('{email}', resendMessage.email ?? '')}
            </span>
          )}
        </p>

        <p className="mt-4 text-center text-sm text-gray-400">
          <Link href="/auth/login" className="text-app-lime hover:underline">{t('Späť na prihlásenie')}</Link>
        </p>
      </div>
    </main>
  )
}
