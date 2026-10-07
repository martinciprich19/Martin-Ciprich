'use client'

import { Moon, Sun } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { useTheme } from '@/components/theme-provider'

export function ThemeToggle() {
  const { t } = useLanguage()
  const { theme, setTheme, isReady, storageError } = useTheme()
  const isDark = theme === 'dark'

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 dark:border-white/10 dark:bg-[#131924] dark:text-white">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold">{t('Vzhľad aplikácie', 'App appearance')}</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-white/55">{isDark ? t('Tmavý režim', 'Dark mode') : t('Svetlý režim', 'Light mode')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Sun size={18} aria-hidden="true" />
          <button
            type="button"
            role="switch"
            aria-label={t('Tmavý režim', 'Dark mode')}
            aria-checked={isDark}
            disabled={!isReady}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={`relative h-7 w-12 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime-500 disabled:opacity-50 ${isDark ? 'bg-[#ccff00]' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform ${isDark ? 'translate-x-5' : ''}`} />
          </button>
          <Moon size={18} aria-hidden="true" />
        </div>
      </div>
      {storageError ? <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">{t('Preferenciu vzhľadu sa nepodarilo uložiť alebo načítať. Skontroluj povolenia úložiska prehliadača.', 'Could not save or load your theme preference. Check your browser storage permissions.')}</p> : null}
    </section>
  )
}
