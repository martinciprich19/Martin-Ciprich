'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Plus, Share, X } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { installationPlatform } from '@/lib/pwa-installation'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function InstallAppButton({ compact = false, showWhenInstalled = false }: { compact?: boolean; showWhenInstalled?: boolean }) {
  const { t } = useLanguage()
  const [hasCheckedDisplayMode, setHasCheckedDisplayMode] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isSafari, setIsSafari] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const standaloneQuery = window.matchMedia('(display-mode: standalone)')
    const standalone = () => setIsInstalled(standaloneQuery.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
    const { isIOS: ios, isSafari: safari } = installationPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
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
    setIsSafari(safari)
    standaloneQuery.addEventListener('change', standalone)
    window.addEventListener('beforeinstallprompt', captureInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      standaloneQuery.removeEventListener('change', standalone)
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    dialogRef.current?.showModal()
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus({ preventScroll: true })
    }
  }, [isOpen])

  async function install() {
    if (isInstalled || isIOS || !installPrompt) {
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

  if (!hasCheckedDisplayMode || (isInstalled && !showWhenInstalled)) return null

  return (
    <>
      <button
        type="button"
        onClick={() => void install()}
        disabled={isInstalling}
        className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#ccff00]/35 bg-[#ccff00]/10 font-bold text-[#ccff00] transition hover:bg-[#ccff00]/20 disabled:opacity-60 ${compact ? 'size-10' : 'px-4 py-3 text-xs'}`}
        aria-label={isInstalled ? t('Informácie o aplikácii', 'App information') : t('Pridať na plochu', 'Add to Home Screen')}
      >
        <Download size={compact ? 17 : 15} aria-hidden="true" />
        {!compact ? isInstalled ? t('Aplikácia je nainštalovaná', 'App installed') : t('Pridať na plochu', 'Add to Home Screen') : null}
      </button>

      {isOpen ? createPortal(
          <dialog ref={dialogRef} onCancel={() => setIsOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setIsOpen(false) } }} aria-labelledby={titleId} className="fixed inset-0 m-auto max-h-[85svh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl border border-[#9acc00]/40 bg-[#111722] p-5 text-white shadow-2xl backdrop:bg-black/75 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-lg font-black">{isInstalled ? t('Aplikácia je už nainštalovaná', 'The app is already installed') : t('Pridaj RIVA Padel na plochu', 'Add RIVA Padel to your Home Screen')}</h2>
                <p className="mt-2 text-sm leading-6 text-white/60">
                  {isInstalled
                    ? t('RIVA Padel už používaš ako aplikáciu. Nabudúce ju otvor ikonou na domovskej obrazovke.', 'You are already using RIVA Padel as an app. Next time, open it from your Home Screen.')
                    : isIOS && isSafari
                    ? t('Pridanie na domovskú obrazovku dokončíš v Safari v troch krokoch.', 'Add the app to your Home Screen in Safari in three steps.')
                    : isIOS
                    ? t('Tento návod je určený pre Safari. Otvor túto stránku v Safari a postupuj podľa krokov nižšie.', 'This guide is for Safari. Open this page in Safari and follow the steps below.')
                    : t('Návod pre iPhone je určený pre Safari. Na tomto zariadení otvor menu prehliadača a vyber „Inštalovať aplikáciu“ alebo „Pridať na plochu“, ak je táto možnosť dostupná.', 'The iPhone guide is for Safari. On this device, open your browser menu and choose “Install app” or “Add to Home Screen”, if available.')}
                </p>
              </div>
              {isIOS ? <Share className="mt-1 shrink-0 text-[#ccff00]" size={21} aria-hidden="true" /> : null}
              <button type="button" onClick={() => setIsOpen(false)} className="rounded-lg p-1 text-white/55 hover:text-white" aria-label={t('Zavrieť', 'Close')}><X size={19} /></button>
            </div>
            {isIOS && !isInstalled ? (
              <ol className="mt-5 space-y-3 text-sm text-white/75">
                <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#9acc00]/15 text-xs font-black text-[#9acc00]">1</span><span>{t('Ťukni na tlačidlo „Zdieľať“ v spodnej lište Safari.', 'Tap “Share” in the bottom Safari toolbar.')} <Share size={17} className="inline text-[#9acc00]" aria-hidden="true" /></span></li>
                <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#9acc00]/15 text-xs font-black text-[#9acc00]">2</span><span>{t('Zroluj ponuku nadol a vyber „Pridať na domovskú obrazovku“.', 'Scroll down and choose “Add to Home Screen”.')} <Plus size={17} className="inline text-[#9acc00]" aria-hidden="true" /></span></li>
                <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#9acc00]/15 text-xs font-black text-[#9acc00]">3</span>{t('V pravom hornom rohu klikni na „Pridať“.', 'Tap “Add” in the upper-right corner.')}</li>
              </ol>
            ) : null}
            <button type="button" onClick={() => setIsOpen(false)} className="mt-6 w-full rounded-lg bg-[#ccff00] px-4 py-3 text-sm font-black text-[#10150d]">{t('Rozumiem', 'Got it')}</button>
          </dialog>,
          document.body
      ) : null}
    </>
  )
}
