// ─── Shared server-side analysis pipeline for isitai ────────────────────────
// Used by /api/detect (uploads + URLs) and /api/report (shareable reports).
// Layers: dimensions → JPEG structure → EXIF/XMP/IPTC/C2PA/SynthID metadata →
// pixel forensics (FFT/noise/blocks) → HF model ensemble.

import sharp from 'sharp'
import * as exifr from 'exifr'
import FFT from 'fft.js'
import { hashImage, cacheGet, cacheSet } from './cache.js'
import { explainSignal } from './signals.js'

// fft.js uses an INTERLEAVED complex layout: data = [re0, im0, re1, im1, ...]
// and transform(out, data) with out also interleaved. Helper wraps that.
const _fftCache = new Map()
function fftFor(size) {
  if (!_fftCache.has(size)) _fftCache.set(size, new FFT(size))
  return _fftCache.get(size)
}
/** Forward DFT of a real signal (length must be a power of two). Returns magnitude spectrum length size/2. */
function realFftMagnitudes(signal) {
  const N = signal.length
  const f = fftFor(N)
  const data = new Float64Array(2 * N)
  for (let i = 0; i < N; i++) { data[2 * i] = signal[i]; data[2 * i + 1] = 0 }
  const out = new Float64Array(2 * N)
  f.transform(out, data)
  const m = new Float64Array(N / 2)
  for (let k = 0; k < N / 2; k++) m[k] = Math.hypot(out[2 * k], out[2 * k + 1])
  return m
}

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB upload cap

// ─── helpers ─────────────────────────────────────────────────────────────────
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function medianOf(arr) {
  const a = [...arr].sort((x, y) => x - y)
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ])
}

function sig(label, suspicious) { return { label, suspicious: !!suspicious } }

// ─── 1. Dimensions ───────────────────────────────────────────────────────────
export function analyzeDimensions(width, height) {
  if (!width || !height) return { score: 0, signals: [], confidence: 'none' }
  const signals = []
  let s = 0

  const aiSizes = [
    { w: 512, h: 512, label: 'SD 1.x standard', c: 'high' },
    { w: 768, h: 768, label: 'SD high-res', c: 'high' },
    { w: 1024, h: 1024, label: 'SDXL / DALL-E square', c: 'high' },
    { w: 1024, h: 1792, label: 'DALL-E 3 portrait', c: 'high' },
    { w: 1792, h: 1024, label: 'DALL-E 3 landscape', c: 'high' },
    { w: 1344, h: 768, label: 'Midjourney landscape', c: 'high' },
    { w: 768, h: 1344, label: 'Midjourney portrait', c: 'high' },
    { w: 1216, h: 832, label: 'Midjourney wide', c: 'medium' },
    { w: 832, h: 1216, label: 'Midjourney tall', c: 'medium' },
    { w: 512, h: 768, label: 'SD portrait', c: 'medium' },
    { w: 768, h: 512, label: 'SD landscape', c: 'medium' },
    { w: 1008, h: 1776, label: 'Flux portrait', c: 'high' },
    { w: 1776, h: 1008, label: 'Flux landscape', c: 'high' },
    { w: 1152, h: 896, label: 'SDXL aspect variant', c: 'medium' },
    { w: 896, h: 1152, label: 'SDXL aspect variant', c: 'medium' },
    { w: 1536, h: 1024, label: 'Common diffusion 3:2', c: 'medium' },
    { w: 1024, h: 1536, label: 'Common diffusion 2:3', c: 'medium' },
  ]

  const exact = aiSizes.find(z => z.w === width && z.h === height)
  if (exact) {
    signals.push(sig(`Exact match: ${exact.label} (${width}×${height})`, true))
    s += exact.c === 'high' ? 55 : 35
  } else {
    const m128 = width % 128 === 0 && height % 128 === 0
    const m64 = width % 64 === 0 && height % 64 === 0
    if (m128) { signals.push(sig('Multiples of 128 — common AI output size', true)); s += 20 }
    else if (m64) { signals.push(sig('Multiples of 64 — possible AI output', true)); s += 10 }
    else { signals.push(sig(`Irregular dimensions — real camera pattern (${width}×${height})`, false)); s -= 8 }
  }

  // Generator aspect-ratio presets (approximate)
  const ratios = [
    { r: 13 / 9, label: 'Midjourney 13:9 ultrawide', pts: 12 },
    { r: 9 / 13, label: 'Midjourney 9:13', pts: 12 },
    { r: 4 / 3, label: '4:3 generator default', pts: 6 },
    { r: 3 / 4, label: '3:4 generator default', pts: 6 },
    { r: 1, label: 'Square canvas — most common generator default', pts: 8 },
  ]
  if (!exact) {
    const ar = width / height
    const hit = ratios.find(x => Math.abs(ar - x.r) / x.r < 0.01)
    if (hit && width >= 512) { signals.push(sig(`Aspect ratio ${hit.label}`, true)); s += hit.pts }
  }

  const mp = (width * height) / 1_000_000
  if (mp > 12) { signals.push(sig(`${Math.round(mp)}MP — high-res camera photo`, false)); s -= 12 }
  if (mp < 0.15) { s += 5; signals.push(sig('Very low resolution — upscaled or thumbnail-scale', true)) }

  return {
    score: clamp(s, 0, 90),
    signals,
    confidence: exact ? 'high' : s > 15 ? 'medium' : 'low',
    dimensions: `${width}×${height}`,
  }
}

