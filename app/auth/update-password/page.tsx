'use client'

import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { RivaLogo } from '@/components/riva-logo'
import { FormEvent, Suspense, useEffect, useState } from 'react'
import { useLanguage } from '@/components/language-provider'

export default function UpdatePasswordPage() {
  return <Suspense fallback={null}><UpdatePasswordForm /></Suspense>
}

function UpdatePasswordForm() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const recoveryError = searchParams.get('recovery')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let active = true
    async function checkSession() {
      try {
        if (recoveryError) {
          throw new Error(recoveryError === 'expired'
            ? 'Odkaz na obnovu hesla už vypršal alebo bol použitý. Vyžiadaj si nový odkaz.'
            : 'Odkaz na obnovu hesla sa nepodarilo overiť. Vyžiadaj si nový odkaz a otvor ho v rovnakom prehliadači, v ktorom si oň požiadal.')
        }
        const { data: { user }, error } = await createClient().auth.getUser()
        if (error || !user) throw new Error('Najprv otvor platný odkaz na obnovu hesla zo svojho e-mailu.')
        if (active) setReady(true)
      } catch (error: unknown) {
        console.error('Overenie obnovy hesla zlyhalo:', getErrorMessage(error, 'Neznáma chyba.'))
        if (active) setMessage(getErrorMessage(error, 'Obnovu hesla sa nepodarilo overiť. Vyžiadaj si nový odkaz.'))
      } finally {
        if (active) setChecking(false)
      }
    }
    void checkSession()
    return () => { active = false }
  }, [recoveryError])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || saving) return
    setMessage('')
    if (password.length < 8 || !/\d/.test(password)) return setMessage('Heslo musí mať aspoň 8 znakov a jednu číslicu.')
    if (password !== confirm) return setMessage('Heslá sa nezhodujú.')
    setSaving(true)
    try {
      const { error } = await createClient().auth.updateUser({ password })
      if (error) throw error
      setDone(true)
    } catch (error: unknown) {
      console.error('Zmena hesla zlyhala:', getErrorMessage(error, 'Neznáma chyba.'))
      const isReusedPassword = error !== null && typeof error === 'object'
        && 'code' in error && error.code === 'same_password'
      setMessage(isReusedPassword
        ? 'Toto heslo ste použili v minulosti, zadajte nové.'
        : 'Heslo sa nepodarilo zmeniť. Skús to znova alebo si vyžiadaj nový odkaz na obnovu.')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'mt-2 w-full rounded-lg border border-app-line/10 bg-app-ink px-3 py-3 text-sm outline-none focus:border-[#a8e63c] disabled:opacity-50'

  return (
    <main className="min-h-screen bg-app-ink px-6 py-8 text-app-fg">
      <div className="mx-auto max-w-[420px]">
        <Link href="/" aria-label="RIVA Padel"><RivaLogo /></Link>
        <section className="mt-16 rounded-2xl border border-app-line/10 bg-app-court p-7">
          <h1 className="text-3xl font-black uppercase">{t('Nastavenie nového hesla')}</h1>
          {checking ? <p role="status" className="mt-5 text-sm text-app-fg/60">{t('Overujem odkaz na obnovu hesla…')}</p> : done ? (
            <div role="status" className="mt-5 space-y-4">
              <p className="text-sm text-app-fg/70">{t('Heslo bolo úspešne zmenené. Pri ďalšom prihlásení použi nové heslo.')}</p>
              <p className="text-sm text-app-fg/60">{t('Heslo si môžeš neskôr zmeniť v nastaveniach aplikácie v časti „Zabezpečenie & účet“.')}</p>
              <Link href="/profile" className="block rounded-lg bg-[#a8e63c] px-4 py-3 text-center text-sm font-bold text-[#061016]">{t('Pokračovať do aplikácie')}</Link>
            </div>
          ) : ready ? (
            <form onSubmit={submit} className="mt-7 space-y-4">
              <p className="text-sm leading-6 text-app-fg/60">{t('Zvoľ si nové heslo s aspoň 8 znakmi a jednou číslicou.')}</p>
              <label className="block text-xs font-semibold text-app-fg/70">
                {t('Nové heslo')}
                <input required type="password" autoComplete="new-password" minLength={8} disabled={saving} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} />
              </label>
              <label className="block text-xs font-semibold text-app-fg/70">
                {t('Potvrď nové heslo')}
                <input required type="password" autoComplete="new-password" minLength={8} disabled={saving} value={confirm} onChange={(event) => setConfirm(event.target.value)} className={inputClass} />
              </label>
              <button disabled={saving} className="w-full rounded-lg bg-[#a8e63c] py-3.5 text-xs font-black text-[#061016] disabled:opacity-50">{t(saving ? 'UKLADÁM…' : 'ULOŽIŤ NOVÉ HESLO')}</button>
            </form>
          ) : null}
          {message && <p role="alert" className="mt-4 text-sm text-app-red-300">{t(message)}</p>}
          {!checking && !done ? <Link href="/auth/forgot-password" className="mt-6 block text-center text-sm font-semibold text-app-accent">{t('Poslať nový odkaz na obnovu hesla')}</Link> : null}
        </section>
      </div>
    </main>
  )
}
