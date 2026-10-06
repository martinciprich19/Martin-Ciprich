'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { emailRedirectUrl } from '@/lib/auth-redirect'
import { getErrorMessage } from '@/lib/errors'

const COOLDOWN_SECONDS = 60

export function ResendVerificationButton({ email, className = '' }: { email: string; className?: string }) {
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function resend() {
    const address = email.trim()
    if (!address) {
      setStatus({ ok: false, text: 'Zadaj e-mail, na ktorý ti máme poslať overovací odkaz.' })
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      const { error } = await createClient().auth.resend({
        type: 'signup',
        email: address,
        options: { emailRedirectTo: emailRedirectUrl(window.location.origin) },
      })
      if (error) throw error
      setStatus({ ok: true, text: `Overovací e-mail sme znova odoslali na ${address}.` })
      setCooldown(COOLDOWN_SECONDS)
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'E-mail sa nepodarilo odoslať.')
      const rateLimited = /rate limit|security purposes|seconds/i.test(message)
      setStatus({ ok: false, text: rateLimited ? 'Príliš veľa pokusov. Počkaj chvíľu a skús to znova.' : message })
      if (rateLimited) setCooldown(COOLDOWN_SECONDS)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={resend}
        disabled={busy || cooldown > 0}
        className="w-full rounded-lg border border-[#b5ef33]/40 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-[#b5ef33] transition-colors hover:bg-[#b5ef33]/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Odosielam…' : cooldown > 0 ? `Poslať znova o ${cooldown} s` : 'Poslať overovací e-mail znova'}
      </button>
      {status && (
        <p role="status" className={`mt-2 text-center text-xs ${status.ok ? 'text-[#b5ef33]' : 'text-red-400'}`}>{status.text}</p>
      )}
    </div>
  )
}
