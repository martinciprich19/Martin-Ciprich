import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { MatchStartView } from '@/components/match-start-view'
import { PublicShell } from '@/components/public-shell'

export default async function MatchPage() {
  const kioskMode = (await cookies()).get('riva-kiosk-mode')?.value === '1'
  return (
    <PublicShell showAuthLinks={false} logoHref="/profile?view=overview" kioskMode={kioskMode}>
      <Suspense fallback={<p role="status" className="py-16 text-center text-app-fg/60">Načítavam…</p>}>
        <MatchStartView kioskMode={kioskMode} />
      </Suspense>
    </PublicShell>
  )
}
