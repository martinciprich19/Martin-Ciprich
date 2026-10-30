import { getPublicNavigation } from '@/lib/public-navigation'
import HowItWorksView from '@/components/how-it-works-view'

export default async function HowItWorksPage() {
  const navigation = await getPublicNavigation()
  return <HowItWorksView {...navigation} />
}
