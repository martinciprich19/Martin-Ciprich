'use client'

import { PublicShell } from '@/components/public-shell'
import { TournamentsView } from '@/components/tournaments-view'

export default function TournamentsPage() {
  return <PublicShell><TournamentsView publicView /></PublicShell>
}
