import { createClient } from '@/lib/supabase/client'
import { fetchFriendshipStatus } from '@/lib/friendships'
import { withProfileGender } from '@/lib/profile-gender-query'

export type DominantHand = 'right' | 'left' | 'both'
export type Gender = 'male' | 'female'
export type PhoneVisibility = 'everyone' | 'accepted_only' | 'friends_only' | 'private' | 'never'

export type PlayerProfile = {
  id: number
  full_name: string
  email: string
  phone: string
  elo_rating: number
  career_elo: number
  highest_elo: number
  matches_played: number
  matches_won: number
  region: string
  level: string
  bio: string
  avatar_url: string | null
  phone_visibility: PhoneVisibility
  dominant_hand: DominantHand
  gender: Gender | null
  home_venue_id: string | null
  auto_venue_id: string | null
  elo_season_start: string | null
  created_at: string | null
}

export type PlayerProfileInput = Omit<PlayerProfile, 'id' | 'created_at' | 'career_elo' | 'elo_season_start' | 'highest_elo' | 'home_venue_id' | 'auto_venue_id' | 'bio' | 'avatar_url' | 'phone_visibility' | 'gender'> & Partial<Pick<PlayerProfile, 'highest_elo' | 'home_venue_id' | 'auto_venue_id' | 'bio' | 'avatar_url' | 'phone_visibility' | 'gender'>>
export type PlayerProfileUpdate = Partial<PlayerProfileInput>

const LEGACY_PROFILE_COLUMNS = 'id, full_name, email, phone, elo_rating, highest_elo, matches_played, matches_won, region, level, bio, avatar_url, phone_visibility, dominant_hand, home_venue_id, auto_venue_id, created_at'
const PROFILE_COLUMNS = `${LEGACY_PROFILE_COLUMNS}, gender`
const PUBLIC_PROFILE_COLUMNS = 'id, full_name, email, elo_rating, highest_elo, matches_played, matches_won, region, level, gender, avatar_url, home_venue_id, auto_venue_id'
const PUBLIC_PLAYER_PROFILE_COLUMNS = 'id, full_name, email, elo_rating, highest_elo, matches_played, matches_won, region, level, gender, bio, avatar_url, home_venue_id, auto_venue_id'
// Added by migration 034; queries fall back to the columns without them until it is applied.
const SEASON_ELO_COLUMNS = 'career_elo, elo_season_start'

type QueryResult = { data: unknown; error: { code: string; message: string } | null }
async function withSeasonColumns<T extends QueryResult>(run: (columns: string) => PromiseLike<T>, baseColumns: string): Promise<T> {
  const result = await withProfileGender(run, `${baseColumns}, ${SEASON_ELO_COLUMNS}`)
  const missingColumn = result.error && ['42703', 'PGRST204'].includes(result.error.code) && /career_elo|elo_season_start/.test(result.error.message)
  return missingColumn ? withProfileGender(run, baseColumns) : result
}

type ProfileRow = Omit<Partial<PlayerProfile>, 'id' | 'home_venue_id' | 'auto_venue_id'> & {
  id: number | string
  home_venue_id?: number | string | null
  auto_venue_id?: number | string | null
}

function normalizeProfile(row: ProfileRow): PlayerProfile {
  return {
    id: Number(row.id),
    full_name: row.full_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    elo_rating: Number(row.elo_rating ?? 1000),
    career_elo: Number(row.career_elo ?? row.elo_rating ?? 1000),
    highest_elo: Number(row.highest_elo ?? row.elo_rating ?? 1000),
    matches_played: Number(row.matches_played ?? 0),
    matches_won: Number(row.matches_won ?? 0),
    region: row.region ?? '',
    level: row.level ?? '',
    bio: row.bio ?? '',
    avatar_url: row.avatar_url ?? null,
    phone_visibility: row.phone_visibility === 'friends_only' ? 'accepted_only' : row.phone_visibility === 'private' ? 'never' : row.phone_visibility ?? 'accepted_only',
    dominant_hand: row.dominant_hand ?? 'right',
    gender: row.gender === 'male' || row.gender === 'female' ? row.gender : null,
    home_venue_id: row.home_venue_id == null ? null : String(row.home_venue_id),
    auto_venue_id: row.auto_venue_id == null ? null : String(row.auto_venue_id),
    elo_season_start: row.elo_season_start ?? null,
    created_at: row.created_at ?? null,
  }
}

