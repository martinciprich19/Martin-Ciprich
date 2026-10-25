'use client'

import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { RivaLogo } from '@/components/riva-logo'
import { FormEvent, useState } from 'react'

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 8 || !/\d/.test(password)) return setMessage('Heslo musí mať aspoň 8 znakov a jednu číslicu.')
    if (password !== confirm) return setMessage('Heslá sa nezhodujú.')
    const { error } = await createClient().auth.updateUser({ password })
    if (error) return setMessage('Heslo sa nepodarilo zmeniť. Skús odkaz obnovy znova.')
    setDone(true)
  }
  return <main className="min-h-screen bg-app-ink px-6 py-8 text-app-fg"><div className="mx-auto max-w-[420px]"><Link href="/" aria-label="RIVA Padel"><RivaLogo /></Link><div className="mt-24 rounded-2xl border border-app-line/10 bg-app-court p-7"><h1 className="text-3xl font-black uppercase">Nové heslo</h1>{done ? <><p className="mt-5 text-sm text-app-fg/60">Heslo bolo zmenené.</p><Link href="/auth/login" className="mt-6 block text-sm font-semibold text-app-accent">Prihlásiť sa</Link></> : <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-xs font-semibold text-app-fg/70">Nové heslo<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-app-line/10 bg-app-ink px-3 py-3 text-sm outline-none focus:border-[#a8e63c]" /></label><label className="block text-xs font-semibold text-app-fg/70">Potvrď heslo<input required type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="mt-2 w-full rounded-lg border border-app-line/10 bg-app-ink px-3 py-3 text-sm outline-none focus:border-[#a8e63c]" /></label>{message && <p role="alert" className="text-xs text-app-red-300">{message}</p>}<button className="w-full rounded-lg bg-[#a8e63c] py-3.5 text-xs font-black text-[#061016]">ZMENIŤ HESLO</button></form>}</div></div></main>
}
