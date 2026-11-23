// Next dev may normalize the request URL's host to its internal listener.
// The Host header identifies the external host; forwarded headers are not trusted.
export function isAllowedRequestOrigin(request: Request, requireOrigin = false): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return !requireOrigin

  const url = new URL(request.url)
  const host = request.headers.get('host') ?? url.host
  if (!host || /[\/\\?#@\s,]/.test(host)) return false
  try {
    const expected = new URL(`${url.protocol}//${host}`)
    return expected.origin === origin
  } catch {
    return false
  }
}
