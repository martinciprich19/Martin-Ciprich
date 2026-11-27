'use client'

import { useId, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, X } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'

export function PairQrButton({ pairId, names }: { pairId: string; names: string }) {
  const { t } = useLanguage()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const title = t('Spoločný QR kód dvojice', 'Shared pair QR code')
  const description = t('Spoločný QR kód na spoločné prihlásenie oboch hráčov do zápasu na kiosku.', 'Shared QR code for adding both players to a match at the kiosk.')

  return <>
    <button type="button" onClick={() => dialogRef.current?.showModal()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#ccff00]/30 px-3 py-2 text-xs font-bold text-app-league hover:bg-[#ccff00]/10"><QrCode size={15} aria-hidden="true" />{t('QR kód dvojice', 'Pair QR code')}</button>
    <dialog ref={dialogRef} aria-labelledby={titleId} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-2xl border border-app-line/15 bg-app-surface p-5 text-app-fg backdrop:bg-black/85">
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="font-bold">{title}</h2>
        <button type="button" autoFocus onClick={() => dialogRef.current?.close()} aria-label={t('Zavrieť', 'Close')} className="rounded-lg border border-app-line/15 p-2"><X size={20} /></button>
      </div>
      <p className="mt-2 text-sm text-app-fg/65">{description}</p>
      <p className="mt-2 break-words text-sm font-bold">{names}</p>
      <div className="mt-4 rounded-xl bg-white p-5"><QRCodeSVG value={`riva:pair:${pairId}`} size={420} className="h-auto w-full max-h-[55dvh]" level="M" bgColor="#ffffff" fgColor="#061016" title={`${title} · ${names}`} /></div>
    </dialog>
  </>
}
