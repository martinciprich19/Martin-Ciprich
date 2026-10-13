import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { getQrScanRegion, QR_VIEWFINDER_RATIO } from '../lib/qr-scan-region.ts'

test('viewfinder is a centered square matching 70% of the visible object-cover camera', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [720, 720], [640, 480], [3840, 2160]]) {
    const region = getQrScanRegion(width, height)
    assert.equal(region.width, region.height)
    assert.equal(region.width, Math.round(Math.min(width, height) * QR_VIEWFINDER_RATIO))
    assert.ok(Math.abs(region.x + region.width / 2 - width / 2) <= 0.5)
    assert.ok(Math.abs(region.y + region.height / 2 - height / 2) <= 0.5)
    assert.ok(region.downScaledWidth <= 1024)
    assert.equal(region.downScaledWidth, region.downScaledHeight)
    for (const viewport of [240, 480, 800]) {
      const scale = viewport / Math.min(width, height)
      const left = (viewport - width * scale) / 2 + region.x * scale
      const top = (viewport - height * scale) / 2 + region.y * scale
      assert.ok(Math.abs(left - viewport * 0.15) <= scale)
      assert.ok(Math.abs(top - viewport * 0.15) <= scale)
      assert.ok(Math.abs(region.width * scale - viewport * 0.7) <= scale)
    }
  }
  assert.equal(getQrScanRegion(0, 0).width, 0)
})

test('installed scanner decodes only the cropped viewfinder and does not retry the whole frame', async () => {
  const draws = []
  class Canvas {
    width = 0
    height = 0
    getContext() {
      return { drawImage: (...args) => draws.push(args) }
    }
  }
  class Video { videoWidth = 1920; videoHeight = 1080 }
  class Detector {
    found = true
    async detect() {
      return this.found ? [{ rawValue: 'riva:player:1', cornerPoints: [{ x: 10, y: 10 }] }] : []
    }
  }
  const context = vm.createContext({
    Image: class {}, HTMLVideoElement: Video, HTMLCanvasElement: Canvas,
    SVGImageElement: class {}, Worker: class {}, BarcodeDetector: Detector,
    window: { setTimeout: (...args) => setTimeout(...args).unref(), clearTimeout },
    document: { createElement: () => new Canvas() }, setTimeout, clearTimeout,
  })
  const source = await readFile(new URL('../node_modules/qr-scanner/qr-scanner.min.js', import.meta.url), 'utf8')
  new vm.Script(source.replace('export default e', 'globalThis.Scanner = e')).runInContext(context)
  const detector = new Detector()
  const video = new Video()
  const region = getQrScanRegion(video.videoWidth, video.videoHeight)
  const result = await context.Scanner.scanImage(video, {
    scanRegion: region, qrEngine: detector, returnDetailedScanResult: true,
  })
  assert.equal(result.data, 'riva:player:1')
  assert.deepEqual(draws[0].slice(1), [region.x, region.y, region.width, region.height, 0, 0, region.downScaledWidth, region.downScaledHeight])
  assert.equal(result.cornerPoints[0].x, region.x + 10)
  detector.found = false
  draws.length = 0
  await assert.rejects(context.Scanner.scanImage(video, {
    scanRegion: region, qrEngine: detector, returnDetailedScanResult: true,
  }), (error) => error === `Scanner error: ${context.Scanner.NO_QR_CODE_FOUND}`)
  assert.equal(draws.length, 1)
  assert.deepEqual(draws[0].slice(1, 5), [region.x, region.y, region.width, region.height])
})
