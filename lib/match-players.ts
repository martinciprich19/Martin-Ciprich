export const MATCH_PLAYER_FIELDS = ['team1Player1', 'team1Player2', 'team2Player1', 'team2Player2'] as const
export type MatchPlayerField = (typeof MATCH_PLAYER_FIELDS)[number]
export type MatchPlayerSlot = { name: string; id: string }
export type MatchPlayerSlots = Record<MatchPlayerField, MatchPlayerSlot>

export const EMPTY_PLAYER_SLOT: MatchPlayerSlot = { name: '', id: '' }

type PlayerOption = { id: number | string; full_name: string }

export const normalizePlayerName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sk').trim()

export const DUPLICATE_PLAYER_ERROR = 'Tento hráč je už vybraný v inom slote.'

export function validateMatchPlayers(slots: MatchPlayerSlots, players: PlayerOption[]) {
  const errors: Partial<Record<MatchPlayerField, string>> = {}
  const resolvedIds: Partial<Record<MatchPlayerField, string>> = {}
  const identities: Partial<Record<MatchPlayerField, string>> = {}
  const missing: MatchPlayerField[] = []

  for (const field of MATCH_PLAYER_FIELDS) {
    const name = slots[field].name.trim()
    const selectedId = slots[field].id
    if (!name) {
      missing.push(field)
      continue
    }
    const normalized = normalizePlayerName(name)
    const byId = selectedId ? players.find((player) => String(player.id) === selectedId) : undefined
    const byName = players.filter((player) => normalizePlayerName(player.full_name) === normalized)
    const resolved = byId ?? (byName.length === 1 ? byName[0] : undefined)
    if (resolved) resolvedIds[field] = String(resolved.id)
    else if (players.length) errors[field] = byName.length > 1 ? 'Meno nie je jednoznačné – vyber hráča zo zoznamu.' : 'Vyber registrovaného hráča zo zoznamu.'
    // Unresolved typed names are still compared by name so duplicates can't slip through.
    identities[field] = resolved ? `id:${resolved.id}` : `name:${normalized}`
  }

  const duplicateFields = new Set<MatchPlayerField>()
  MATCH_PLAYER_FIELDS.forEach((field, index) => {
    const identity = identities[field]
    if (!identity) return
    MATCH_PLAYER_FIELDS.slice(index + 1).forEach((other) => {
      if (identities[other] === identity) { duplicateFields.add(field); duplicateFields.add(other) }
    })
  })
  duplicateFields.forEach((field) => { errors[field] = DUPLICATE_PLAYER_ERROR })
  missing.forEach((field) => { errors[field] = 'Vyber hráča.' })

  const hasDuplicates = duplicateFields.size > 0
  return {
    errors,
    resolvedIds,
    missing,
    hasDuplicates,
    summary: hasDuplicates ? 'Každý hráč môže byť v zápase iba raz. Oprav zvýraznené sloty.' : '',
    isValid: Object.keys(errors).length === 0,
  }
}