// ─── 2. JPEG container structure ─────────────────────────────────────────────
function analyzeJpegStructure(buf) {
  const signals = []
  let s = 0
  try {
    if (!(buf[0] === 0xff && buf[1] === 0xd8)) return { score: 0, signals, confidence: 'none' }
    let off = 2
    let sosFound = false, progressive = false, baseline = false
    const tables = {}
    let hasExifApp1 = false, hasXmpApp1 = false, hasIcc = false, hasC2pa = false, hasPhotoshop = false
    while (off + 4 <= buf.length && !sosFound) {
      if (buf[off] !== 0xff) break
      const marker = buf[off + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue }
      const len = (buf[off + 2] << 8) | buf[off + 3]
      const seg = buf.subarray(off + 4, off + 2 + len)
      const str = seg.subarray(0, Math.min(seg.length, 40)).toString('latin1')
      if (marker === 0xda) sosFound = true
      else if (marker === 0xc2) progressive = true
      else if (marker === 0xc0) baseline = true
      else if (marker === 0xdb) tables.q = (tables.q || 0) + 1
      else if (marker === 0xc4) tables.dh = (tables.dh || 0) + 1
      else if (marker === 0xdd) tables.dri = true
      else if (marker === 0xe1) {
        if (str.startsWith('Exif')) hasExifApp1 = true
        else if (str.startsWith('http://ns.adobe.com/xap')) hasXmpApp1 = true
        else if (str.includes('c2pa')) hasC2pa = true
      } else if (marker === 0xe2) {
        if (str.includes('ICC_PROFILE')) hasIcc = true
        else if (str.includes('jumb')) hasC2pa = true // JUMBF box = C2PA manifest store
      } else if (marker === 0xed) {
        if (str.includes('Photoshop 3.0')) hasPhotoshop = true
      }
      off += 2 + len
    }

    if (hasIcc) { signals.push(sig('ICC color profile embedded — editors/cameras write these', false)); s -= 6 }
    if (progressive) { signals.push(sig('Progressive JPEG encoding — web tools more than cameras', true)); s += 4 }
    else if (baseline) { signals.push(sig('Standard baseline JPEG layout', false)) }
    if (hasExifApp1) { signals.push(sig('APP1 EXIF segment present', false)); s -= 3 }
    if (hasXmpApp1) { signals.push(sig('XMP packet present — inspect tags for generator identity', false)); s -= 2 }
    if (hasPhotoshop) { signals.push(sig('Adobe Photoshop resource block present', false)); s -= 4 }
    if (hasC2pa) { signals.push(sig('C2PA manifest store located in the file', false)); s -= 5 }
    if (tables.dri) { signals.push(sig('Restart-interval marker used — characteristic of camera encoders', false)); s -= 5 }
    // Canon EOS bodies ship exactly 4 quantization + 4 Huffman tables
    if (tables.q === 4 && tables.dh === 4) { signals.push(sig('4 quantization + 4 Huffman tables — classic camera encoder layout', false)); s -= 4 }
    else if (tables.q === 1 && tables.dh === 2) { signals.push(sig('Single quantization table — PIL/ffmpeg-style re-encode', true)); s += 6 }
  } catch { /* structure analysis is best-effort */ }
  return { score: clamp(s, -20, 25), signals, confidence: signals.length ? 'medium' : 'none' }
}

// ─── 3. Metadata: EXIF + XMP + IPTC + C2PA + SynthID ─────────────────────────
const AI_TOOL_PATTERNS = [
  'stable diffusion', 'midjourney', 'dall-e', 'dalle', 'firefly', 'gemini', 'openai',
  'runway', 'imagen', 'nightcafe', 'leonardo', 'invokeai', 'automatic1111', 'comfyui',
  'novelai', 'adobe firefly', 'flux.1', 'flux-1', 'black forest labs', 'ideogram',
  'playground ai', 'craiyon', 'partly', 'photoroom ai', 'recraft', 'seedream',
  'grok imagine', 'sora', 'veo', 'wan ', 'hunyuan', 'stablediffusionweb',
  'easy peasy ai', 'pixAI', 'pika labs', 'luma dream machine', 'haiper',
]

function scanTextForAiTools(text) {
  if (!text) return null
  const t = String(text).toLowerCase()
  return AI_TOOL_PATTERNS.find(p => t.includes(p)) || null
}

