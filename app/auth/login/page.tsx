'use client'

import Link from 'next/link'
import { RivaLogo } from '@/components/riva-logo'
import { FormEvent, Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getErrorMessage } from '@/lib/errors'
import { safeNextPath } from '@/lib/auth-redirect'
import { ResendVerificationButton } from '@/components/resend-verification-button'
import { useLanguage } from '@/components/language-provider'

const VERIFICATION_NOTICES: Record<string, { ok: boolean; text: string }> = {
  expired: { ok: false, text: 'Overovací odkaz už vypršal alebo bol použitý. Pošli si nový odkaz nižšie.' },
  failed: { ok: false, text: 'E-mail sa nepodarilo overiť. Skús odkaz otvoriť znova alebo si pošli nový.' },
  login: { ok: true, text: 'Ak si už klikol na odkaz v e-maile, tvoj účet je overený – prihlás sa.' },
  required: { ok: false, text: 'Pred vstupom do aplikácie musíš potvrdiť svoju e-mailovú adresu.' },
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const verification = searchParams.get('verification') ?? ''
  const notice = VERIFICATION_NOTICES[verification]
  const nextPath = safeNextPath(searchParams.get('next'))
  const [form, setForm] = useState({ email: searchParams.get('email') ?? '', password: '' })
  const [error, setError] = useState('')
  const [needsVerification, setNeedsVerification] = useState(verification === 'expired' || verification === 'failed' || verification === 'required')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    setError('')
    setNeedsVerification(false)
    setLoading(true)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ email: form.email.trim(), password: form.password }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        if (result.code === 'email_not_confirmed') setNeedsVerification(true)
        throw new Error(result.error || 'Prihlásenie sa nepodarilo uskutočniť.')
      }
      window.location.assign(nextPath)
    } catch (err: unknown) {
      const message = controller.signal.aborted ? 'Prihlásenie trvá príliš dlho. Skontroluj pripojenie a skús to znova.' : getErrorMessage(err, 'Prihlásenie sa nepodarilo uskutočniť.')
      console.error('Prihlásenie zlyhalo:', message)
      setError(message === 'Invalid login credentials' ? 'Nesprávny email alebo heslo.' : message)
    } finally {
      clearTimeout(timeout)
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-app-ink px-4 sm:px-6 py-8 text-app-fg flex flex-col items-center justify-center">
      <div className="w-full max-w-sm md:max-w-md bg-app-auth p-6 sm:p-8 rounded-2xl border border-app-line/10 shadow-xl">
        <div className="flex justify-center mb-6">
          <RivaLogo />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold mb-6 text-center">{t('PRIHLÁSENIE')}</h1>

        {notice && !error && (
          <div role="status" className={`p-3 rounded-lg mb-4 text-sm text-center border ${notice.ok ? 'bg-[#b5ef33]/10 border-[#b5ef33]/50 text-app-lime' : 'bg-amber-500/10 border-amber-500/60 text-app-amber-300'}`}>
            {t(notice.text)}
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg mb-4 text-sm text-center">
            {t(error)}
          </div>
        )}

        {needsVerification && <ResendVerificationButton email={form.email} className="mb-4" />}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm text-gray-400">{t('Email')}</label>
            <input
              type="email"
              name="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400"
              placeholder={t('vas@email.sk')}
            />
          </div>

          <div>
            <label className="text-sm text-gray-400">{t('Heslo')}</label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-[#b5ef33] hover:bg-[#a2db25] text-black font-semibold py-3 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {t(loading ? 'PRIHLASUJEM...' : 'PRIHLÁSIŤ SA')}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-6">
          {t('Nemáš účet?')}{' '}
          <Link href="/auth/sign-up" className="text-app-lime hover:underline">
            {t('Registrovať sa')}
          </Link>
        </p>
        <p className="mt-3 text-center text-sm">
          <Link href={`/auth/forgot-password?email=${encodeURIComponent(form.email.trim())}`} className="text-app-lime hover:underline">
            {t('Zabudli ste heslo?')}
          </Link>
        </p>
      </div>
    </main>
  )
}
