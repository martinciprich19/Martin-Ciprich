import { Suspense } from 'react'
import { MatchStartView } from '@/components/match-start-view'
import { PublicShell } from '@/components/public-shell'

export default function MatchPage() {
  return (
    <PublicShell>
      <Suspense fallback={<p role="status" className="py-16 text-center text-white/60">Načítavam…</p>}>
        <MatchStartView />
      </Suspense>
    </PublicShell>
  )
}
