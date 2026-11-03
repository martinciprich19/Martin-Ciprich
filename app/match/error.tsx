'use client'

import { useEffect } from 'react'
import { useLanguage } from '@/components/language-provider'

export default function MatchError({ error, retry }: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const { t } = useLanguage()

  useEffect(() => {
    console.error('Obrazovka zápasu zlyhala:', error)
  }, [error])

  return (
    <section role="alert" className="mx-auto max-w-xl rounded-2xl border border-red-400/30 bg-app-surface p-6 text-app-fg">
      <h1 className="text-xl font-bold">{t('Obrazovku zápasu sa nepodarilo zobraziť.', 'The match screen could not be displayed.')}</h1>
      <p className="mt-3 text-sm">{t('Zostávaš na adrese tohto zápasu. Po obnovení načítame skóre uložené na serveri; posledná neuložená zmena nemusí byť zachovaná.', 'You are still at this match address. Recovery loads the server-saved score; the last unsaved change may not be retained.')}</p>
      <p className="mt-3 break-words text-xs text-app-fg/60">{error.message}{error.digest ? ` (${error.digest})` : ''}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={retry} className="min-h-12 rounded-xl bg-[#a8e63c] px-5 py-3 font-bold text-[#061016]">{t('Skúsiť znova', 'Try again')}</button>
        <button type="button" onClick={() => window.location.reload()} className="min-h-12 rounded-xl border border-app-line/30 px-5 py-3 font-bold">{t('Obnoviť tento zápas', 'Reload this match')}</button>
      </div>
    </section>
  )
}
