'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'
import { useLanguage } from '@/components/language-provider'
import { InstallAppButton } from '@/components/install-app-button'
import { installationPlatform } from '@/lib/pwa-installation'
import { isLocalNotificationMode, localNotificationsEnabled, enableLocalNotifications, disableLocalNotifications } from '@/lib/local-notifications'
import { disablePushNotifications, enablePushNotifications, getPushDevice, refreshPushToken } from '@/lib/notifications'

export function PushNotificationListener() {
  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let generation = 0
    async function listen(userId: string | undefined) {
      const current = ++generation
      unsubscribe?.()
      unsubscribe = undefined
      try {
        if (!userId || !('Notification' in window) || Notification.permission !== 'granted'
          || getPushDevice()?.userId !== userId) return
        const client = await refreshPushToken(userId, { restoreOnly: true })
        if (!client || disposed || generation !== current) return
        const { messaging, registration } = client
        const { onMessage } = await import('firebase/messaging')
        if (disposed || generation !== current) return
        unsubscribe = onMessage(messaging, (payload) => {
          if (getPushDevice()?.userId === userId) {
            registration.active?.postMessage({ type: 'RIVA_PUSH_FOREGROUND', payload })
          }
        })
      } catch (error) {
        console.error('Obnovenie push notifikácií zlyhalo:', error)
        window.dispatchEvent(new CustomEvent('riva-push-error', { detail: getErrorMessage(error, 'Push notifikácie sa nepodarilo obnoviť.') }))
      }
    }
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Avoid calling Supabase inside its synchronous auth callback.
      setTimeout(() => { if (!disposed) void listen(session?.user.id) }, 0)
    })
    const changed = () => {
      const device = getPushDevice()
      if (device) void listen(device.userId)
      else { ++generation; unsubscribe?.(); unsubscribe = undefined }
    }
    window.addEventListener('riva-push-enabled', changed)
    return () => {
      disposed = true
      ++generation
      subscription.unsubscribe()
      unsubscribe?.()
      window.removeEventListener('riva-push-enabled', changed)
    }
  }, [])
  return null
}

export function PushNotificationSettings({ visible = true, pushAllowed = true, onEnabled }: { visible?: boolean; pushAllowed?: boolean; onEnabled?: () => void }) {
  const { t } = useLanguage()
  const [userId, setUserId] = useState<string>()
  const [enabled, setEnabled] = useState(false)
  const [localMode, setLocalMode] = useState(false)
  const [supported, setSupported] = useState(false)
  const [needsInstall, setNeedsInstall] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const local = isLocalNotificationMode()
    setLocalMode(local)
    const platform = installationPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
    const installed = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    setNeedsInstall(platform.isIOS && !installed)
    setSupported(window.isSecureContext && 'Notification' in window && (local || ('PushManager' in window && 'serviceWorker' in navigator)))
    const update = () => {
      if (!active) return
      try { setEnabled(Boolean(pushAllowed && userId && 'Notification' in window && (local
        ? localNotificationsEnabled(userId)
        : getPushDevice()?.userId === userId && Notification.permission === 'granted'))) }
      catch (error) { setError(getErrorMessage(error, 'Registráciu notifikácií sa nepodarilo načítať.')) }
    }
    void createClient().auth.getUser().then(({ data, error }) => {
      if (!active) return
      if (error) setError(getErrorMessage(error, 'Prihlásenie sa nepodarilo overiť.'))
      else setUserId(data.user?.id)
    })
    update()
    const pushError = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string') setError(event.detail)
    }
    window.addEventListener('riva-push-changed', update)
    window.addEventListener('riva-push-error', pushError)
    return () => {
      active = false
      window.removeEventListener('riva-push-changed', update)
      window.removeEventListener('riva-push-error', pushError)
    }
  }, [userId, pushAllowed])

  async function run(action: 'enable' | 'disable') {
    if (!userId) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (localMode) {
        if (action === 'enable') {
          await enableLocalNotifications(userId)
          onEnabled?.()
          setEnabled(true)
          setMessage(t('Lokálne notifikácie sú zapnuté. Firebase push nie je aktívny.', 'Local notifications are enabled. Firebase push is not active.'))
        } else if (action === 'disable') {
          disableLocalNotifications(userId)
          setEnabled(false)
          setMessage(t('Lokálne notifikácie sú vypnuté.', 'Local notifications are disabled.'))
        }
        return
      }
      if (action === 'enable') {
        await enablePushNotifications(userId)
        onEnabled?.()
        setEnabled(true)
        window.dispatchEvent(new Event('riva-push-enabled'))
        setMessage(t('Notifikácie sú zapnuté na tomto zariadení.', 'Notifications are enabled on this device.'))
      } else if (action === 'disable') {
        await disablePushNotifications()
        setEnabled(false)
        window.dispatchEvent(new Event('riva-push-enabled'))
        setMessage(t('Notifikácie sú vypnuté na tomto zariadení.', 'Notifications are disabled on this device.'))
      }
    } catch (error) {
      console.error('Push notifikácie:', error)
      setError(getErrorMessage(error, t('Akcia sa nepodarila.', 'The action failed.')))
    } finally { setBusy(false) }
  }

  if (!visible) return null
  return (
    <section className="mx-auto my-4 max-w-[1120px] rounded-2xl border border-white/10 bg-[#131924] p-5">
      <h2 className="flex items-center gap-2 text-sm font-black"><Bell size={18} className="text-[#ccff00]" />{localMode ? t('Lokálne notifikácie · vývoj', 'Local notifications · development') : t('Notifikácie na mobile', 'Mobile notifications')}</h2>
      {localMode ? <p className="mt-2 text-sm text-white/60">{t('Nejde o vzdialený push; pri zatvorenej aplikácii sa upozornenia nedoručujú.', 'This is not remote push; alerts are not delivered when the app is closed.')}</p> : null}
      {needsInstall ? <div className="mt-3"><p className="mb-3 text-sm text-amber-200">{t('Na iPhone/iPade (iOS 16.4+) pridaj RIVA Padel na plochu a otvor ju z jej ikony.', 'On iPhone/iPad (iOS 16.4+), add RIVA Padel to your home screen and open it from its icon.')}</p><InstallAppButton /></div> : !supported ? <p className="mt-3 text-sm text-amber-200">{t('Použi HTTPS a prehliadač s podporou Web Push.', 'Use HTTPS and a browser that supports Web Push.')}</p> : (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={busy || !userId} onClick={() => void run(enabled ? 'disable' : 'enable')} className="inline-flex items-center gap-2 rounded-lg bg-[#ccff00] px-4 py-3 text-xs font-black text-[#10150d] disabled:opacity-50">
            {enabled ? <BellOff size={16} /> : <Bell size={16} />}
            {busy ? t('Spracúvam…', 'Processing…') : enabled ? t('Vypnúť na tomto zariadení', 'Disable on this device') : localMode ? t('Zapnúť lokálne notifikácie', 'Enable local notifications') : t('Zapnúť notifikácie na uzamknutej obrazovke', 'Enable lock-screen notifications')}
          </button>
        </div>
      )}
      {message ? <p role="status" className="mt-3 text-sm text-[#ccff00]">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-red-200">{error}</p> : null}
    </section>
  )
}
