import { KioskScreenPreview } from '@/components/kiosk-screen-preview'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function KioskPreviewPage({ params }: { params: Promise<{ courtId: string }> }) {
  const { courtId } = await params
  if (!/^[1-9]\d*$/.test(courtId) || !Number.isSafeInteger(Number(courtId))) return <p>Neplatný kurt.</p>
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) redirect('/auth/login')
  const { error } = await db.rpc('request_kiosk_preview', { p_court_id: courtId })
  if (error) {
    console.error('Kiosk preview access failed:', error)
    return <p>{error.code === '42501' ? 'Nemáš oprávnenie pre tento kurt.' : 'Náhľad nie je dostupný. Over migráciu 083.'}</p>
  }
  return <KioskScreenPreview courtId={courtId} />
}
