'use client'

import { useEffect, useState } from 'react'

type Preview = { device_name: string; captured_at: string | null; image_base64: string | null }
export function KioskScreenPreview({ courtId }: { courtId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let busy = false
    async function refresh() {
      if (busy || document.hidden) return
      busy = true
      try {
        const response = await fetch(`/api/kiosk-preview?courtId=${courtId}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? 'Náhľad zlyhal.')
        if (active) { setPreview(result.preview); setError('') }
      } catch (error) {
        console.error('Kiosk screen preview failed:', error)
        if (active) setError(error instanceof Error ? error.message : 'Náhľad zlyhal.')
      } finally { busy = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [courtId])
  return <main className="flex h-dvh flex-col bg-[#080d10] p-4 text-white">
    <header className="shrink-0 pb-3">
      <h1 className="text-xl font-bold">Živý náhľad kiosku · Kurt {courtId}</h1>
      <p className="text-sm text-white/60">{preview?.device_name} · Iba na čítanie, obnovovanie každé 2–3 sekundy</p>
    </header>
    {error ? <p role="alert" className="text-red-300">{error}</p>
      : preview?.image_base64 ? <div className="relative min-h-0 flex-1"><img className="absolute inset-0 h-full w-full object-contain" src={`data:image/jpeg;base64,${preview.image_base64}`} alt="Aktuálna obrazovka priradeného tabletu" /></div>
        : <p role="status" className="m-auto max-w-lg text-center">Čakám na obraz z tabletu. Tablet musí byť zapnutý, pripojený a používať nové APK s podporou náhľadu. Over tiež priradenie aktívneho tabletu ku kurtu.</p>}
  </main>
}
