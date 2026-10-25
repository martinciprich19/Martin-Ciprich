'use client'

import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Maximize2, X } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'

export function PlayerQrCard({ profileId, name, isLoading, error }: { profileId: string | number | null; name: string; isLoading: boolean; error: string | null }) {
  const { t } = useLanguage()
  const [origin, setOrigin] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const profileUrl = origin && profileId !== null
    ? `${origin}/players/${encodeURIComponent(String(profileId))}`
    : null
  const title = t('Tvoj osobný QR kód', 'Your personal QR code')

  return <section aria-label={title} className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-[#ccff00]/20 bg-app-surface p-5 sm:flex-row sm:justify-between sm:p-6">
    <div>
      <h2 className="text-xl font-black">{title}</h2>
      <p className="mt-2 text-sm text-app-fg/55">{t('Naskenuj svoj kód do zápasu a začni hru.', 'Scan your code into a match and start playing.')}</p>
      <button type="button" disabled={!profileUrl} onClick={() => dialogRef.current?.showModal()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#ccff00] px-4 py-2.5 text-xs font-bold text-[#10150d] disabled:opacity-40"><Maximize2 size={16} aria-hidden="true" />{t('Zväčšiť QR kód', 'Enlarge QR code')}</button>
    </div>
    <div className="rounded-xl bg-white p-4">
      {profileUrl ? <QRCodeSVG value={profileUrl} size={160} level="M" bgColor="#ffffff" fgColor="#061016" title={`${title} · ${name}`} />
        : <p role={error ? 'alert' : 'status'} className={`max-w-56 text-center text-sm ${error ? 'text-red-700' : 'text-slate-600'}`}>
          {error ?? (isLoading || !origin
            ? t('Načítavam QR kód…', 'Loading QR code…')
            : t('QR kód zatiaľ nie je dostupný.', 'QR code is not available yet.'))}
        </p>}
    </div>
    <dialog ref={dialogRef} aria-labelledby="enlarged-player-qr-title" className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-auto rounded-2xl border border-app-line/15 bg-app-surface p-5 text-app-fg backdrop:bg-black/85">
      <div className="flex items-center justify-between gap-3">
        <h2 id="enlarged-player-qr-title" className="font-bold">{title}</h2>
        <button type="button" autoFocus onClick={() => dialogRef.current?.close()} aria-label={t('Zavrieť', 'Close')} className="rounded-lg border border-app-line/15 p-2"><X size={20} /></button>
      </div>
      <p className="mt-2 break-words text-sm text-app-fg/65">{name}</p>
      {profileUrl ? <div className="mt-4 rounded-xl bg-white p-5"><QRCodeSVG value={profileUrl} size={420} className="h-auto w-full max-h-[65dvh]" level="M" bgColor="#ffffff" fgColor="#061016" title={`${title} · ${name}`} /></div> : null}
    </dialog>
  </section>
}
