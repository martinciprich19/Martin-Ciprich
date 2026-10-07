'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { RivaLogo } from '@/components/riva-logo'
import { ResendVerificationButton } from '@/components/resend-verification-button'

function SignUpSuccessContent() {
  const email = useSearchParams().get('email')?.trim() ?? ''

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b1922] p-6 text-center shadow-xl sm:p-8 md:max-w-md">
      <div className="mb-6 flex justify-center"><RivaLogo /></div>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#b5ef33]/10 text-2xl" aria-hidden="true">✉️</div>
      <p className="mt-4 text-[10px] font-bold uppercase tracking-[.25em] text-[#b5ef33]">Posledný krok</p>
      <h1 className="mt-2 text-2xl font-black uppercase">Skontroluj svoj e-mail</h1>
      <p className="mt-4 text-sm leading-6 text-white/60">
        Poslali sme ti overovací odkaz{email ? <> na <strong className="break-all text-white">{email}</strong></> : null}.
        Klikni naň a tvoj účet sa aktivuje – potom sa automaticky prihlásiš a hráčsky profil sa zaradí do rebríčka.
      </p>
      <ul className="mt-5 space-y-1.5 rounded-xl border border-white/10 bg-[#061016] p-4 text-left text-xs leading-5 text-white/50">
        <li>• Kým e-mail nepotvrdíš, prihlásenie nebude možné.</li>
        <li>• Ak správu nevidíš, pozri priečinok Spam / Promo akcie.</li>
        <li>• Odkaz otvor najlepšie v tom istom prehliadači, v ktorom si sa registroval.</li>
      </ul>
      {email && <ResendVerificationButton email={email} className="mt-5" />}
      <Link href={email ? `/auth/login?email=${encodeURIComponent(email)}` : '/auth/login'} className="mt-4 inline-flex w-full justify-center rounded-lg bg-[#b5ef33] px-5 py-3 text-xs font-black uppercase text-[#061016] hover:bg-[#a2db25]">
        Už som potvrdil – prihlásiť sa
      </Link>
    </div>
  )
}

export default function SignUpSuccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#061016] px-4 py-8 text-white sm:px-6">
      <Suspense fallback={null}>
        <SignUpSuccessContent />
      </Suspense>
    </main>
  )
}