export async function fetchPlayerProfile(email: string): Promise<PlayerProfile | null> {
  const supabase = createClient()
  const { data, error } = await withSeasonColumns((columns) => supabase
    .from('proffiles')
    .select(columns)
    .eq('email', email)
    .maybeSingle(), PROFILE_COLUMNS)
  if (error && ['42703', 'PGRST204'].includes(error.code) && error.message.includes('gender')) {
    const legacy = await withSeasonColumns((columns) => supabase.from('proffiles').select(columns).eq('email', email).maybeSingle(), LEGACY_PROFILE_COLUMNS)
    if (legacy.error) throw legacy.error
    return legacy.data ? normalizeProfile(legacy.data as unknown as ProfileRow) : null
  }
  if (error) throw error
  return data ? normalizeProfile(data as unknown as ProfileRow) : null
}

export async function fetchPublicPlayerProfile(profileId: string): Promise<PlayerProfile | null> {
  const id = Number(profileId)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const { data, error } = await withSeasonColumns((columns) => createClient()
    .from('proffiles')
    .select(columns)
    .eq('id', id)
    .maybeSingle(), PUBLIC_PLAYER_PROFILE_COLUMNS)
  if (error) throw error
  return data ? normalizeProfile(data as unknown as ProfileRow) : null
}

export async function fetchVisiblePlayerPhone(profileId: string): Promise<string | null> {
  const id = Number(profileId)
  if (!Number.isSafeInteger(id) || id <= 0) return null

  const supabase = createClient()
  const { data: target, error } = await supabase
    .from('proffiles')
    .select('phone, phone_visibility')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!target?.phone) return null

  const visibility = (target.phone_visibility ?? 'accepted_only') as PhoneVisibility
  if (visibility === 'private' || visibility === 'never') return null
  if (visibility === 'everyone') return String(target.phone)

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!user?.email) return null

  const viewer = await fetchPlayerProfile(user.email)
  if (!viewer) return null
  if (viewer.id === id) return String(target.phone)

  const friendship = await fetchFriendshipStatus(viewer.id, id)
  return friendship === 'accepted' ? String(target.phone) : null
}

export async function fetchPlayerProfiles({ includeDeleted = false }: { includeDeleted?: boolean } = {}): Promise<PlayerProfile[]> {
  const { data, error } = await withSeasonColumns((columns) => {
    const query = createClient().from('proffiles').select(columns)
    return (includeDeleted ? query : query.not('email', 'like', `%${DELETED_PROFILE_EMAIL_DOMAIN}`)).order('full_name', { ascending: true })
  }, PUBLIC_PROFILE_COLUMNS)
  if (error) throw error
  return ((data ?? []) as unknown as ProfileRow[]).map((row) => normalizeProfile(row))
}

// Resets the seasonal ELO after a season boundary (1. január / 1. júl). No-op otherwise.
export async function refreshSeasonRatings(): Promise<void> {
  const { error } = await createClient().rpc('refresh_season_ratings')
  if (error && error.code !== 'PGRST202') throw error
}

export async function createPlayerProfile(profile: PlayerProfileInput): Promise<void> {
  const { error } = await createClient().from('proffiles').insert(profile)
  if (error && error.code !== '23505') throw error
}

// Accounts deleted via delete_my_account() (migration 037) keep an anonymized profile for
// match history; their e-mail is rewritten to this domain so lists can hide them.
export const DELETED_PROFILE_EMAIL_DOMAIN = '@deleted.spl.invalid'

