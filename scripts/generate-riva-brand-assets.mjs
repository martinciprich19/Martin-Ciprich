import { readdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const source = process.argv[2]
const images = path.resolve('public', 'images')
const approved = path.join(images, 'riva-approved-logo.png')
if (source) await sharp(source).png().toFile(approved)
const { data, info } = await sharp(approved).removeAlpha().raw().toBuffer({ resolveWithObject: true })
let left = info.width
let right = -1
let top = info.height
let bottom = -1
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * info.channels
    if (Math.max(data[offset], data[offset + 1], data[offset + 2]) <= 150) continue
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
}
if (right < left || bottom < top) throw new Error('Approved logo has no visible artwork.')
// Share the launcher's readable artwork scale across every branded surface.
const size = Math.ceil(Math.max(right - left + 1, bottom - top + 1) / 0.83)
const cropLeft = Math.floor((left + right + 1 - size) / 2)
const cropTop = Math.floor((top + bottom + 1 - size) / 2)
if (cropLeft < 0 || cropTop < 0 || cropLeft + size > info.width || cropTop + size > info.height) {
  throw new Error('Approved logo cannot fit the compact icon without cropping artwork.')
}
const crop = { left: cropLeft, top: cropTop, width: size, height: size }
const files = await readdir(images)
for (const name of files) {
  if (!/^(riva-padel.*\.(png)|spl-logo\.(jpg)|spl-logo-new\.webp)$/.test(name)) continue
  const outputSize = name.includes('192') ? 192 : name.includes('512') ? 512
    : name.includes('apple-touch') ? 180 : 768
  let image = sharp(approved).extract(crop).resize(outputSize, outputSize)
  image = name.endsWith('.jpg') ? image.jpeg() : name.endsWith('.webp') ? image.webp() : image.png()
  await image.toFile(path.join(images, name))
}
await sharp(approved).extract(crop)
  .resize(512, 512).png()
  .toFile(path.resolve('android', 'riva-app', 'res', 'drawable', 'app_icon.png'))
