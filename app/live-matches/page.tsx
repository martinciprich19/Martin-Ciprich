import { PublicShell } from '@/components/public-shell'
import { LiveMatchesView } from '@/components/live-matches-view'
import { getPublicNavigation } from '@/lib/public-navigation'

export default async function LiveMatchesPage() {
  const navigation = await getPublicNavigation()
  return (
    <PublicShell {...navigation} showAuthLinks={false} showMenuButton={false}>
      <LiveMatchesView />
    </PublicShell>
  )
}
