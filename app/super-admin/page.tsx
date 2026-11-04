import { redirect } from 'next/navigation'
import { SuperAdminDashboard } from '@/components/super-admin-dashboard'
import { createClient } from '@/lib/supabase/server'

type ArenaRow = {
  id: number | string
  name: string | null
  city: string | null
  address: string | null
  country_code: string | null
  is_active: boolean
  courts_count: number | null
}

type KioskRow = {
  id: string
  arena_id: number | string
  court_id: number | string | null
  device_role: string
  name: string
  created_at: string
  revoked_at: string | null
}

type ManagerRow = {
  arena_id: number | string
  user_id: string
  email: string
  created_at: string
}

type AuditRow = {
  id: number
  actor_id: string
  action: string
  target_type: string
  target_id: string | null
  details: Record<string, unknown>
  created_at: string
}

type SupabaseErrorDetails = {
  code: string | null
  message: string
  details: string | null
  hint: string | null
}

export default async function SuperAdminPage() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) redirect('/auth/login?next=%2Fsuper-admin')
  if (user.app_metadata?.role !== 'super_admin') redirect('/profile')

  const [arenaResult, deviceResult, managerResult, auditResult] = await Promise.all([
    supabase.from('arenas')
      .select('id, name, city, address, country_code, is_active, courts_count')
      .order('name'),
    supabase.from('arena_kiosk_devices')
      .select('id, arena_id, court_id, device_role, name, created_at, revoked_at')
      .order('created_at', { ascending: false }),
    supabase.rpc('super_admin_list_arena_managers'),
    supabase.from('super_admin_audit_log')
      .select('id, actor_id, action, target_type, target_id, details, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
  ])
  const failedQuery = [
    { name: 'arény', error: arenaResult.error },
    { name: 'kiosk zariadenia', error: deviceResult.error },
    { name: 'priradenia správcov', error: managerResult.error },
    { name: 'audit log', error: auditResult.error },
  ].find((query) => query.error)

  if (failedQuery?.error) {
    const errorDetails = describeSupabaseError(failedQuery.error)
    console.error(`Super Admin data load failed (${failedQuery.name}):`, errorDetails)
    return <AdminLoadError queryName={failedQuery.name} error={errorDetails} />
  }

  const arenas = ((arenaResult.data ?? []) as ArenaRow[]).map((arena) => ({
    id: String(arena.id),
    name: arena.name ?? 'Aréna',
    city: arena.city ?? '',
    address: arena.address ?? '',
    countryCode: arena.country_code ?? '',
    isActive: arena.is_active,
    courtsCount: Number(arena.courts_count ?? 0),
  }))
  const devices = ((deviceResult.data ?? []) as KioskRow[]).map((device) => ({
    id: device.id,
    arenaId: String(device.arena_id),
    courtId: device.court_id === null ? null : String(device.court_id),
    deviceRole: device.device_role,
    name: device.name,
    createdAt: device.created_at,
    revokedAt: device.revoked_at,
  }))
  const managers = ((managerResult.data ?? []) as ManagerRow[]).map((manager) => ({
    arenaId: String(manager.arena_id),
    userId: manager.user_id,
    email: manager.email,
    createdAt: manager.created_at,
  }))
  const audit = ((auditResult.data ?? []) as AuditRow[]).map((entry) => ({
    id: entry.id,
    actorId: entry.actor_id,
    action: entry.action,
    targetType: entry.target_type,
    targetId: entry.target_id,
    details: entry.details ?? {},
    createdAt: entry.created_at,
  }))

  return <SuperAdminDashboard arenas={arenas} devices={devices} managers={managers} audit={audit} />
}

function describeSupabaseError(error: unknown): SupabaseErrorDetails {
  if (!error || typeof error !== 'object') {
    return { code: null, message: 'Neznáma databázová chyba.', details: null, hint: null }
  }

  const record = error as Record<string, unknown>
  const text = (value: unknown) => typeof value === 'string' ? value : null
  return {
    code: text(record.code),
    message: text(record.message) ?? 'Neznáma databázová chyba.',
    details: text(record.details),
    hint: text(record.hint),
  }
}

function AdminLoadError({ queryName, error }: { queryName: string; error: SupabaseErrorDetails }) {
  const missingRpc = error.code === 'PGRST202'
  return (
    <main className="min-h-screen bg-app-ink px-4 py-10 text-app-fg">
      <section role="alert" className="mx-auto max-w-3xl rounded-2xl border border-red-400/25 bg-app-panel p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-app-league">RIVA / SUPER ADMIN</p>
        <h1 className="mt-3 text-2xl font-black">Panel sa nepodarilo načítať</h1>
        <p className="mt-3 text-sm leading-6 text-app-fg/65">
          Chyba pri načítaní: {queryName}{error.code ? ` (${error.code})` : ''}.
          {' '}{missingRpc
            ? 'Supabase API zatiaľ nevidí funkciu na načítanie správcov. V SQL Editore spusti: NOTIFY pgrst, \'reload schema\'; potom stránku obnov. Ak chyba zostane, over, že migrácia 079 prebehla v tomto projekte.'
            : 'Skontroluj migráciu 079 a oprávnenia Super Admin účtu. Podrobnosti chyby sú v serverových logoch.'}
        </p>
      </section>
    </main>
  )
}
