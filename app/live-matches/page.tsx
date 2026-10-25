import { PublicShell } from '@/components/public-shell'
import { LiveMatchesView } from '@/components/live-matches-view'

export default function LiveMatchesPage() {
  return (
    <PublicShell showAuthLinks={false} showMenuButton={false}>
      <LiveMatchesView />
    </PublicShell>
  )
}
