import { createClient } from '@supabase/supabase-js'

export function createQrDeviceToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
}

export function saveQrDeviceToken(matchId: string, token: string): void {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Neplatný kľúč zariadenia pre QR zápas.')
  window.localStorage.setItem(`riva-qr-match-${matchId}`, token)
}

export function getQrDeviceToken(matchId: string): string | null {
  const token = window.localStorage.getItem(`riva-qr-match-${matchId}`)
  if (token !== null && !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error('Uložený kľúč QR zápasu je poškodený.')
  }
  return token
}

export function createQrDeviceClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-riva-qr-device': token } },
    },
  )
}
