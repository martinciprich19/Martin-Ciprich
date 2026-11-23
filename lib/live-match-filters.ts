import type { Arena } from './arenas'

export function arenasForRegion(arenas: Arena[], region: string | null, subdivision: string | null): Arena[] {
  if (region === null) return arenas
  return arenas.filter((arena) =>
    (subdivision !== null && arena.subdivision_code === subdivision) ||
    (arena.subdivision_code === null && arena.region === region))
}

export function matchInRegion(
  match: { arena_id: string | number | null; region: string | null },
  arenas: Arena[],
  region: string | null,
  subdivision: string | null,
): boolean {
  if (region === null) return true
  const arena = arenas.find((item) => item.id === String(match.arena_id))
  if (arena) return arenasForRegion([arena], region, subdivision).length > 0
  return match.region === region
}
