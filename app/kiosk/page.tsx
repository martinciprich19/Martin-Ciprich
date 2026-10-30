import { Suspense } from 'react'
import { KioskView } from '@/components/kiosk-view'

export default function KioskPage() {
  return (
    <Suspense fallback={null}>
      <KioskView />
    </Suspense>
  )
}
