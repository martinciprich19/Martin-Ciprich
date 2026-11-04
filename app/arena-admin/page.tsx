import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArenaAdminDashboard } from '@/components/arena-admin-dashboard'
import { createClient } from '@/lib/supabase/server'

type ArenaRow = {
  id: number | string
  name: string | null
  city: string | null
  address: string | null
  country_code: string | null
}

export default async function ArenaAdminPage() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) redirect('/auth/login?next=%2Farena-admin')

  const { data: assignments, error: assignmentError } = await supabase
    .from('arena_admins')
    .select('arena_id')
    .eq('user_id', user.id)

  if (assignmentError) {
    console.error('Could not load arena manager assignments:', assignmentError)
    return <AdminMessage message="Priradenie správcu sa nepodarilo načítať. Skontroluj, či je spustená migrácia 071." />
  }

  const arenaIds = (assignments ?? []).map((assignment) => String(assignment.arena_id))
  const isSuperAdmin = user.app_metadata?.role === 'super_admin'
  if (!isSuperAdmin && arenaIds.length === 0) {
    return <AdminMessage message="Tento účet zatiaľ nemá priradenú žiadnu arénu. Prístup musí prideliť vlastník aplikácie." />
  }

  let arenaQuery = supabase
    .from('arenas')
    .select('id, name, city, address, country_code')
  if (!isSuperAdmin) arenaQuery = arenaQuery.in('id', arenaIds)
  const { data: rows, error: arenaError } = await arenaQuery.order('name')

  if (arenaError) {
    console.error('Could not load assigned arenas:', arenaError)
    return <AdminMessage message="Údaje priradených arén sa nepodarilo načítať." />
  }

  const arenas = ((rows ?? []) as ArenaRow[]).map((arena) => ({
    id: String(arena.id),
    name: arena.name ?? 'Aréna',
    city: arena.city ?? '',
    address: arena.address ?? '',
    countryCode: arena.country_code ?? '',
  }))

  if (arenas.length === 0) {
    return <AdminMessage message="Priradená aréna sa nenašla alebo už nie je dostupná." />
  }

  return <ArenaAdminDashboard arenas={arenas} />
}

function AdminMessage({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-app-ink px-4 py-10 text-app-fg">
      <div className="mx-auto max-w-3xl rounded-2xl border border-app-line/10 bg-app-panel p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-app-league">RIVA / SPRÁVA ARÉNY</p>
        <h1 className="mt-3 text-2xl font-black">Správcovský panel</h1>
        <p role="status" className="mt-4 text-sm leading-6 text-app-fg/65">{message}</p>
        <Link href="/profile" className="mt-6 inline-flex rounded-lg border border-app-line/15 px-4 py-2 text-sm font-bold hover:border-[#ccff00]/50">
          Späť do aplikácie
        </Link>
      </div>
    </main>
  )
}
