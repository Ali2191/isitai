// ─── PRNU / sensor-noise & JPEG double-compression forensics ────────────────
// Two of the strongest forensic signals separating camera photos from
// GAN/diffusion output:
//
//  1. PRNU (Photo Response Non-Uniformity): every physical sensor carries a
//     fixed high-frequency noise fingerprint. We estimate it as a Wiener-style
//     high-pass residual and check whether its energy is spatially CONSISTENT
//     across image regions. Generated images have no coherent PRNU — or a
//     patchwork one after inpainting/upscaling.
//
//  2. JPEG double-compression: re-saving a baseline JPEG at quality Q writes
//     DQT tables quantized to multiples of Q. Camera→editor→platform chains
//     leave this signature; diffusion pipelines usually emit single-generation
//     tables (or PIL/ffmpeg flat tables). We also measure 8×8 block-boundary
//     periodicity which doubles as tampering/localization evidence.

import FFT from 'fft.js'

const _fftCache = new Map()
function fftFor(size) {
  if (!_fftCache.has(size)) _fftCache.set(size, new FFT(size))
  return _fftCache.get(size)
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
function sig(label, suspicious) { return { label, suspicious: !!suspicious } }

// ─── High-pass PRNU residual ─────────────────────────────────────────────────
/**
 * Compute a per-pixel PRNU-style residual map: I minus a normalized 5-tap
 * local average (denoised by local variance, Wiener-style), on luminance.
 * Returns { resid: Float32Array(S*S), rms, grid: region RMS array }.
 */
export function prnuResidualMap(gray, S) {
  const resid = new Float32Array(S * S)
  // 5x5 box mean + local variance via separable prefix sums
  const mean = new Float32Array(S * S)
  const varr = new Float32Array(S * S)
  // integral images
  const ii = new Float64Array((S + 1) * (S + 1))
  const ii2 = new Float64Array((S + 1) * (S + 1))
  const idx = (x, y) => (y + 1) * (S + 1) + (x + 1)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = gray[y * S + x]
    ii[idx(x, y)] = v + ii[idx(x - 1, y)] + ii[idx(x, y - 1)] - ii[idx(x - 1, y - 1)]
    ii2[idx(x, y)] = v * v + ii2[idx(x - 1, y)] + ii2[idx(x, y - 1)] - ii2[idx(x - 1, y - 1)]
  }
  const r = 2
  let sumSq = 0, cnt = 0
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(S - 1, x + r)
    const y0 = Math.max(0, y - r), y1 = Math.min(S - 1, y + r)
    const area = (x1 - x0 + 1) * (y1 - y0 + 1)
    const s = ii[idx(x1, y1)] - ii[idx(x0 - 1, y1)] - ii[idx(x1, y0 - 1)] + ii[idx(x0 - 1, y0 - 1)]
    const s2 = ii2[idx(x1, y1)] - ii2[idx(x0 - 1, y1)] - ii2[idx(x1, y0 - 1)] + ii2[idx(x0 - 1, y0 - 1)]
    const m = s / area
    const v = Math.max(s2 / area - m * m, 0)
    mean[y * S + x] = m
    varr[y * S + x] = v
  }
  const sigma2 = medianVar(varr) || 1e-9
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x
    const v = varr[i]
    const w = v / (v + sigma2 * 0.25) // Wiener weight: keep true noise, kill structure
    const d = (gray[i] - mean[i]) * w
    resid[i] = d
    sumSq += d * d; cnt++
  }
  const rms = Math.sqrt(sumSq / cnt)
  return { resid, rms }
}

function medianVar(arr) {
  const step = Math.max(1, Math.floor(arr.length / 4096))
  const sample = []
  for (let i = 0; i < arr.length; i += step) sample.push(arr[i])
  sample.sort((a, b) => a - b)
  return sample[Math.floor(sample.length / 2)]
}

/** Region-level PRNU consistency: split residual map into an R×R grid,
 *  compute per-region RMS, return coefficient of variation + the raw grid
 *  (used later for the localization heatmap). */
export function prnuConsistency(resid, S, R = 4) {
  const cell = Math.floor(S / R)
  const grid = new Float64Array(R * R)
  for (let gy = 0; gy < R; gy++) for (let gx = 0; gx < R; gx++) {
    let s = 0, c = 0
    for (let y = gy * cell; y < (gy + 1) * cell; y++) for (let x = gx * cell; x < (gx + 1) * cell; x++) {
      const v = resid[y * S + x]; s += v * v; c++
    }
    grid[gy * R + gx] = Math.sqrt(s / Math.max(c, 1))
  }
  let m = 0
  for (let i = 0; i < grid.length; i++) m += grid[i]
  m /= grid.length
  let v = 0
  for (let i = 0; i < grid.length; i++) v += (grid[i] - m) ** 2
  v /= grid.length
  return { grid: Array.from(grid), R, mean: m, cv: m > 0 ? Math.sqrt(v) / m : 0 }
}

