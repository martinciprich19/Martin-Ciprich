import { createClient } from '@/lib/supabase/client'

export type Arena = {
  id: string
  name: string
  address: string
  city: string
  courtsCount: number
  openingHoursWeekday: string
  openingHoursWeekend: string
  openingHoursNote: string
  isHomeClub?: boolean
}

type ArenaRow = {
  id: string | number
  name: string | null
  address: string | null
  city: string | null
  courts_count: number | null
  opening_hours_weekday: string | null
  opening_hours_weekend: string | null
  opening_hours_note: string | null
}

function fromRow(row: ArenaRow): Arena {
  return {
    id: String(row.id),
    name: row.name ?? '',
    address: row.address ?? '',
    city: row.city ?? '',
    courtsCount: Number(row.courts_count ?? 0),
    openingHoursWeekday: row.opening_hours_weekday ?? '',
    openingHoursWeekend: row.opening_hours_weekend ?? '',
    openingHoursNote: row.opening_hours_note ?? '',
  }
}

export async function fetchArenas(): Promise<Arena[]> {
  const { data, error } = await createClient()
    .from('arenas')
    .select('id, name, address, city, courts_count, opening_hours_weekday, opening_hours_weekend, opening_hours_note')
    .order('name', { ascending: true })
  if (error) throw error
  return ((data ?? []) as ArenaRow[]).map(fromRow)
}