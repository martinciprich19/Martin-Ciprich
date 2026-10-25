'use client'

import { useEffect, useId, useRef } from 'react'
import { useLanguage } from '@/components/language-provider'

export function PauseMatchDialog({ registered, ending = false, onConfirm, onCancel }: {
  registered: boolean
  ending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const { t } = useLanguage()
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onCancel() }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-3xl border border-app-line/15 bg-app-court p-6 text-app-fg shadow-2xl backdrop:bg-black/75">
      <h2 id={titleId} className="text-2xl font-black">{ending ? t('Natrvalo ukončiť zápas?', 'Permanently end match?') : t('Prerušiť zápas?', 'Pause match?')}</h2>
      <p className="mt-4 text-sm leading-6 text-app-fg/70">{ending
        ? t('Naozaj chcete ukončiť tento zápas a stratiť všetky štatistiky?', 'Are you sure you want to end this match and lose all statistics?')
        : registered
        ? t('Naozaj chceš prerušiť zápas? Zápas sa uloží a všetkým hráčom bude e-mailom zaslaný 4-miestny PIN kód na jeho neskoršie obnovenie.', 'Pause this match? The match will be saved and all participants will be emailed a four-digit PIN to resume it later.')
        : t('Naozaj chceš prerušiť zápas? Zápas sa uloží a zobrazí sa 4-miestny PIN na pokračovanie. Pri rýchlej hre sa e-mail neposiela, preto si PIN zapamätajte alebo zapíšte.', 'Pause this match? The match will be saved and a four-digit resume PIN displayed. Quick games do not send email, so remember or write down the PIN.')}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="min-h-12 rounded-xl border border-app-line/20 px-5">{t('Zrušiť', 'Cancel')}</button>
        <button type="button" onClick={onConfirm} className="min-h-12 rounded-xl bg-[#a8e63c] px-5 font-bold text-[#061016]">{ending ? t('Natrvalo ukončiť', 'Permanently end') : t('Prerušiť a uložiť', 'Pause and save')}</button>
      </div>
    </dialog>
  )
}
