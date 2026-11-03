'use client'

import { RefreshCw } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'

export function PageReloadButton() {
  const { t } = useLanguage()
  const label = t('Obnoviť stránku', 'Reload page')

  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      aria-label={label}
      title={label}
      className="fixed z-40 flex h-11 w-11 items-center justify-center rounded-full border border-app-line/25 bg-app-court text-app-accent shadow-lg transition hover:border-app-accent hover:bg-app-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
      style={{
        right: 'calc(env(safe-area-inset-right, 0px) + 1rem)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
      }}
    >
      <RefreshCw size={21} aria-hidden="true" />
    </button>
  )
}
