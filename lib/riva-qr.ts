export function getRivaProfilePath(value: string, origin: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Tento QR kód neobsahuje platný odkaz na profil RIVA.')
  }
  if (url.origin !== origin || url.username || url.password || !/^\/players\/[1-9]\d*$/.test(url.pathname)) {
    throw new Error('Naskenuj osobný QR kód z profilu v tejto aplikácii RIVA.')
  }
  return url.pathname
}
