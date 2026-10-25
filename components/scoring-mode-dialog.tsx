'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useLanguage } from '@/components/language-provider'
import type { MatchSettings } from '@/lib/live-match-scoring'

export function ScoringModeDialog({ onConfirm, onCancel, busy, error, children }: {
  onConfirm: (settings: MatchSettings) => void
  onCancel: () => void
  busy: boolean
  error?: string
  children?: ReactNode
}) {
  const { t } = useLanguage()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [settings, setSettings] = useState<MatchSettings>({
    scoring_type: 'golden_point',
    set_format: 'standard',
    third_set_format: 'super_tiebreak',
  })

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-3xl border border-app-line/15 bg-app-court p-6 text-app-fg shadow-2xl backdrop:bg-black/75">
      <form onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm(settings) }}>
        <h2 id={titleId} className="text-2xl font-black">{t('Nastavenia zápasu', 'Match settings')}</h2>
        <p className="mt-2 text-sm text-app-fg/60">{t('Vyber pravidlá pred začiatkom zápasu.', 'Choose the rules before starting the match.')}</p>
        {children}
        <fieldset disabled={busy} className="mt-5 space-y-3">
          <legend className="mb-2 text-sm font-bold">{t('Výhody v geme', 'Game scoring')}</legend>
          {(['golden_point', 'advantage'] as const).map((value) => (
            <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${settings.scoring_type === value ? 'border-[#a8e63c] bg-[#a8e63c]/10' : 'border-app-line/15'}`}>
              <input type="radio" name="scoring-mode" value={value} checked={settings.scoring_type === value} onChange={() => setSettings((current) => ({ ...current, scoring_type: value }))} className="mt-1 accent-[#a8e63c]" />
              <span><strong className="block">{value === 'advantage' ? t('Klasické výhody (Ad)', 'Classic advantage (Ad)') : t('Zlatá loptička (Punto de Oro)', 'Golden point (Punto de Oro)')}</strong>
                <span className="mt-1 block text-sm text-app-fg/60">{value === 'advantage'
                  ? t('Pri 40:40 treba vyhrať dva body za sebou.', 'At 40:40, win two consecutive points.')
                  : t('Pri 40:40 nasledujúci bod rozhodne gem.', 'At 40:40, the next point wins the game.')}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset disabled={busy} className="mt-5 space-y-3">
          <legend className="mb-2 text-sm font-bold">{t('Formát setu', 'Set format')}</legend>
          {(['standard', 'seven_games_no_tiebreak'] as const).map((value) => (
            <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${settings.set_format === value ? 'border-[#a8e63c] bg-[#a8e63c]/10' : 'border-app-line/15'}`}>
              <input type="radio" name="set-format" value={value} checked={settings.set_format === value} onChange={() => setSettings((current) => ({ ...current, set_format: value }))} className="mt-1 accent-[#a8e63c]" />
              <span><strong className="block">{value === 'standard' ? t('Klasický set', 'Standard set') : t('Sety do 7 gemov (bez tajbrejku)', 'Sets to 7 games (no tiebreak)')}</strong>
                <span className="mt-1 block text-sm text-app-fg/60">{value === 'standard'
                  ? t('Do 6 gemov; tajbrejk pri 6:6.', 'First to 6 games; tiebreak at 6:6.')
                  : t('Hrá sa do 7 víťazných gemov. Pri stave 6:6 rozhodne 13. gem a set končí 7:6.', 'Play to 7 games. At 6:6, a regular 13th game decides the set, which ends 7:6.')}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset disabled={busy} className="mt-5 space-y-3">
          <legend className="mb-2 text-sm font-bold">{t('Pravidlo pre 3. set', 'Deciding set')}</legend>
          {(['super_tiebreak', 'full_set'] as const).map((value) => (
            <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${settings.third_set_format === value ? 'border-[#a8e63c] bg-[#a8e63c]/10' : 'border-app-line/15'}`}>
              <input type="radio" name="third-set-format" value={value} checked={settings.third_set_format === value} onChange={() => setSettings((current) => ({ ...current, third_set_format: value }))} className="mt-1 accent-[#a8e63c]" />
              <span><strong className="block">{value === 'full_set' ? t('Plnohodnotný 3. set', 'Full third set') : t('Super Tiebreak do 10', 'Super tiebreak to 10')}</strong>
                <span className="mt-1 block text-sm text-app-fg/60">{value === 'full_set'
                  ? t('Po stave 1:1 na sety sa hrá ďalší klasický set.', 'At 1:1 in sets, play another full set.')
                  : t('Po stave 1:1 na sety rozhodne super tajbrejk do 10 bodov, rozdielom 2.', 'At 1:1 in sets, play a super tiebreak to 10, win by 2.')}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error ? <p role="alert" className="mt-4 text-sm text-app-red-300">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl border border-app-line/20 px-4 disabled:opacity-40">{t('Zrušiť', 'Cancel')}</button>
          <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-[#a8e63c] px-4 font-bold text-[#061016] disabled:opacity-40">{busy ? t('Pripravujem…', 'Preparing…') : t('Začať zápas', 'Start match')}</button>
        </div>
      </form>
    </dialog>
  )
}
