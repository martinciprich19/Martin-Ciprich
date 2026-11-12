export function normalizeRankingRegion(value: string) {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase().replace(/\s*kraj$/, '').trim()
}

export function compareRankingPlayers(first: { elo: number; wins: number }, second: { elo: number; wins: number }) {
  return second.elo - first.elo || second.wins - first.wins
}

export function profileRankingPositions(
  profiles: { id: number; full_name: string; region: string; elo_rating: number; matches_won: number }[],
  profileId: number,
) {
  const players = profiles.filter((profile) => profile.full_name.trim().length > 0)
    .map((profile) => ({ ...profile, elo: profile.elo_rating, wins: profile.matches_won }))
    .sort(compareRankingPlayers)
  const nationalIndex = players.findIndex((player) => player.id === profileId)
  if (nationalIndex < 0) return { national: null, regional: null }
  const region = normalizeRankingRegion(players[nationalIndex].region)
  const regionalIndex = region
    ? players.filter((player) => normalizeRankingRegion(player.region) === region).findIndex((player) => player.id === profileId)
    : -1
  return { national: nationalIndex + 1, regional: regionalIndex < 0 ? null : regionalIndex + 1 }
}
