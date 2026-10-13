export const QR_VIEWFINDER_RATIO = 0.7

export function getQrScanRegion(videoWidth: number, videoHeight: number) {
  const size = Math.round(Math.min(videoWidth, videoHeight) * QR_VIEWFINDER_RATIO)
  return {
    x: Math.round((videoWidth - size) / 2),
    y: Math.round((videoHeight - size) / 2),
    width: size,
    height: size,
    downScaledWidth: Math.min(size, 1024),
    downScaledHeight: Math.min(size, 1024),
  }
}
