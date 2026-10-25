'use client'

import { useEffect, useRef } from 'react'

const KIOSK_IDLE_TIMEOUT_MS = 60_000
const KIOSK_ACTIVITY_EVENT = 'riva-kiosk-activity'

export function markKioskActivity() {
  window.dispatchEvent(new Event(KIOSK_ACTIVITY_EVENT))
}

export function useKioskInactivity(active: boolean, onTimeout: () => void) {
  const onTimeoutRef = useRef(onTimeout)

  useEffect(() => {
    onTimeoutRef.current = onTimeout
  }, [onTimeout])

  useEffect(() => {
    if (!active) return

    let timeoutId: number | null = null
    const resetTimeout = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => onTimeoutRef.current(), KIOSK_IDLE_TIMEOUT_MS)
    }

    resetTimeout()
    window.addEventListener('pointerdown', resetTimeout, { passive: true })
    window.addEventListener('keydown', resetTimeout)
    window.addEventListener('input', resetTimeout)
    window.addEventListener('change', resetTimeout)
    window.addEventListener(KIOSK_ACTIVITY_EVENT, resetTimeout)

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      window.removeEventListener('pointerdown', resetTimeout)
      window.removeEventListener('keydown', resetTimeout)
      window.removeEventListener('input', resetTimeout)
      window.removeEventListener('change', resetTimeout)
      window.removeEventListener(KIOSK_ACTIVITY_EVENT, resetTimeout)
    }
  }, [active])
}