async function analyzeMetadata(buffer, format) {
  const signals = []
  let rawScore = 0, eq = 0
  let foundAITool = null
  let c2paInfo = null
  let synthId = false
  let gligen = false

  // ── EXIF via exifr ──
  let exif = null
  try {
    exif = await withTimeout(
      exifr.parse(buffer, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: true }),
      4000, 'EXIF parse'
    )
  } catch { exif = null }

  if (!exif || Object.keys(exif).length === 0) {
    signals.push(sig('No EXIF data', true)); signals.push(sig('Real photos always have metadata', true))
    rawScore += 55; eq += 0
  } else {
    const swAll = [exif.Software, exif.software, exif.CreatorTool, exif.ProcessorSoftware,
      exif.ImageEditor, exif.DigitalCamera, exif.Writer].filter(Boolean).join(' · ')
    foundAITool = scanTextForAiTools(swAll)
    if (foundAITool) {
      signals.push(sig(`AI tool: ${exif.Software || exif.CreatorTool || foundAITool}`, true)); rawScore += 95; eq += 60
    } else if (swAll) {
      signals.push(sig(`Software: ${swAll.slice(0, 60)}`, false)); eq += 15
    } else {
      signals.push(sig('No software field', true)); rawScore += 12; eq += 5
    }

    const hasCamera = !!(exif.Make || exif.Model)
    if (hasCamera) {
      signals.push(sig(`${[exif.Make, exif.Model].filter(Boolean).join(' ')}`, false)); rawScore = Math.max(0, rawScore - 20); eq += 25
    } else {
      signals.push(sig('No camera data', true)); rawScore += 18; eq += 8
    }

    if (exif.latitude != null && exif.longitude != null) {
      signals.push(sig(`GPS coordinates recorded`, false)); rawScore = Math.max(0, rawScore - 8); eq += 15
    } else if (exif.GPSInfo || exif.GPSLatitude) {
      signals.push(sig('GPS recorded', false)); rawScore = Math.max(0, rawScore - 8); eq += 15
    } else {
      signals.push(sig('No GPS', true)); rawScore += 8; eq += 5
    }

    if (exif.LensModel) { signals.push(sig(`${exif.LensModel}`, false)); rawScore = Math.max(0, rawScore - 5); eq += 12 }
    else if (exif.FocalLength) { signals.push(sig(`${exif.FocalLength}mm lens`, false)); rawScore = Math.max(0, rawScore - 5); eq += 12 }
    else { signals.push(sig('No lens data', true)); rawScore += 7; eq += 3 }

    if (exif.DateTimeOriginal) { signals.push(sig(`Shot ${new Date(exif.DateTimeOriginal).toLocaleDateString()}`, false)); rawScore = Math.max(0, rawScore - 5); eq += 10 }
    else if (exif.CreateDate) { signals.push(sig(`Created ${new Date(exif.CreateDate).toLocaleDateString()}`, false)); rawScore = Math.max(0, rawScore - 3); eq += 6 }
    else { signals.push(sig('No timestamp', true)); rawScore += 6; eq += 2 }

    if (exif.ExposureTime || exif.ShutterSpeedValue) { signals.push(sig(`Exposure ${exif.ExposureTime ?? exif.ShutterSpeedValue}s`, false)); eq += 8 }
    if (exif.FNumber || exif.ApertureValue) { signals.push(sig(`Aperture f/${exif.FNumber ?? exif.ApertureValue}`, false)); eq += 8 }
    if (exif.ISO) { signals.push(sig(`ISO ${exif.ISO}`, false)); eq += 8 }
    if (exif.Orientation) { signals.push(sig(`${(exif.Orientation * 90) % 360}° · orientation tag`, false)); eq += 4 }
    if (exif.ColorSpace) { signals.push(sig(`Color space tag (${typeof exif.ColorSpace === 'number' ? (exif.ColorSpace === 1 ? 'sRGB' : exif.ColorSpace === 2 ? 'AdobeRGB' : 'uncalibrated') : exif.ColorSpace})`, false)); eq += 4 }
    if (exif.MakerNote) { signals.push(sig('MakerNote present — only camera firmware writes these', false)); rawScore = Math.max(0, rawScore - 10); eq += 15 }
    if (exif.UniqueCameraModel || exif.SerialNumber) { signals.push(sig('Unique Camera ID embedded', false)); eq += 10 }
  }

  // ── XMP / IPTC keyword scan over raw bytes (works even when exifr misses) ──
  const latin = buffer.toString('latin1')
  const lower = latin.toLowerCase()

  // GPT-4o image DocumentID namespace
  if (lower.includes('xmpgptimage') || lower.includes('gpt image') || lower.includes('gpt-image')) {
    signals.push(sig('XMP DocumentID/GPT Image tag', true)); rawScore += 80; eq += 40; foundAITool = foundAITool || 'OpenAI GPT Image'
  }

  // IPTC DigitalSource "artificial intelligent" per C2PA guidance
  if (lower.includes('artificial intelligent') || lower.includes('trainedalgorithmicmodel')) {
    signals.push(sig('IPTC DigitalSource set to "artificial intelligent"', true)); rawScore += 85; eq += 45; foundAITool = foundAITool || 'IPTC AI tag'
  }

  // Generic XMP scan for generator names
  const xmpIdx = lower.indexOf('<x:xmpmeta')
  if (xmpIdx !== -1) {
    const xmpChunk = latin.slice(xmpIdx, xmpIdx + 6000)
    const toolHit = scanTextForAiTools(xmpChunk)
    if (toolHit && !foundAITool) {
      signals.push(sig(`AI tool: ${toolHit} (XMP)`, true)); rawScore += 90; eq += 50; foundAITool = toolHit
    }
    if (/crs:|camera raw settings/i.test(xmpChunk)) {
      signals.push(sig('Camera Raw settings block', false)); rawScore = Math.max(0, rawScore - 10); eq += 20
    }
    if (/photoshop/i.test(xmpChunk) && !foundAITool) { signals.push(sig('Edited in Adobe Photoshop (XMP history)', false)); eq += 10 }
    if (/c2pa/i.test(xmpChunk)) { signals.push(sig('C2PA content credentials present', false)); eq += 20; c2paInfo = { detected: true } }
  }

  // C2PA JUMBF box signature
  if (latin.includes('jumb') && latin.includes('c2pa')) {
    if (!c2paInfo) { signals.push(sig('C2PA content credentials present', false)); eq += 20 }
    c2paInfo = { detected: true }
  }

  // ── Watermark magic strings (documented public markers) ──
  if (lower.includes('synthid')) { signals.push(sig('SynthID watermark detected', true)); rawScore += 90; eq += 50; synthId = true }
  if (lower.includes('gligen')) { signals.push(sig('GLIGEN watermark detected', true)); rawScore += 85; eq += 45; gligen = true }

  // ── TIFF thumbnail heuristic: camera-written EXIF almost always embeds one ──
  if (exif) {
    try {
      const thumb = await withTimeout(exifr.thumbnail(buffer), 3000, 'thumbnail read')
      if (!thumb) {
        signals.push(sig('TIFF thumbnail stripped — generators rewrite EXIF without thumbnails', true))
        rawScore += 8; eq += 4
      } else {
        signals.push(sig('Embedded camera thumbnail intact', false)); eq += 10
      }
    } catch { /* thumbnail unavailable */ }
  }

  const exifWeight = foundAITool || synthId || gligen ? 0.35 : eq >= 60 ? 0.28 : eq >= 35 ? 0.20 : eq >= 15 ? 0.14 : 0.10
  const confidence = foundAITool || synthId || gligen ? 'high' : eq >= 50 ? 'high' : eq >= 25 ? 'medium' : 'low'

  return {
    aiScore: clamp(Math.round(rawScore), 3, 95),
    exifWeight,
    confidence,
    evidenceQuality: eq,
    signals,
    verdict: foundAITool ? 'ai_tool' : synthId ? 'synthid' : hasCameraFlag(exif) ? 'has_camera' : 'no_camera',
    aiTool: foundAITool,
    c2pa: c2paInfo,
    synthId,
    gligen,
    camera: exif ? [exif.Make, exif.Model].filter(Boolean).join(' ') || null : null,
  }
}