export async function deleteMyAccount(): Promise<void> {
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!user) throw new Error('Na vymazanie účtu musíš byť prihlásený.')

  const { error: avatarError } = await supabase.storage.from('avatars').remove([`${user.id}/avatar`])
  if (avatarError) console.warn('Profilovú fotku sa nepodarilo odstrániť:', avatarError.message)

  const { error } = await supabase.rpc('delete_my_account')
  if (error) {
    if (error.code === 'PGRST202') throw new Error('Vymazanie účtu ešte nie je v databáze nastavené (spusti migráciu 037_delete_my_account.sql).')
    throw error
  }
  // The auth user no longer exists, so only the local session can be cleared.
  await supabase.auth.signOut({ scope: 'local' })
}

export async function updatePlayerProfile(email: string, updates: PlayerProfileUpdate): Promise<void> {
  const { data, error } = await createClient().from('proffiles').update(updates).eq('email', email).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Profil sa nepodarilo uložiť – databáza nepovolila zmenu tvojho profilu.')
}

export type PlayerPreferences = {
  preferredSide: 'left' | 'right' | 'both'
  racketBrand: string
  emailChallenges: boolean
  emailMatchApproval: boolean
  emailMessages: boolean
  emailTournaments: boolean
  pushAlerts: boolean
  rankingAlerts: boolean
  publicStats: boolean
  allowDirectMessages: boolean
  preferredTimeSlots: string[]
}

export const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  preferredSide: 'both',
  racketBrand: '',
  emailChallenges: true,
  emailMatchApproval: true,
  emailMessages: true,
  emailTournaments: false,
  pushAlerts: true,
  rankingAlerts: true,
  publicStats: true,
  allowDirectMessages: true,
  preferredTimeSlots: ['weekdays'],
}

const BOOLEAN_PREFERENCE_KEYS = ['emailChallenges', 'emailMatchApproval', 'emailMessages', 'emailTournaments', 'pushAlerts', 'rankingAlerts', 'publicStats', 'allowDirectMessages'] as const

export function normalizePlayerPreferences(raw: unknown): PlayerPreferences {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const preferences: PlayerPreferences = { ...DEFAULT_PLAYER_PREFERENCES }
  for (const key of BOOLEAN_PREFERENCE_KEYS) if (typeof source[key] === 'boolean') preferences[key] = source[key]
  if (source.preferredSide === 'left' || source.preferredSide === 'right' || source.preferredSide === 'both') preferences.preferredSide = source.preferredSide
  if (typeof source.racketBrand === 'string') preferences.racketBrand = source.racketBrand.slice(0, 80)
  if (Array.isArray(source.preferredTimeSlots)) preferences.preferredTimeSlots = source.preferredTimeSlots.filter((slot): slot is string => typeof slot === 'string').slice(0, 10)
  return preferences
}

const isMissingSettingsColumn = (error: { code?: string; message?: string }) =>
  ['42703', 'PGRST204'].includes(error.code ?? '') && /settings/.test(error.message ?? '')

export async function fetchPlayerPreferences(email: string): Promise<PlayerPreferences> {
  const { data, error } = await createClient().from('proffiles').select('settings').eq('email', email).maybeSingle()
  if (error) {
    if (isMissingSettingsColumn(error)) {
      console.warn('Stĺpec proffiles.settings chýba – spusti migráciu 036_player_settings.sql.')
      return { ...DEFAULT_PLAYER_PREFERENCES }
    }
    throw error
  }
  return normalizePlayerPreferences(data?.settings)
}

export async function updatePlayerPreferences(email: string, preferences: PlayerPreferences): Promise<PlayerPreferences> {
  const normalized = normalizePlayerPreferences(preferences)
  const { data, error } = await createClient().from('proffiles').update({ settings: normalized }).eq('email', email).select('settings')
  if (error) {
    if (isMissingSettingsColumn(error)) throw new Error('Nastavenia sa nedajú uložiť – v databáze chýba stĺpec proffiles.settings (spusti migráciu 036_player_settings.sql).')
    throw error
  }
  if (!data?.length) throw new Error('Nastavenia sa nepodarilo uložiť – databáza nepovolila zmenu tvojho profilu.')
  return normalizePlayerPreferences(data[0].settings)
}

export async function refreshMyAutoVenue(): Promise<string | null> {
  const { data, error } = await createClient().rpc('refresh_my_auto_venue')
  if (error) throw error
  return data == null ? null : String(data)
}
