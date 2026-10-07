'use client'

import { useEffect, useState } from 'react'
import { Download, Share, X } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage()
  const [hasCheckedDisplayMode, setHasCheckedDisplayMode] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)

  useEffect(() => {
    const standaloneQuery = window.matchMedia('(display-mode: standalone)')
    const standalone = () => setIsInstalled(standaloneQuery.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const handleInstalled = () => {
      setIsInstalled(true)
      setInstallPrompt(null)
      setIsOpen(false)
    }

    standalone()
    setHasCheckedDisplayMode(true)
    setIsIOS(ios)
    standaloneQuery.addEventListener('change', standalone)
    window.addEventListener('beforeinstallprompt', captureInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      standaloneQuery.removeEventListener('change', standalone)
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  async function install() {
    if (!installPrompt) {
      setIsOpen(true)
      return
    }

    setIsInstalling(true)
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') setIsInstalled(true)
      setInstallPrompt(null)
    } catch (error: unknown) {
      console.error('Inštaláciu aplikácie sa nepodarilo spustiť:', error)
      setIsOpen(true)
    } finally {
      setIsInstalling(false)
    }
  }

  if (!hasCheckedDisplayMode || isInstalled) return null

  return (
    <>
      <button
        type="button"
        onClick={() => void install()}
        disabled={isInstalling}
        className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#ccff00]/35 bg-[#ccff00]/10 font-bold text-[#ccff00] transition hover:bg-[#ccff00]/20 disabled:opacity-60 ${compact ? 'size-10' : 'px-4 py-3 text-xs'}`}
        aria-label={t('Nainštalovať aplikáciu', 'Install app')}
      >
        <Download size={compact ? 17 : 15} aria-hidden="true" />
        {!compact ? t('Pridať na plochu', 'Add to Home Screen') : <span className="sr-only">{t('Pridať na plochu', 'Add to Home Screen')}</span>}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-4 sm:items-center" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="install-app-title" className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111722] p-5 text-white shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="install-app-title" className="text-lg font-black">{t('Pridaj RIVA Padel na plochu', 'Add RIVA Padel to your Home Screen')}</h2>
                <p className="mt-2 text-sm leading-6 text-white/60">
                  {isIOS
                    ? t('V Safari ťukni na Zdieľať a potom vyber Pridať na plochu.', 'In Safari, tap Share, then choose Add to Home Screen.')
                    : t('V menu prehliadača vyber „Inštalovať aplikáciu“ alebo „Pridať na plochu“.', 'Open your browser menu and choose “Install app” or “Add to Home Screen”.')}
                </p>
              </div>
              {isIOS ? <Share className="mt-1 shrink-0 text-[#ccff00]" size={21} aria-hidden="true" /> : null}
              <button type="button" onClick={() => setIsOpen(false)} className="rounded-lg p-1 text-white/55 hover:text-white" aria-label={t('Zavrieť', 'Close')}><X size={19} /></button>
            </div>
            {isIOS ? (
              <ol className="mt-5 space-y-3 text-sm text-white/75">
                <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#ccff00]/15 text-xs font-black text-[#ccff00]">1</span>{t('Otvor túto stránku v prehliadači Safari.', 'Open this page in Safari.')}</li>
                <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#ccff00]/15 text-xs font-black text-[#ccff00]">2</span>{t('Ťukni na tlačidlo Zdieľať v spodnej časti obrazovky.', 'Tap the Share button at the bottom of the screen.')}</li>
                <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#ccff00]/15 text-xs font-black text-[#ccff00]">3</span>{t('Posuň ponuku nadol a vyber „Pridať na plochu“.', 'Scroll the menu and choose “Add to Home Screen”.')}</li>
              </ol>
            ) : null}
            <button type="button" onClick={() => setIsOpen(false)} className="mt-6 w-full rounded-lg bg-[#ccff00] px-4 py-3 text-sm font-black text-[#10150d]">{t('Rozumiem', 'Got it')}</button>
          </section>
        </div>
      ) : null}
    </>
  )
}