function hasCameraFlag(exif) { return !!(exif && (exif.Make || exif.Model)) }

// ─── 4. Pixel forensics (sharp-decoded RGBA + fft.js) ────────────────────────
async function decodePixels(buffer, size = 256) {
  const { data, info } = await sharp(buffer)
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

function luminanceGray(data, w, h, ch) {
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = (0.299 * data[i * ch] + 0.587 * data[i * ch + 1] + 0.114 * data[i * ch + 2]) / 255
  }
  return gray
}

function radialSpectrum(gray, S) {
  // 2D FFT via rows then columns using fft.js (interleaved complex layout)
  const f = fftFor(S)
  const data = new Float64Array(2 * S), out = new Float64Array(2 * S)
  // Re/Im planes for intermediate results
  const ReT = new Float64Array(S * S), ImT = new Float64Array(S * S)
  // rows → frequency domain along x
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) { data[2 * x] = gray[y * S + x]; data[2 * x + 1] = 0 }
    f.transform(out, data)
    for (let k = 0; k < S; k++) { ReT[y * S + k] = out[2 * k]; ImT[y * S + k] = out[2 * k + 1] }
  }
  // columns → full 2D spectrum magnitudes
  const mag = new Float64Array(S * S)
  for (let x = 0; x < S; x++) {
    for (let y = 0; y < S; y++) { data[2 * y] = ReT[y * S + x]; data[2 * y + 1] = ImT[y * S + x] }
    f.transform(out, data)
    for (let k = 0; k < S; k++) {
      const ky = k <= S / 2 ? k : S - k
      mag[x * S + ky] = Math.hypot(out[2 * k], out[2 * k + 1])
    }
  }
  // radial average into log-spaced bins
  const bins = 12
  const sums = new Float64Array(bins), counts = new Int32Array(bins)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x <= S / 2 ? x : S - x, fy = y <= S / 2 ? y : S - y
    const r = Math.sqrt(fx * fx + fy * fy)
    if (r === 0) continue
    const b = Math.min(bins - 1, Math.floor(Math.log2(r) * bins / Math.log2(S)))
    sums[b] += mag[y * S + x]; counts[b]++
  }
  const prof = []
  for (let b = 0; b < bins; b++) if (counts[b] > 0) prof.push(sums[b] / counts[b])
  return prof
}

