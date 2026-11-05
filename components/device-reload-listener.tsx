'use client'

import { useEffect } from 'react'

const storageKey = 'riva-reload-command'

export function DeviceReloadListener() {
  useEffect(() => {
    let active = true
    let busy = false
    let paired = true
    let reloading = false
    let controller: AbortController | null = null
    async function poll() {
      if (!active || busy || !paired || reloading || document.hidden) return
      busy = true
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 10000)
      try {
        const ack = sessionStorage.getItem(storageKey)
        const response = await fetch('/api/device-reload', {
          method: 'POST', headers: ack ? { 'x-riva-reload-ack': ack } : {},
          signal: controller.signal,
        })
        const result = await response.json()
        if (response.status === 409 && ack) sessionStorage.removeItem(storageKey)
        if (!response.ok) throw new Error(result.error ?? 'Obnovenie zlyhalo.')
        if (!active) return
        paired = result.paired !== false
        if (ack) sessionStorage.removeItem(storageKey)
        if (result.command) {
          if (typeof result.command !== 'string' || !/^[0-9a-f-]{36}$/i.test(result.command)) throw new Error('Neplatný príkaz obnovenia.')
          sessionStorage.setItem(storageKey, result.command)
          reloading = true
          window.location.reload()
        }
      } catch (error) { if (active) console.error('Device reload listener failed:', error) }
      finally { window.clearTimeout(timeout); busy = false }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 10000)
    document.addEventListener('visibilitychange', poll)
    return () => { active = false; controller?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', poll) }
  }, [])
  return null
}
