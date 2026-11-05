declare global {
  interface Window {
    RivaNativeHaptics?: { tap(): void }
  }
}

export function navigationTapFeedback() {
  if (typeof window === 'undefined') return
  if (window.RivaNativeHaptics) {
    window.RivaNativeHaptics.tap()
  } else if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(15)
  }
}
