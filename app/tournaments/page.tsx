import { cookies } from 'next/headers'
import { PublicShell } from '@/components/public-shell'
import { TournamentsView } from '@/components/tournaments-view'

export default async function TournamentsPage() {
  const kioskMode = (await cookies()).get('riva-kiosk-mode')?.value === '1'
  return <PublicShell kioskMode={kioskMode}><TournamentsView publicView kioskView={kioskMode} /></PublicShell>
}
