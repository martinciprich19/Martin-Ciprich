'use client'

import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { RivaLogo } from '@/components/riva-logo'
import { FormEvent, useState } from 'react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    })
    setLoading(false)
    if (error) return setMessage('Odoslanie odkazu sa nepodarilo. Skontroluj e-mail a skús to znova.')
    setSent(true)
  }

  return <main className="min-h-screen bg-app-ink px-6 py-8 text-app-fg"><div className="mx-auto max-w-[420px]"><Link href="/" aria-label="RIVA Padel"><RivaLogo /></Link><div className="mt-24 rounded-2xl border border-app-line/10 bg-app-court p-7"><p className="text-[10px] font-bold uppercase tracking-[.25em] text-app-accent">RIVA Padel</p><h1 className="mt-3 text-3xl font-black uppercase">Obnova hesla</h1>{sent ? <p className="mt-5 text-sm text-app-fg/60">Ak účet s týmto e-mailom existuje, poslali sme ti odkaz na obnovu hesla.</p> : <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-xs font-semibold text-app-fg/70">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-lg border border-app-line/10 bg-app-ink px-3 py-3 text-sm outline-none focus:border-[#a8e63c]" /></label>{message && <p role="alert" className="text-xs text-app-red-300">{message}</p>}<button disabled={loading} className="w-full rounded-lg bg-[#a8e63c] py-3.5 text-xs font-black text-[#061016]">{loading ? 'ODOSIELAM...' : 'POSLAŤ ODKAZ'}</button></form>}<Link href="/auth/login" className="mt-6 block text-center text-xs font-semibold text-app-accent">Späť na Prihlásenie</Link></div></div></main>
}
