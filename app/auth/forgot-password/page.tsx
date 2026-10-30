'use client'

import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { RivaLogo } from '@/components/riva-logo'
import { FormEvent, Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getErrorMessage } from '@/lib/errors'
import { emailRedirectUrl } from '@/lib/auth-redirect'
import { useLanguage } from '@/components/language-provider'

export default function ForgotPasswordPage() {
  return <Suspense fallback={null}><ForgotPasswordForm /></Suspense>
}

function ForgotPasswordForm() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setMessage('')
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: emailRedirectUrl(window.location.origin, '/auth/update-password'),
      })
      if (error) throw error
      setSent(true)
    } catch (error: unknown) {
      console.error('Odoslanie odkazu na obnovu hesla zlyhalo:', getErrorMessage(error, 'Neznáma chyba.'))
      setMessage('Odoslanie odkazu sa nepodarilo. Skús to znova neskôr.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-app-ink px-6 py-8 text-app-fg">
      <div className="mx-auto max-w-[420px]">
        <Link href="/" aria-label="RIVA Padel"><RivaLogo /></Link>
        <div className="mt-24 rounded-2xl border border-app-line/10 bg-app-court p-7">
          <p className="text-[10px] font-bold uppercase tracking-[.25em] text-app-accent">RIVA Padel</p>
          <h1 className="mt-3 text-3xl font-black uppercase">{t('Obnova hesla')}</h1>
          {sent ? (
            <div role="status" className="mt-5 space-y-3 text-sm text-app-fg/60">
              <p>{t('Ak účet s týmto e-mailom existuje, poslali sme ti odkaz na obnovu hesla. Skontroluj aj priečinok Spam.')}</p>
              <p>{t('Po otvorení odkazu si nastavíš nové heslo. Neskôr si ho môžeš zmeniť v nastaveniach aplikácie v časti „Zabezpečenie & účet“.')}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-7 space-y-4">
              <p className="text-sm leading-6 text-app-fg/60">{t('Zadaj rovnaký e-mail, ktorý si použil pri registrácii a prihlasovaní. Pošleme ti odkaz na nastavenie nového hesla.')}</p>
              <label className="block text-xs font-semibold text-app-fg/70">
                {t('Email')}
                <input required type="email" name="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" disabled={loading} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-lg border border-app-line/10 bg-app-ink px-3 py-3 text-sm outline-none focus:border-[#a8e63c]" />
              </label>
              {message && <p role="alert" className="text-xs text-app-red-300">{t(message)}</p>}
              <button disabled={loading} className="w-full rounded-lg bg-[#a8e63c] py-3.5 text-xs font-black text-[#061016] disabled:opacity-50">{t(loading ? 'ODOSIELAM...' : 'POSLAŤ ODKAZ')}</button>
            </form>
          )}
          <Link href="/auth/login" className="mt-6 block text-center text-xs font-semibold text-app-accent">{t('Späť na Prihlásenie')}</Link>
        </div>
      </div>
    </main>
  )
}
