import { cookies } from 'next/headers'
import { PublicShell } from '@/components/public-shell'
import { RankingsView } from '@/components/rankings-view'

export default async function RankingsPage() {
  const kioskMode = (await cookies()).get('riva-kiosk-mode')?.value === '1'
  return <PublicShell kioskMode={kioskMode}><RankingsView publicView /></PublicShell>
}