// ─── Quantization-table analysis (double compression) ────────────────────────
/** Parse all DQT segments from a JPEG buffer. Returns array of { id, precision, table[64] }. */
export function parseDqtSegments(buf) {
  const out = []
  try {
    if (!(buf[0] === 0xff && buf[1] === 0xd8)) return out
    let off = 2
    while (off + 4 <= buf.length) {
      if (buf[off] !== 0xff) break
      const marker = buf[off + 1]
      if (marker === 0xda) break // SOS — entropy-coded data follows
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue }
      const len = (buf[off + 2] << 8) | buf[off + 3]
      if (marker === 0xdb) {
        let p = off + 4
        const end = off + 2 + len
        while (p < end) {
          const pq = buf[p++]
          const prec = pq >> 4
          const id = pq & 0x0f
          const n = prec === 1 ? 128 : 64
          const table = []
          for (let i = 0; i < n / 2; i++) {
            table.push(prec === 1 ? (buf[p + 2 * i] << 8) | buf[p + 2 * i + 1] : buf[p + i])
          }
          out.push({ id, precision: prec, table })
          p += n
        }
      }
      off += 2 + len
    }
  } catch { /* best-effort */ }
  return out
}

/** Heuristic: was this JPEG re-saved by a second encoder?
 *  A quality value Q divides most entries of a "double-compressed" table. */
function detectDoubleCompression(tables) {
  const results = []
  for (const t of tables) {
    const vals = t.table.filter(v => v > 0)
    if (vals.length < 32) continue
    let bestQ = 0, bestFrac = 0
    for (let q = 50; q <= 95; q++) {
      let div = 0
      for (const v of vals) if (v % q === 0) div++
      const frac = div / vals.length
      if (frac > bestFrac) { bestFrac = frac; bestQ = q }
    }
    // In a truly single-encoded random table, divisibility by any specific q≥50
    // is rare; >60% shared divisor is a strong re-save signal.
    if (bestFrac > 0.6) results.push({ quality: bestQ, share: +(bestFrac * 100).toFixed(0) })
  }
  return results
}

// ─── 8×8 block-boundary periodicity (fine-grained, FFT-based) ────────────────
/** Periodicity score: ratio of spectral energy near the k=S/8 harmonic rows/
 *  columns vs neighborhood. Blocking artifacts (single or double compression,
 *  or spliced regions) light up here. Also returns a coarse per-block energy
 *  map usable for localization. */
export function jpegBlockPeriodicity(gray, S) {
  const f = fftFor(S)
  const data = new Float64Array(2 * S), out = new Float64Array(2 * S)
  const ReT = new Float64Array(S * S), ImT = new Float64Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) { data[2 * x] = gray[y * S + x]; data[2 * x + 1] = 0 }
    f.transform(out, data)
    for (let k = 0; k < S; k++) { ReT[y * S + k] = out[2 * k]; ImT[y * S + k] = out[2 * k + 1] }
  }
  const mag = new Float64Array(S * S)
  for (let x = 0; x < S; x++) {
    for (let y = 0; y < S; y++) { data[2 * y] = ReT[y * S + x]; data[2 * y + 1] = ImT[y * S + x] }
    f.transform(out, data)
    for (let k = 0; k < S; k++) {
      const ky = k <= S / 2 ? k : S - k
      mag[x * S + ky] = Math.hypot(out[2 * k], out[2 * k + 1])
    }
  }
  const h = Math.round(S / 8) // harmonic index for 8px period
  let peak = 0, ref = 0
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nearH = (Math.abs(x - h) <= 1) ^ (Math.abs(y - h) <= 1) // one axis on harmonic
    if (nearH) peak += mag[y * S + x]
    else if ((Math.abs(x - h) >= 3 && Math.abs(x - h) <= 6) || (Math.abs(y - h) >= 3 && Math.abs(y - h) <= 6)) ref += mag[y * S + x]
  }
  const ratio = ref > 0 ? (peak / Math.max(1, countNear(mag, S, h))) / (ref / Math.max(1, countRef(mag, S, h))) : 1
  // Per-block boundary gradient map (localization)
  const B = Math.floor(S / 8)
  const blockE = new Float64Array(B * B)
  for (let by = 0; by < B; by++) for (let bx = 0; bx < B; bx++) {
    let e = 0, c = 0
    for (let y = by * 8; y < (by + 1) * 8; y++) {
      const x = bx * 8
      if (x > 0) { e += Math.abs(gray[y * S + x] - gray[y * S + x - 1]); c++ }
    }
    blockE[by * B + bx] = c ? e / c : 0
  }
  return { ratio: ratio || 1, blockEnergy: Array.from(blockE), B }
}

