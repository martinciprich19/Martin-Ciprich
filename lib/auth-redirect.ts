export const DEFAULT_AFTER_LOGIN_PATH = '/profile'

// Only same-origin relative paths are allowed, to prevent open redirects via ?next=.
export function safeNextPath(value: string | null | undefined, fallback = DEFAULT_AFTER_LOGIN_PATH): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  try {
    const url = new URL(value, 'http://spl.local')
    if (url.origin !== 'http://spl.local') return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export function emailRedirectUrl(origin: string, next = DEFAULT_AFTER_LOGIN_PATH): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`
}
