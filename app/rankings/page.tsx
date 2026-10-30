import { getPublicNavigation } from '@/lib/public-navigation'
import { PublicShell } from '@/components/public-shell'
import { RankingsView } from '@/components/rankings-view'

export default async function RankingsPage() {
  const navigation = await getPublicNavigation()
  return <PublicShell {...navigation}><RankingsView publicView /></PublicShell>
}