function fitDecayExponent(prof) {
  // natural images ~ power law P(f) ∝ f^-β with β≈2; generators drift from that
  let sx = 0, sy = 0, sxy = 0, sxx = 0, n = 0
  for (let i = 1; i < prof.length; i++) {
    const x = Math.log(i + 1), y = Math.log(Math.max(prof[i], 1e-9))
    sx += x; sy += y; sxy += x * y; sxx += x * x; n++
  }
  if (n < 3) return null
  return -(n * sxy - sx * sy) / (n * sxx - sx * sx)
}

function gridAutocorrPeak(gray, S) {
  // mean absolute difference along rows at strides 8 and 16 vs stride 1
  function madAt(stride) {
    let sum = 0, cnt = 0
    for (let y = 0; y < S; y += 2) for (let x = stride; x < S; x += 2) {
      sum += Math.abs(gray[y * S + x] - gray[y * S + x - stride]); cnt++
    }
    return cnt ? sum / cnt : 0
  }
  const d1 = madAt(1) || 1e-9
  return { p8: madAt(8) / d1, p16: madAt(16) / d1 }
}

function noiseResidual(data, w, h, ch) {
  // 3x3 median filter residual RMS on luma
  let sum = 0, cnt = 0
  const win = new Float32Array(9)
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    let i = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = ((y + dy) * w + (x + dx)) * ch
      win[i++] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255
    }
    const med = medianOf(win)
    const c = (y * w + x) * ch
    const lum = (0.299 * data[c] + 0.587 * data[c + 1] + 0.114 * data[c + 2]) / 255
    sum += (lum - med) * (lum - med); cnt++
  }
  return cnt ? Math.sqrt(sum / cnt) : 0
}

function blockBoundaryEnergy(gray, S) {
  // avg abs diff across 8px column borders vs within blocks
  let edge = 0, ec = 0, inner = 0, ic = 0
  for (let y = 0; y < S; y++) for (let x = 1; x < S; x++) {
    const d = Math.abs(gray[y * S + x] - gray[y * S + x - 1])
    if (x % 8 === 0) { edge += d; ec++ } else { inner += d; ic++ }
  }
  const e = ec ? edge / ec : 0, i = ic ? inner / ic : 0
  return i > 0 ? e / i : 1
}

function digitRoundBias(data, total) {
  let mod16 = 0
  for (let i = 0; i < total; i++) if (data[i] % 16 === 0) mod16++
  return mod16 / total
}

