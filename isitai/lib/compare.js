import sharp from 'sharp'
import * as exifr from 'exifr'
import { hashImage } from './cache.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function metadataChanges(left, right) {
  const keys = ['Make', 'Model', 'LensModel', 'DateTimeOriginal', 'Software', 'CreateDate', 'ModifyDate', 'Artist', 'Copyright', 'GPSLatitude', 'GPSLongitude']
  return keys.flatMap(key => {
    const a = left?.[key] == null ? null : String(left[key])
    const b = right?.[key] == null ? null : String(right[key])
    return a === b ? [] : [{ key, original: a, suspected: b }]
  })
}

export async function compareImages(original, suspected, originalMime = 'image/jpeg', suspectedMime = 'image/jpeg') {
  const [a, b] = await Promise.all([
    sharp(original).removeAlpha().resize({ width: 512, height: 512, fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }),
    sharp(suspected).removeAlpha().resize({ width: 512, height: 512, fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }),
  ])
  const tileSize = 32
  const tiles = []
  let total = 0
  for (let ty = 0; ty < 16; ty++) for (let tx = 0; tx < 16; tx++) {
    let sum = 0, count = 0
    for (let y = ty * tileSize; y < (ty + 1) * tileSize; y++) for (let x = tx * tileSize; x < (tx + 1) * tileSize; x++) {
      const i = (y * 512 + x) * 3
      sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
      count += 3
    }
    const delta = +(sum / count / 255).toFixed(3)
    total += delta
    tiles.push(delta)
  }
  const meanDelta = total / tiles.length
  const changed = tiles.filter(v => v >= 0.08).length
  const [originalMeta, suspectedMeta] = await Promise.all([
    exifr.parse(original, { tiff: true, xmp: true, iptc: true }).catch(() => ({})),
    exifr.parse(suspected, { tiff: true, xmp: true, iptc: true }).catch(() => ({})),
  ])
  const [originalInfo, suspectedInfo] = await Promise.all([sharp(original).metadata(), sharp(suspected).metadata()])
  const sizeDelta = suspected.length - original.length
  const score = Math.round(clamp(meanDelta * 120 + changed / 256 * 25 + (sizeDelta > 0 ? 3 : 0), 0, 99))
  const bandHalf = changed < 3 ? 24 : 16
  return {
    kind: 'image-comparison',
    id: `${hashImage(original).slice(0, 8)}-${hashImage(suspected).slice(0, 8)}`,
    score,
    band: { lo: Math.max(0, score - bandHalf), hi: Math.min(100, score + bandHalf), label: `${Math.max(0, score - bandHalf)}–${Math.min(100, score + bandHalf)}%` },
    verdict: score >= 60 ? { level: 'likely-edited', line1: 'Meaningful differences detected' } : score >= 25 ? { level: 'uncertain', line1: 'Some differences detected' } : { level: 'likely-same', line1: 'Images are visually close' },
    confidence: changed >= 8 ? 'medium' : 'low',
    degraded: true,
    degradedReason: 'Difference mapping is a forensic comparison aid, not proof of who made an edit.',
    changedTiles: changed,
    meanDelta: +meanDelta.toFixed(3),
    heatmap: tiles,
    metadataChanges: metadataChanges(originalMeta, suspectedMeta),
    compression: {
      original: { format: originalInfo.format, width: originalInfo.width, height: originalInfo.height, bytes: original.length },
      suspected: { format: suspectedInfo.format, width: suspectedInfo.width, height: suspectedInfo.height, bytes: suspected.length },
      byteDelta: sizeDelta,
    },
    signals: [
      { label: `${changed} of 256 regions differ above the comparison threshold`, suspicious: changed >= 8 },
      { label: `Mean normalized pixel delta: ${meanDelta.toFixed(3)}`, suspicious: meanDelta >= 0.08 },
      ...metadataChanges(originalMeta, suspectedMeta).map(change => ({ label: `Metadata changed: ${change.key}`, suspicious: true })),
    ],
    privacy: 'Both images were compared in memory and discarded. No image bytes are stored.',
  }
}
