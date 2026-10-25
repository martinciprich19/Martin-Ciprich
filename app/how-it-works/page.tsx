import { cookies } from 'next/headers'
import HowItWorksView from '@/components/how-it-works-view'

export default async function HowItWorksPage() {
  const kioskMode = (await cookies()).get('riva-kiosk-mode')?.value === '1'
  return <HowItWorksView kioskMode={kioskMode} />
}