async function analyzePixels(buffer) {
  const signals = []
  let score = 0
  try {
    const { data, width: w, height: h, channels: ch } = await decodePixels(buffer, 256)
    const S = Math.min(w, h)
    const gray = luminanceGray(data, w, h, ch)

    // FFT band energy ratio (legacy-compatible labels) — real 2D spectrum via fft.js
    const prof = radialSpectrum(gray, S)
    const totalE = prof.reduce((a, b) => a + b, 0) || 1e-9
    const lowE = prof.slice(0, Math.max(1, Math.floor(prof.length / 3))).reduce((a, b) => a + b, 0)
    const highE = prof.slice(Math.floor(prof.length * 2 / 3)).reduce((a, b) => a + b, 0)
    const ratio = lowE > 0 ? highE / lowE : 0
    if (ratio > 0.65) { signals.push(sig('GAN frequency artifacts', true)); score += 40 }
    else if (ratio > 0.42) { signals.push(sig('Elevated high-frequency energy', true)); score += 20 }
    else { signals.push(sig('Natural frequency distribution', false)); score -= 8 }

    // Local variance (texture smoothness)
    let tv = 0; const bs = 16, nb = Math.floor(S / bs)
    for (let by = 0; by < nb; by++) for (let bx = 0; bx < nb; bx++) {
      let s = 0, sq = 0, c = 0
      for (let y = by * bs; y < (by + 1) * bs; y++) for (let x = bx * bs; x < (bx + 1) * bs; x++) {
        const v = gray[y * S + x]; s += v; sq += v * v; c++
      }
      const m = s / c; tv += sq / c - m * m
    }
    const av = tv / (nb * nb)
    if (av < 0.004) { signals.push(sig('Unnaturally smooth texture', true)); score += 28 }
    else if (av > 0.02) { signals.push(sig('Natural texture variance', false)); score -= 5 }

    // Radial spectral decay exponent
    const beta = fitDecayExponent(prof)
    if (beta != null) {
      if (beta < 0.8 || beta > 3.6) { signals.push(sig(`Frequency decay exponent β=${beta.toFixed(2)} outside photographic range (1–3)`, true)); score += 14 }
      else { signals.push(sig(`Frequency decay exponent β=${beta.toFixed(2)} — natural 1/f spectrum`, false)); score -= 4 }
    }

    // Grid periodicity (GAN checkerboard)
    const ac = gridAutocorrPeak(gray, S)
    if (ac.p8 > 1.6 || ac.p16 > 1.6) { signals.push(sig(`Grid autocorrelation peak at 8/16px (×${Math.max(ac.p8, ac.p16).toFixed(2)})`, true)); score += 18 }
    else { signals.push(sig('No periodic upsample-grid artifacts', false)) }

    // Noise residual
    const nr = noiseResidual(data, w, h, ch)
    if (nr < 0.006) { signals.push(sig(`Noise residual very low (${nr.toFixed(4)}) — denoised/smoothed surface`, true)); score += 12 }
    else if (nr > 0.05) { signals.push(sig(`High residual (${nr.toFixed(4)}) — sharpening or heavy grain`, true)); score += 6 }
    else { signals.push(sig(`Noise residual ${nr.toFixed(4)} — plausible sensor noise`, false)); score -= 3 }

    // Block boundary energy
    const bb = blockBoundaryEnergy(gray, S)
    if (bb < 0.55) { signals.push(sig(`Block-boundary energy unusually flat (${bb.toFixed(2)})`, true)); score += 10 }
    else if (bb > 1.4) { signals.push(sig(`JPEG blocking artifacts present (${bb.toFixed(2)}) — typical of camera+encoder pipeline`, false)); score -= 3 }

    // Round-digit bias
    const round = digitRoundBias(data, w * h * ch)
    if (round > 0.115) { signals.push(sig(`Digit-round bias ${(round * 100).toFixed(1)}% (>expected 6.25%)`, true)); score += 10 }

    // Saturation extremes
    let satHi = 0
    for (let i = 0; i < w * h; i++) {
      const r = data[i * ch] / 255, g = data[i * ch + 1] / 255, b = data[i * ch + 2] / 255
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      if (mx > 0 && (mx - mn) / mx > 0.92) satHi++
    }
    const satFrac = satHi / (w * h)
    if (satFrac > 0.08) { signals.push(sig(`Saturation extremes ${(satFrac * 100).toFixed(1)}% of pixels`, true)); score += 8 }
    else if (satFrac < 0.005) { signals.push(sig('Muted palette — unusual for both cameras and generators', false)) }

    // Channel correlation
    let mr = 0, mg = 0, mb = 0
    for (let i = 0; i < w * h; i++) { mr += data[i * ch]; mg += data[i * ch + 1]; mb += data[i * ch + 2] }
    mr /= w * h; mg /= w * h; mb /= w * h
    let covRG = 0, varR = 0, varG = 0
    for (let i = 0; i < w * h; i++) {
      const dr = data[i * ch] - mr, dg = data[i * ch + 1] - mg
      covRG += dr * dg; varR += dr * dr; varG += dg * dg
    }
    const corr = varR && varG ? covRG / Math.sqrt(varR * varG) : 0
    if (corr < 0.55) { signals.push(sig(`Channel correlation r=${corr.toFixed(2)} — decorrelated RGB, unusual for optics`, true)); score += 10 }
    else { signals.push(sig(`Channel correlation r=${corr.toFixed(2)} — normal scene statistics`, false)) }

    // Histogram combing
    const hist = new Int32Array(256)
    for (let i = 0; i < w * h * ch; i += ch) hist[data[i]]++
    let zeros = 0
    for (let v = 10; v < 246; v++) if (hist[v] === 0) zeros++
    if (zeros > 60) { signals.push(sig(`Histogram combing — ${zeros} empty levels`, true)); score += 12 }

    // Highlight clipping
    let clip = 0
    for (let i = 0; i < w * h; i++) if (data[i * ch] >= 254 && data[i * ch + 1] >= 254 && data[i * ch + 2] >= 254) clip++
    const clipFrac = clip / (w * h)
    if (clipFrac > 0.04) { signals.push(sig(`Highlight clipping ${(clipFrac * 100).toFixed(1)}% — digital rolloff`, true)); score += 6 }

    // Edge density uniformity
    let edgeSum = 0, edgeSq = 0, blocks = 0
    for (let by = 0; by < nb; by++) for (let bx = 0; bx < nb; bx++) {
      let e = 0
      for (let y = by * bs + 1; y < (by + 1) * bs; y++) for (let x = bx * bs + 1; x < (bx + 1) * bs; x++) {
        e += Math.abs(gray[y * S + x] - gray[y * S + x - 1]) + Math.abs(gray[y * S + x] - gray[y * S + x - S])
      }
      edgeSum += e; edgeSq += e * e; blocks++
    }
    const em = edgeSum / blocks
    const esd = Math.sqrt(edgeSq / blocks - em * em)
    const cv = em ? esd / em : 0
    if (cv < 0.55) { signals.push(sig(`Edge density CV ${cv.toFixed(2)} — unnaturally uniform detail`, true)); score += 10 }
    else { signals.push(sig(`Edge density CV ${cv.toFixed(2)} — varied natural detail`, false)) }

    return { score: clamp(score, 0, 90), signals, confidence: Math.abs(score) > 28 ? 'high' : Math.abs(score) > 12 ? 'medium' : 'low' }
  } catch {
    return { score: 0, signals: [{ label: 'Pixel analysis unavailable', suspicious: false }], confidence: 'none' }
  }
}

// ─── 5. Hugging Face model ensemble ──────────────────────────────────────────
const DEFAULT_MODELS = [
  { name: 'umm-maybe/AI-image-detector', weight: 0.25 },
  { name: 'haywoodsloan/ai-image-detector-deploy', weight: 0.40 },
  { name: 'umitkaya/deepfake-detector-all-ViT', weight: 0.20 },
  { name: 'shunk0211/deepfake-detection-multimodal', weight: 0.15 },
]

