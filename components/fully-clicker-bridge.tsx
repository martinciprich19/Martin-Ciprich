'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/components/language-provider'
import { getErrorMessage } from '@/lib/errors'
import { connectFullyClicker, FULLY_CLICKER_STORAGE, getFullyBroadcastApi, getFullyClickerActions } from '@/lib/fully-clicker'

export function FullyClickerBridge({ enabled }: { enabled: boolean }) {
  const { t } = useLanguage()
  const [code, setCode] = useState('')
  const [pairedCode, setPairedCode] = useState('')
  const [error, setError] = useState('')
  const [received, setReceived] = useState<{ key: string; count: number } | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(FULLY_CLICKER_STORAGE)
      if (saved) {
        getFullyClickerActions(saved)
        setCode(saved)
        setPairedCode(saved)
      }
    } catch (error) {
      console.error('Fully clicker pairing could not be loaded:', error)
      setError(getErrorMessage(error, 'Párovanie pomocníka sa nepodarilo načítať.'))
    }
  }, [])

  useEffect(() => {
    setConnected(false)
    if (!enabled || !pairedCode) return
    const api = getFullyBroadcastApi(Reflect.get(window, 'fully'))
    if (!api) {
      setError('Fully JavaScript Interface nie je dostupné. Vo Fully povoľ Advanced Web Settings → Enable JavaScript Interface a obmedz URL Whitelist na RIVA doménu. Vyžaduje Fully PLUS.')
      return
    }
    let disconnect: (() => void) | undefined
    try {
      disconnect = connectFullyClicker(api, pairedCode, (key) => {
        if (document.visibilityState !== 'visible') return
        setReceived((previous) => ({ key, count: (previous?.count ?? 0) + 1 }))
        const target = document.activeElement ?? document.body
        target.dispatchEvent(new KeyboardEvent('keydown', {
          key, code: key, bubbles: true, cancelable: true,
        }))
      })
      setError('')
      setConnected(true)
    } catch (error) {
      console.error('Fully clicker connection failed:', error)
      setError(getErrorMessage(error, 'Spojenie s Fully pomocníkom zlyhalo.'))
    }
    return () => {
      try { disconnect?.() } catch (error) {
        console.error('Fully clicker disconnect failed:', error)
        setError(getErrorMessage(error, 'Odpojenie Fully pomocníka zlyhalo.'))
      }
    }
  }, [enabled, pairedCode])

  function pair(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const value = code.trim().toLowerCase()
      getFullyClickerActions(value)
      window.sessionStorage.setItem(FULLY_CLICKER_STORAGE, value)
      setReceived(null)
      setError('')
      setPairedCode(value)
    } catch (error) {
      console.error('Fully clicker pairing failed:', error)
      setError(getErrorMessage(error, 'Párovanie pomocníka zlyhalo.'))
    }
  }

  return (
    <div className="mx-auto mt-4 max-w-xl rounded-xl border border-app-line/20 p-4">
      <h3 className="text-sm font-bold">{t('Prepojenie s Fully Kiosk', 'Fully Kiosk connection')}</h3>
      <p className="mt-2 text-xs text-app-fg/60">{t('V aplikácii RIVA Fully Clicker povoľ službu, priraď oba klikre a sem vlož párovací kód. Toto prepojenie nepoužíva RIVA Clicker Test ani RIVA Android Kiosk.', 'Enable the service in RIVA Fully Clicker, assign both clickers and enter its pairing code here. This connection does not use RIVA Clicker Test or RIVA Android Kiosk.')}</p>
      <form onSubmit={pair} className="mt-3 flex flex-wrap gap-2">
        <label className="min-w-0 flex-1 text-xs">
          {t('Párovací kód pomocníka', 'Helper pairing code')}
          <input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={32} className="mt-1 min-h-11 w-full rounded-lg border border-app-line/20 bg-app-ink px-3 font-mono" />
        </label>
        <button type="submit" className="min-h-11 self-end rounded-lg border border-app-line/20 px-4 text-sm font-bold">{t('Spárovať', 'Pair')}</button>
      </form>
      <p role="status" className="mt-3 text-xs">{!enabled
        ? t('Zapni vyššie pomocníka pre rozpoznávanie klikrov.', 'Enable the clicker recognition helper above.')
        : connected
          ? received ? `${t('Fully prijalo vstup:', 'Fully received input:')} ${received.key} (#${received.count})` : t('Príjem je pripravený. Čakám na prvé stlačenie — spojenie zatiaľ nie je potvrdené.', 'Receiver ready. Waiting for the first press — connection is not confirmed yet.')
          : t('Pomocník nie je prepojený.', 'Helper is not connected.')}</p>
      {error ? <p role="alert" className="mt-2 text-xs text-app-red-300">{error}</p> : null}
    </div>
  )
}
