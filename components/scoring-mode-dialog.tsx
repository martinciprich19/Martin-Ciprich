'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useLanguage } from '@/components/language-provider'
import type { ScoringType } from '@/lib/live-match-scoring'

export function ScoringModeDialog({ onConfirm, onCancel, busy, error }: {
  onConfirm: (mode: ScoringType) => void
  onCancel: () => void
  busy: boolean
  error?: string
}) {
  const { t } = useLanguage()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [mode, setMode] = useState<ScoringType>('golden_point')

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-3xl border border-white/15 bg-[#0b1b22] p-6 text-white shadow-2xl backdrop:bg-black/75">
      <form onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm(mode) }}>
        <h2 id={titleId} className="text-2xl font-black">{t('Pravidlá bodovania', 'Scoring rules')}</h2>
        <p className="mt-2 text-sm text-white/60">{t('Vyber režim pred začiatkom zápasu.', 'Choose the mode before starting the match.')}</p>
        <fieldset disabled={busy} className="mt-5 space-y-3">
          <legend className="sr-only">{t('Režim zápasu', 'Match mode')}</legend>
          {(['advantage', 'golden_point'] as const).map((value) => (
            <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${mode === value ? 'border-[#a8e63c] bg-[#a8e63c]/10' : 'border-white/15'}`}>
              <input type="radio" name="scoring-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-[#a8e63c]" />
              <span><strong className="block">{value === 'advantage' ? t('So zhodou (Výhoda)', 'Standard / Advantage') : t('Bez zhody (Golden Point)', 'Golden Point / Sudden death')}</strong>
                <span className="mt-1 block text-sm text-white/60">{value === 'advantage'
                  ? t('Pri 40:40 treba vyhrať dva body za sebou.', 'At 40:40, win two consecutive points.')
                  : t('Pri 40:40 nasledujúci bod rozhodne gem.', 'At 40:40, the next point wins the game.')}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl border border-white/20 px-4 disabled:opacity-40">{t('Zrušiť', 'Cancel')}</button>
          <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-[#a8e63c] px-4 font-bold text-[#061016] disabled:opacity-40">{busy ? t('Pripravujem…', 'Preparing…') : t('Začať zápas', 'Start match')}</button>
        </div>
      </form>
    </dialog>
  )
}
