import { fetchPlayerProfiles, type PlayerProfile } from '@/lib/profiles'

export const PLAYER_LEVELS = ['Začiatočník', 'Mierne pokročilý', 'Pokročilý', 'Expert'] as const
export type PlayerLevel = (typeof PLAYER_LEVELS)[number]

export type LeaguePlayer = {
  id: string
  name: string
  email: string
  region: string
  level: string
  elo: number
  matchesPlayed: number
  wins: number
  losses: number
  avatarUrl: string | null
  gender: PlayerProfile['gender']
}

export type PlayerFilters = {
  search: string
  region: string
  level: string
  eloMin: string
  eloMax: string
}

export const MAX_ELO = 10000

export const emptyPlayerFilters: PlayerFilters = { search: '', region: '', level: '', eloMin: '', eloMax: '' }

function normalizeFilterValue(value: string) {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').replace(/\s*kraj$/i, '').toLowerCase()
}

function toPlayer(row: PlayerProfile): LeaguePlayer {
  return {
    id: String(row.id),
    name: row.full_name,
    email: row.email,
    region: row.region,
    level: row.level,
    elo: row.elo_rating,
    matchesPlayed: row.matches_played,
    wins: row.matches_won,
    losses: Math.max(0, row.matches_played - row.matches_won),
    avatarUrl: row.avatar_url,
    gender: row.gender,
  }
}

// select('*') keeps the query working whether or not optional columns (email, level) exist yet.
export async function fetchLeaguePlayers(): Promise<LeaguePlayer[]> {
  return (await fetchPlayerProfiles())
    .map(toPlayer)
    .filter((player) => player.id && player.name.trim().length > 0)
    .sort((a, b) => b.elo - a.elo || b.wins - a.wins)
}

export function filterPlayers(players: LeaguePlayer[], filters: PlayerFilters, excludeId?: string) {
  const query = filters.search.trim().toLowerCase()
  const min = filters.eloMin === '' ? -Infinity : Number(filters.eloMin)
  const max = filters.eloMax === '' ? Infinity : Math.min(MAX_ELO, Number(filters.eloMax))
  return players
    .filter((player) => player.id !== excludeId)
    .filter((player) => !query || player.name.toLowerCase().includes(query))
    .filter((player) => !filters.region || normalizeFilterValue(player.region) === normalizeFilterValue(filters.region))
    .filter((player) => !filters.level || normalizeFilterValue(player.level) === normalizeFilterValue(filters.level))
    .filter((player) => player.elo >= min && player.elo <= max)
    .sort((a, b) => b.elo - a.elo || b.wins - a.wins)
}
