export type MatchAvatars = readonly [string | null, string | null, string | null, string | null]

export function parseMatchAvatars(value: unknown): MatchAvatars {
  if (!Array.isArray(value) || value.length !== 4) throw new Error('Neplatné profilové fotky účastníkov zápasu.')
  const urls: [string | null, string | null, string | null, string | null] = [null, null, null, null]
  const seen = new Set<number>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') throw new Error('Neplatné údaje hráča zápasu.')
    const row = entry as Record<string, unknown>
    const slot = row.player_slot
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 3 || seen.has(slot)
      || (row.avatar_url !== null && typeof row.avatar_url !== 'string')) throw new Error('Neplatné priradenie fotky hráča.')
    seen.add(slot)
    urls[slot] = row.avatar_url
  }
  return urls
}
