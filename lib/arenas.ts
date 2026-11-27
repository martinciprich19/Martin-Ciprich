import { createClient } from '@/lib/supabase/client'
import type { CountryCode } from '@/lib/countries'

export type Arena = {
  id: string
  name: string
  address: string
  city: string
  courtsCount: number
  openingHoursWeekday: string
  openingHoursWeekend: string
  openingHoursNote: string
  bookingUrl: string | null
  isHomeClub?: boolean
  country_code: CountryCode
  subdivision_code: string | null
  region?: string | null
}

type ArenaRow = {
  country_code: CountryCode
  subdivision_code: string | null
  region: string | null
  id: string | number
  name: string | null
  address: string | null
  city: string | null
  courts_count: number | null
  opening_hours_weekday: string | null
  opening_hours_weekend: string | null
  opening_hours_note: string | null
  booking_url: string | null
}

export function isValidBookingUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return /^https:\/\/[^/@\s?#]+([/?#][^\s]*)?$/i.test(value) && url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && !value.includes('\\') && value.length <= 2048
  } catch {
    return false
  }
}

function fromRow(row: ArenaRow): Arena {
  if (row.booking_url && !isValidBookingUrl(row.booking_url)) {
    console.warn('Aréna obsahuje neplatný rezervačný odkaz:', row.id)
  }
  return {
    id: String(row.id),
    name: row.name ?? '',
    address: row.address ?? '',
    city: row.city ?? '',
    courtsCount: Number(row.courts_count ?? 0),
    openingHoursWeekday: row.opening_hours_weekday ?? '',
    openingHoursWeekend: row.opening_hours_weekend ?? '',
    openingHoursNote: row.opening_hours_note ?? '',
    bookingUrl: row.booking_url && isValidBookingUrl(row.booking_url) ? row.booking_url : null,
    country_code: row.country_code,
    subdivision_code: row.subdivision_code,
    region: row.region,
  }
}

export async function fetchArenas(country?: CountryCode): Promise<Arena[]> {
  let query = createClient()
    .from('arenas')
    .select('id, country_code, subdivision_code, region, name, address, city, courts_count, opening_hours_weekday, opening_hours_weekend, opening_hours_note, booking_url')
    .eq('is_active', true)
  if (country) query = query.eq('country_code', country)
  const { data, error } = await query
    .order('name', { ascending: true })
  if (error) throw error
  return ((data ?? []) as ArenaRow[]).map(fromRow)
}