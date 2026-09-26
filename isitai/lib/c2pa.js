// ─── Consumer-facing C2PA / Content Credentials reader ──────────────────────
// Parses C2PA manifests embedded in JPEG/PNG/WebP boxes without external deps.
// Strategy:
//   1. Walk container structure looking for the JUMBF chunk (uuid-based for
//      JPEG `JP2C`-style APP11/uuid box, `jumb` box for PNG c2pa chunk, or
//      WebP `c2pa` RIFF chunk).
//   2. Extract readable claim metadata (title, format, instance id, signature
//      issuer hint, assertion list) via heuristic string scanning of the JUMBF
//      store — full Merkle-verified validation requires c2pa-wasm; we mark
//      verification status honestly as "parsed, not cryptographically verified"
//      unless the c2pa-node package is available.
//   3. Also surface classic provenance signals: EXIF Software/Camera, IPTC,
//      XMP `crs:HasCreatorMetadata`, Google SynthID watermark presence flags.

import exifr from 'exifr'

const JUMBF_UUID_HEX = '4343504a756d62f42e8b11d5ba8d28db' // c2pa JUMBF uuid (as used in JPEG uuid boxes)

function readU32(buf, off) { return buf.length >= off + 4 ? buf.readUInt32BE(off) : NaN }

export function findC2paBoxes(buffer) {
  const found = []
  // PNG: tEXt/iTXt chunk named "c2pa" or eXIf; also the spec's caBX box.
  if (buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47) {
    let off = 8
    while (off + 8 <= buffer.length) {
      const len = readU32(buffer, off)
      const type = buffer.toString('latin1', off + 4, off + 8)
      if (!Number.isFinite(len) || len < 0 || off + 12 + len > buffer.length) break
      if (/caBX|iTXt|tEXt/.test(type)) {
        const body = buffer.subarray(off + 8, off + 8 + len)
        if (body.includes(Buffer.from('c2pa')) || body.includes(Buffer.from('jumb'))) {
          found.push({ container: 'png', type, size: body.length })
        }
      }
      off += 12 + len
    }
  }
  // JPEG: SOI + segments; look for APP11 or APP1-with-uuid containing jumb.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let off = 2
    while (off + 4 <= buffer.length) {
      if (buffer[off] !== 0xff) break
      const marker = buffer[off + 1]
      if (marker === 0xda) break // SOS — stop scanning
      const segLen = readU32(buffer, off + 2) & 0xffff
      const seg = buffer.subarray(off + 4, off + 4 + Math.max(0, segLen - 2))
      if ((marker === 0xeb /* APP11 */ || marker === 0xe1) && seg.includes(Buffer.from('jumb'))) {
        found.push({ container: 'jpeg', marker: marker.toString(16), size: seg.length })
      }
      off += 2 + segLen
    }
  }
  // WebP / generic: search raw bytes for the JUMBF magic.
  if (!found.length) {
    const idx = buffer.indexOf(Buffer.from('jumb'))
    if (idx >= 0) found.push({ container: 'raw-scan', offset: idx, size: Math.min(4096, buffer.length - idx) })
  }
  return found
}

// Heuristic readable fields from a manifest region: scan JSON blobs inside.
function extractReadable(buffer) {
  const out = { assertions: [], generator: null, title: null }
  try {
    const text = buffer.toString('latin1')
    for (const m of text.matchAll(/\{[^{}]{8,2000}\)/g)) {
      let obj
      try { obj = JSON.parse(m[0]) } catch { continue }
      if (obj.title) out.title = String(obj.title).slice(0, 200)
      if (obj.format) out.format = String(obj.format).slice(0, 60)
      if (obj.instance_id) out.instanceId = String(obj.instance_id).slice(0, 120)
      const g = obj.metadata?.softwareAgent || obj.softwareAgent || obj.generator
      if (g) out.generator = String(typeof g === 'object' ? (g.name || '') : g).slice(0, 120)
      if (Array.isArray(obj.assertions)) for (const a of obj.assertions) out.assertions.push(String(a.label || a).slice(0, 60))
      if (obj.actions) for (const a of [].concat(obj.actions)) out.assertions.push(`action:${a?.action || '?'}`)
    }
  } catch { /* best-effort */ }
  return out
}

export async function readProvenance(buffer) {
  const result = {
    fileName: null,
    sizeBytes: buffer.length,
    sha256: null,
    detectedAt: new Date().toISOString(),
    c2pa: { present: false, verified: false, note: 'No C2PA manifest found.' },
    exif: null,
    aiToolSignals: [],
    chain: [],
  }
  const { createHash } = await import('crypto')
  result.sha256 = createHash('sha256').update(buffer).digest('hex')

  // EXIF / XMP / IPTC layer
  try {
    const tags = await exifr.parse(buffer, { xmp: true, iptc: true, ihdr: true })
    if (tags && Object.keys(tags).length) {
      result.exif = {
        make: tags.make || null, model: tags.model || null,
        software: tags.software || tags.ImageSoftware || tags.Software || null,
        createTime: tags.createDate ? new Date(tags.createDate).toISOString() : null,
        modifyTime: tags.modifyDate ? new Date(tags.modifyDate).toISOString() : null,
        artist: tags.artist || tags.creator || null,
        copyright: tags.copyright || null,
        lensModel: tags.lensModel || null,
        gpsPresent: !!(tags.latitude || tags.longitude),
        xmpGenerator: tags.xmp?.['dc:creator'] || tags.Generator || null,
        raw: undefined,
      }
      const sw = (result.exif.software || '').toLowerCase()
      const gen = (result.exif.xmpGenerator || '').toLowerCase()
      for (const hay of [sw, gen]) {
        if (/midjourney|stable diffusion|dall|firefly|flux|adobe firefly|comfyui|sora|runway|pika/.test(hay)) {
          result.aiToolSignals.push(`EXIF/XMP generator names an AI tool: "${hay}"`)
        }
      }
      if (result.exif.make && result.exif.model) {
        result.chain.push({ step: 'Capture', by: `${result.exif.make} ${result.exif.model}`, at: result.exif.createTime })
      }
      if (result.exif.software) {
        result.chain.push({ step: 'Processing', by: result.exif.software, at: result.exif.modifyTime })
      }
    }
  } catch { /* non-critical */ }

  // C2PA layer
  const boxes = findC2paBoxes(buffer)
  if (boxes.length) {
    const readable = extractReadable(buffer)
    result.c2pa = {
      present: true,
      verified: false,
      boxes,
      ...readable,
      note: 'Manifest parsed structurally; cryptographic signature verification requires c2pa-wasm (roadmap). Treat issuer claims as unverified.',
    }
    if (readable.generator) {
      result.chain.push({ step: 'C2PA creation', by: readable.generator, at: null })
      if (/openai|dall|sora|adobe firefly|midjourney|stable|flux/i.test(readable.generator)) {
        result.aiToolSignals.push(`C2PA claim generator is an AI system: ${readable.generator}`)
      }
    }
    if (readable.assertions?.length) result.c2pa.assertionCount = readable.assertions.length
  }

  // SynthID / invisible-watermark availability flag (only detectable via model worker)
  if (process.env.MODEL_WORKER_URL) {
    result.c2pa.synthidCheckAvailable = true
  }
  return result
}
