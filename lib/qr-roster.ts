export type QrPlayer = { id: string; name: string }
export type QrRoster = [QrPlayer | null, QrPlayer | null, QrPlayer | null, QrPlayer | null]

export function assignQrPlayer(roster: QrRoster, player: QrPlayer, index = roster.findIndex((slot) => slot === null)): QrRoster {
  if (!Number.isInteger(index) || index < 0 || index > 3 || roster[index]) throw new Error('Miesto hráča nie je dostupné.')
  if (roster.some((slot) => slot?.id === player.id)) throw new Error('Tento hráč je už v zápase. Vyber iného hráča.')
  const next: QrRoster = [...roster]
  next[index] = player
  return next
}
