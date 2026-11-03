import { copyFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const source = process.argv[2]
if (!source) throw new Error('Provide the approved RIVA logo image path.')
const images = path.resolve('public', 'images')
const approved = path.join(images, 'riva-approved-logo.png')
await sharp(source).png().toFile(approved)
const files = await readdir(images)
for (const name of files) {
  if (!/^(riva-padel.*\.(png)|spl-logo\.(jpg)|spl-logo-new\.webp)$/.test(name)) continue
  const size = name.includes('192') ? 192 : name.includes('512') ? 512
    : name.includes('apple-touch') ? 180 : 768
  let image = sharp(approved).resize(size, size, { fit: 'contain', background: '#0b0f19' })
  image = name.endsWith('.jpg') ? image.jpeg() : name.endsWith('.webp') ? image.webp() : image.png()
  await image.toFile(path.join(images, name))
}
await copyFile(path.join(images, 'riva-padel-play-together-compact-icon-512.png'),
  path.resolve('android', 'riva-app', 'res', 'drawable', 'app_icon.png'))
