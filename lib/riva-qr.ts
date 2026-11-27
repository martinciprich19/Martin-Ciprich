export function getRivaPairId(value: string): string | null {
  const match = value.trim().match(/^riva:pair:([1-9]\d*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  return match ? match[1].toLowerCase() : null
}

export function getRivaProfilePath(value: string, origin: string): string {
  const text = value.trim()
  const playerId = text.match(/^(?:riva[:/]players?[:/]|riva:)?([1-9]\d*)$/i)?.[1]
  if (playerId) return `/players/${playerId}`

  const candidate = /^(?:https?:)?\/\//i.test(text) || text.startsWith('/')
    ? text
    : /^players\//i.test(text)
      ? `/${text}`
      : /^[^\s/:?#]+\.[^\s/]+\/players\//i.test(text)
        ? `https://${text}`
        : text
  let url: URL
  try {
    url = new URL(candidate, origin)
  } catch {
    throw new Error('Tento QR kód neobsahuje platný odkaz na profil RIVA.')
  }
  const profile = url.pathname.match(/^\/players\/([1-9]\d*)\/?$/i)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !profile) {
    throw new Error('QR kód musí obsahovať odkaz /players/ID alebo číselné ID hráča.')
  }
  // QR codes from another deployment identify a player, never an external navigation target.
  return `/players/${profile[1]}`
}
