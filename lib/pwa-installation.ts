export function installationPlatform(userAgent: string, platform: string, maxTouchPoints: number) {
  const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
  const isSafari = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(userAgent)
  return { isIOS, isSafari }
}
