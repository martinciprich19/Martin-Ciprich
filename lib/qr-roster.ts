export type QrPlayer = { id: string; name: string }
export type QrRoster = [QrPlayer | null, QrPlayer | null, QrPlayer | null, QrPlayer | null]

export function assignQrPlayer(roster: QrRoster, player: QrPlayer, index = roster.findIndex((slot) => slot === null)): QrRoster {
  if (!Number.isInteger(index) || index < 0 || index > 3 || roster[index]) throw new Error('Miesto hráča nie je dostupné.')
  if (roster.some((slot) => slot?.id === player.id)) throw new Error('Tento hráč je už v zápase. Vyber iného hráča.')
  const next: QrRoster = [...roster]
  next[index] = player
  return next
}

export function assignQrPair(roster: QrRoster, players: [QrPlayer, QrPlayer]): { roster: QrRoster; slots: [number, number] } {
  if (players[0].id === players[1].id || players.some((player) => roster.some((slot) => slot?.id === player.id))) {
    throw new Error('Hráč z dvojice je už v zápase.')
  }
  const firstSlot = [0, 2].find((index) => roster[index] === null && roster[index + 1] === null)
  if (firstSlot === undefined) throw new Error('Pre dvojicu musí byť voľný celý tím.')
  const next = assignQrPlayer(assignQrPlayer(roster, players[0], firstSlot), players[1], firstSlot + 1)
  return { roster: next, slots: [firstSlot, firstSlot + 1] }
}