async function callHfModel(model, key, sendBuffer, mimeType, timeoutMs) {
  const res = await fetch(
    `https://router.huggingface.co/hf-inference/models/${model.name}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': mimeType },
      body: sendBuffer,
    }
  )
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 120)}`)
  }
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { throw new Error(`Non-JSON response: ${text.slice(0, 80)}`) }
  if (data.error) throw new Error(String(data.error).slice(0, 120))
  if (!Array.isArray(data)) throw new Error('Unexpected response format')
  const aiEntry = data.find(d => {
    const label = (d.label || '').toLowerCase()
    return label.includes('artificial') || label.includes('fake') || label.includes('ai') ||
      label === 'ai-generated' || label === 'generated' || label === 'deepfake' || label === 'positive'
  })
  if (!aiEntry) throw new Error(`No AI label in: ${data.map(d => d.label).join(', ')}`)
  return {
    name: model.name,
    shortName: model.name.split('/')[1],
    weight: model.weight,
    aiScore: Math.round(aiEntry.score * 100),
    rawLabels: data.map(d => ({ label: d.label, score: Math.round(d.score * 100) })),
  }
}

async function runModels(sendBuffer, mimeType) {
  const key = process.env.HUGGINGFACE_API_KEY
  if (!key) {
    return {
      models: [], failed: ['HUGGINGFACE_API_KEY not configured'],
      degraded: true, degradedReason: 'ML models unavailable (server misconfigured)',
      combined: null, disagreement: false, spread: 0, confidence: 'very_low',
    }
  }
  const enabled = (process.env.DETECT_MODELS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
  const models = enabled.length
    ? DEFAULT_MODELS.filter(m => enabled.some(e => m.name.includes(e)))
    : DEFAULT_MODELS

  const timeoutMs = Number(process.env.MODEL_TIMEOUT_MS || 12000)
  const results = await Promise.allSettled(
    models.map(m => withTimeout(callHfModel(m, key, sendBuffer, mimeType, timeoutMs), timeoutMs, m.name))
  )
  const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value)
  const failed = results.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || r.reason).slice(0, 140))

  if (successful.length === 0) {
    return {
      models: [], failed,
      degraded: true, degradedReason: 'All ML models failed or cold-started',
      combined: null, disagreement: false, spread: 0, confidence: 'very_low',
    }
  }

  const scores = successful.map(m => m.aiScore)
  const spread = successful.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0
  const disagreement = spread > 25
  let adjusted = successful
  if (disagreement && spread > 35 && successful.length > 1) {
    adjusted = successful.map(m => ({
      ...m,
      effectiveWeight: m.name.includes('haywoodsloan') ? 0.75 : 0.25,
      weightAdjusted: m.name.includes('haywoodsloan'),
    }))
  } else {
    adjusted = successful.map(m => ({ ...m, effectiveWeight: m.weight, weightAdjusted: false }))
  }
  const totalWeight = adjusted.reduce((s, m) => s + m.effectiveWeight, 0)
  const combined = Math.round(adjusted.reduce((s, m) => s + m.aiScore * (m.effectiveWeight / totalWeight), 0))
  const variance = adjusted.reduce((s, m) => s + Math.pow(m.aiScore - combined, 2), 0) / adjusted.length
  const stdDev = Math.sqrt(variance)
  const coveragePenalty = successful.length < models.length ? 1 : 0
  const confidence = (stdDev < 8 && !coveragePenalty) ? 'high' : stdDev < 22 ? 'medium' : 'low'

  return {
    models: adjusted.map(m => ({ name: m.name, shortName: m.shortName, weight: m.effectiveWeight, weightAdjusted: m.weightAdjusted, aiScore: m.aiScore })),
    failed, degraded: successful.length < models.length,
    degradedReason: successful.length < models.length ? `${models.length - successful.length} model(s) unavailable — weighted across the rest` : null,
    combined, disagreement, spread, confidence,
  }
}

// ─── Fusion + uncertainty ────────────────────────────────────────────────────
function fuse(modelCombined, exif, dim, jpeg, pix, metaSuspicious) {
  const ew = exif?.exifWeight || 0
  const dw = dim?.confidence === 'high' ? 0.12 : dim?.confidence === 'medium' ? 0.06 : 0
  const pw = pix?.confidence === 'high' ? 0.10 : pix?.confidence === 'medium' ? 0.05 : 0
  const jw = jpeg?.signals?.length ? 0.03 : 0
  const mw = modelCombined == null ? 0 : Math.max(0.52, 1 - ew - dw - pw - jw)
  const total = mw + ew + dw + pw + jw
  if (total === 0) return 50
  // Map JPEG-structure score (-20..+25) onto 0..100 on a gentle slope
  const jpegNorm = clamp(((jpeg?.score || 0) + 20) * 2.2, 0, 100)
  const parts =
    (modelCombined ?? 50) * mw +
    (exif?.aiScore || 0) * ew +
    (dim?.score || 0) * dw +
    (pix?.score || 0) * pw +
    jpegNorm * jw
  let score = Math.round(parts / total)
  // Definitive metadata evidence dominates
  if (metaSuspicious) score = Math.max(score, 92)
  return clamp(score, 1, 99)
}