function countNear(mag, S, h) {
  let n = 0
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if ((Math.abs(x - h) <= 1) ^ (Math.abs(y - h) <= 1)) n++
  }
  return n
}
function countRef(mag, S, h) {
  let n = 0
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if ((Math.abs(x - h) >= 3 && Math.abs(x - h) <= 6) || (Math.abs(y - h) >= 3 && Math.abs(y - h) <= 6)) n++
  }
  return n
}

// ─── Combined signal builder ─────────────────────────────────────────────────
/**
 * @param {Float32Array} gray  luminance in [0,1], size S×S (S power of two ≥128)
 * @param {Buffer} buf         original file bytes (for DQT parsing)
 * @returns {{ score:number, signals:Array, maps:{prnuGrid:number[], prnuR:number, blockEnergy:number[], blockB:number, blockRatio:number, prnuCv:number} }}
 */
export function analyzeNoiseAndCompression(gray, S, buf) {
  const signals = []
  let score = 0 // negative → real-photo evidence, positive → synthetic evidence

  // 1. PRNU presence + strength
  const { resid, rms } = prnuResidualMap(gray, S)
  const normRms = rms * 255 // back to 0-255 scale
  if (normRms < 0.35) {
    signals.push(sig(`PRNU/noise floor extremely low (${normRms.toFixed(2)}/255) — no sensor fingerprint`, true))
    score += 18
  } else if (normRms < 0.8) {
    signals.push(sig(`Weak high-frequency residual (${normRms.toFixed(2)}) — denoised or generated surface`, true))
    score += 8
  } else if (normRms > 1.2 && normRms < 9) {
    signals.push(sig(`Sensor-like PRNU residual present (${normRms.toFixed(2)})`, false))
    score -= 10
  } else if (normRms >= 9) {
    signals.push(sig(`Very heavy residual (${normRms.toFixed(1)}) — extreme ISO, grain filter, or re-render`, true))
    score += 4
  }

  // 2. PRNU spatial consistency (inpainting/splice localization)
  const cons = prnuConsistency(resid, S, 4)
  if (cons.mean > 0.0005) {
    if (cons.cv > 0.75) {
      signals.push(sig(`Noise fingerprint inconsistent across regions (CV ${cons.cv.toFixed(2)}) — possible inpaint/splice`, true))
      score += 14
    } else if (cons.cv < 0.3) {
      signals.push(sig(`Noise fingerprint uniform across all regions (CV ${cons.cv.toFixed(2)})`, false))
      score -= 6
    }
  }

  // 3. Double JPEG compression via quantization tables
  const tables = parseDqtSegments(buf)
  const dbl = detectDoubleCompression(tables)
  if (dbl.length) {
    const d = dbl[0]
    signals.push(sig(`JPEG double-compression detected (re-saved ≈ quality ${d.quality}, ${d.share}% shared divisor)`, false))
    score -= 12
  } else if (tables.length) {
    const flat = tables.every(t => t.table.every(v => v === t.table[0]))
    if (flat) {
      signals.push(sig('Flat quantization table — PIL/ffmpeg-style single encode', true))
      score += 8
    }
  }

  // 4. 8×8 block periodicity
  const bp = jpegBlockPeriodicity(gray, S)
  if (bp.ratio > 1.9) {
    signals.push(sig(`Strong 8×8 blocking periodicity (×${bp.ratio.toFixed(2)}) — compression chain typical of cameras/editors`, false))
    score -= 8
  } else if (bp.ratio < 0.75) {
    signals.push(sig(`Absent 8×8 blocking periodicity (×${bp.ratio.toFixed(2)}) — smooth generator output`, true))
    score += 10
  }

  return {
    score: clamp(score, -40, 45),
    signals,
    confidence: Math.abs(score) >= 20 ? 'high' : Math.abs(score) >= 10 ? 'medium' : 'low',
    maps: {
      prnuGrid: cons.grid, prnuR: cons.R, prnuCv: +cons.cv.toFixed(3), prnuRms: +normRms.toFixed(3),
      blockEnergy: bp.blockEnergy, blockB: bp.B, blockRatio: +bp.ratio.toFixed(3),
    },
  }
}
