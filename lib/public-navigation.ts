import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export async function getPublicNavigation() {
  const kioskMode = (await cookies()).get('riva-kiosk-mode')?.value === '1'
  if (kioskMode) return { kioskMode, signedIn: false }

  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error && error.name !== 'AuthSessionMissingError') {
    console.error('Overenie prihlásenia vo verejnej navigácii zlyhalo:', error)
  }
  return { kioskMode, signedIn: Boolean(user?.email_confirmed_at) }
}