function uncertaintyBand(score, modelConfidence, layerConfs, degraded, modelsAvailable) {
  // Wider band when layers disagree/confidence low
  const confRank = { high: 0, medium: 1, low: 2, none: 3, very_low: 3 }
  const worst = [...layerConfs.map(c => confRank[c] ?? 3), modelConfidence ? confRank[modelConfidence] : 3, degraded ? 3 : 0]
  const rank = Math.max(...worst)
  let half = [6, 11, 18, 26][rank]
  if (degraded) half += 8
  if (!modelsAvailable) half += 6 // heuristics-only analysis is inherently less certain
  const lo = clamp(score - half, 0, 100)
  const hi = clamp(score + half, 0, 100)
  return { lo, hi, label: `${lo}–${hi}%`, width: hi - lo }
}

function computeVerdict(score, band, degraded, modelsAvailable) {
  const overlapUncertain = band.lo < 60 && band.hi >= 38
  if (!modelsAvailable && score >= 60) return { level: 'uncertain', emoji: '🤔', color: '#eab308', line1: 'Leans AI-generated — but ML models were unavailable' }
  if (!modelsAvailable && score < 60) return { level: 'likely-real', emoji: '✅', color: '#22c55e', line1: 'No strong AI indicators in local forensics (models offline)' }
  if (degraded && score >= 60) return { level: 'likely-ai', emoji: '⚠️', color: '#f97316', line1: 'Likely AI-generated (limited evidence)' }
  if (score >= 85 && band.lo >= 78) return { level: 'definitive-ai', emoji: '🤖', color: '#ef4444', line1: 'This image is AI-generated' }
  if (score >= 60) return { level: 'likely-ai', emoji: '⚠️', color: '#f97316', line1: 'This image appears to be AI-generated' }
  if (overlapUncertain) return { level: 'uncertain', emoji: '🤔', color: '#eab308', line1: "We're uncertain about this image" }
  if (score >= 15) return { level: 'likely-real', emoji: '✅', color: '#22c55e', line1: 'This image appears to be real' }
  return { level: 'definitive-real', emoji: '✅', color: '#22c55e', line1: 'This image is a real photograph' }
}

// ─── Main entry ──────────────────────────────────────────────────────────────
export async function analyzeImage(buffer, mimeType = 'image/jpeg') {
  // Cache lookup (results only — never the image)
  const hash = hashImage(buffer)
  const cached = cacheGet(hash)
  if (cached) return { ...cached, cached: true }

  // Format conversion for models only — no resize/crop (matches HF playground)
  let sendBuffer = buffer
  let imageDimensions = { width: 0, height: 0 }
  let format = mimeType
  try {
    const metadata = await sharp(buffer).metadata()
    imageDimensions = { width: metadata.width || 0, height: metadata.height || 0 }
    format = metadata.format || mimeType
    if (metadata.format && !['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format)) {
      sendBuffer = await sharp(buffer).jpeg({ quality: 92 }).toBuffer()
      format = 'image/jpeg'
    }
  } catch { /* forward raw bytes */ }

  const dim = analyzeDimensions(imageDimensions.width, imageDimensions.height)
  const jpeg = analyzeJpegStructure(buffer)
  const exif = await analyzeMetadata(buffer, format)
  const pix = await analyzePixels(buffer)
  const models = await runModels(sendBuffer, format)

  const metaSuspicious = !!(exif.verdict === 'ai_tool' || exif.synthId || exif.gligen)
  const modelsAvailable = models.models.length > 0
  const score = fuse(models.combined, exif, dim, jpeg, pix, metaSuspicious)
  const band = uncertaintyBand(score, models.confidence, [exif.confidence, dim.confidence, pix.confidence], models.degraded, modelsAvailable)
  const verdict = computeVerdict(score, band, models.degraded, modelsAvailable)

  // Annotate every signal with a plain-language explanation
  const annotate = arr => (arr || []).map(s => ({ ...s, why: explainSignal(s.label) }))
  const layers = {
    models: {
      available: models.models.length > 0,
      degraded: models.degraded,
      reason: models.degradedReason,
      combined: models.combined,
      results: models.models,
      failed: models.failed,
      disagreement: models.disagreement,
      spread: models.spread,
      confidence: models.confidence,
    },
    metadata: { ...exif, signals: annotate(exif.signals) },
    dimensions: { ...dim, signals: annotate(dim.signals) },
    structure: { ...jpeg, signals: annotate(jpeg.signals) },
    pixels: { ...pix, signals: annotate(pix.signals) },
  }

  const result = {
    id: hash.slice(0, 16),
    score,
    band,
    verdict,
    confidence: models.degraded ? 'low' : models.confidence,
    degraded: models.degraded,
    degradedReason: models.degradedReason,
    combined: models.combined,
    imageDimensions,
    layers,
    cached: false,
    analyzedAt: Date.now(),
    privacy: 'Image was analyzed transiently in memory and discarded. Nothing stored.',
  }

  cacheSet(hash, result)
  return result
}

export { MAX_BYTES }
