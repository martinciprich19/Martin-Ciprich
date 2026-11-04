'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { disablePushNotifications } from '@/lib/notifications'

export function DevicePairing() {
  const [code, setCode] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function generate() {
    setBusy(true)
    setCode('')
    setError('')
    try {
      await disablePushNotifications()
      const { error: logoutError } = await createClient().auth.signOut({ scope: 'local' })
      if (logoutError) throw logoutError
      const response = await fetch('/api/device-pair', { method: 'POST', signal: AbortSignal.timeout(15000) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Párovanie zlyhalo.')
      if (typeof result.code !== 'string' || !/^[A-F0-9]{8}$/.test(result.code)
        || typeof result.expiresAt !== 'string') throw new Error('Neplatný párovací kód.')
      setCode(result.code)
      setExpiresAt(result.expiresAt)
    } catch (error) {
      console.error('Generating pairing code failed:', error)
      setError(error instanceof Error ? error.message : 'Párovanie zlyhalo.')
    } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!code) return
    let active = true
    let running = false
    const check = async () => {
      if (running) return
      if (Date.now() >= Date.parse(expiresAt)) {
        setCode('')
        setError('Kód vypršal. Vytvor nový.')
        return
      }
      running = true
      try {
        const response = await fetch('/api/device-pair', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? 'Overenie párovania zlyhalo.')
        if (!active) return
        setError('')
        if (result.paired === true) {
          if (typeof result.destination !== 'string'
            || !/^\/(?:scoreboard\/[1-9]\d*|match\?mode=kiosk&courtId=[1-9]\d*)$/.test(result.destination)) {
            throw new Error('Neplatná cieľová obrazovka.')
          }
          window.location.assign(result.destination)
        }
      } catch (error) {
        console.error('Pairing status check failed:', error)
        if (active) setError(error instanceof Error ? error.message : 'Overenie zlyhalo.')
      } finally { running = false }
    }
    const timer = window.setInterval(() => void check(), 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [code, expiresAt])

  return <main className="flex min-h-screen items-center justify-center bg-app-ink p-6 text-app-fg">
    <section className="w-full max-w-xl rounded-2xl border border-app-line/15 bg-app-panel p-8 text-center">
      <h1 className="text-3xl font-black">Pripojiť zariadenie ku kurtu</h1>
      <p className="mt-4 text-app-fg/65">Na tablete použi RIVA aplikáciu, na TV prehliadač. Admin sa prihlasuje iba na svojom zariadení. Vytvorenie kódu odhlási prípadný hráčsky účet na tejto obrazovke.</p>
      {code ? <>
        <p className="my-8 font-mono text-4xl font-black tracking-widest text-app-league">{code}</p>
        <p>V Správe arény zadaj tento kód, vyber kurt a režim: tablet alebo monitor skóre.</p>
        <p className="mt-3 text-sm text-app-fg/50">Kód platí 10 minút. Po priradení sa obrazovka otvorí automaticky.</p>
      </> : null}
      <button disabled={busy} onClick={() => void generate()} className="mt-6 rounded-xl bg-app-highlight px-6 py-3 font-bold text-app-ink disabled:opacity-50">{busy ? 'Vytváram kód…' : code ? 'Vytvoriť nový kód' : 'Zobraziť párovací kód'}</button>
      {error ? <p role="alert" className="mt-4 text-red-300">{error}</p> : null}
    </section>
  </main>
}
