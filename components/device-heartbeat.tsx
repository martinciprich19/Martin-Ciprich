'use client'

import { useEffect } from 'react'

export function DeviceHeartbeat() {
  useEffect(() => {
    if (navigator.userAgent.includes('RivaTelemetry/1')) return
    let active = true
    let busy = false
    let paired = true
    let controller: AbortController | null = null
    async function report() {
      if (!active || busy || !paired || document.hidden) return
      busy = true
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 10000)
      try {
        const response = await fetch('/api/device-heartbeat', {
          method: 'POST', headers: { 'x-riva-source': 'browser' },
          signal: controller.signal,
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? 'Odoslanie stavu zlyhalo.')
        paired = result.paired !== false
      } catch (error) {
        if (active) console.error('Device heartbeat failed:', error)
      } finally { window.clearTimeout(timeout); busy = false }
    }
    void report()
    const timer = window.setInterval(() => void report(), 20000)
    document.addEventListener('visibilitychange', report)
    return () => { active = false; controller?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', report) }
  }, [])
  return null
}
