import { getPublicNavigation } from '@/lib/public-navigation'
import { PublicShell } from '@/components/public-shell'
import { TournamentsView } from '@/components/tournaments-view'

export default async function TournamentsPage() {
  const navigation = await getPublicNavigation()
  return <PublicShell {...navigation}><TournamentsView publicView kioskView={navigation.kioskMode} /></PublicShell>
}
