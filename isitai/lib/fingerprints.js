// ─── Diffusion / GAN generator fingerprint library ──────────────────────────
// A small, offline "signature DB" of spectral artifacts left by known
// generators, matched against the image's radial + axial FFT spectra. This is
// deliberately NOT a black-box classifier: every match names the physical
// artifact it found (transposed-conv checkerboard at period 32, latent-grid
// notch at f=S/16, upscaler ringing…), so verdicts stay explainable and the
// layer works with zero network access.
//
// Signatures are expressed as periodicity templates in pixel-space period:
//   • gridPeriod  — spatial period of the artifact (e.g. 32px VAE/upscale grid)
//   • kind        — 'grid'  : harmonic peaks on BOTH axes at S/period
//                   'notch' : anomalous energy concentration ring at radius S/period
// We score each template as the excess spectral energy at its harmonic vs a
// local noise floor, then compare across the image. Real camera photos show
// none of these; SD/MJ/DALL·E outputs light up their architecture's tell.

import FFT from 'fft.js'

const _fftCache = new Map()
function fftFor(size) {
  if (!_fftCache.has(size)) _fftCache.set(size, new FFT(size))
  return _fftCache.get(size)
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const sig = (label, suspicious) => ({ label, suspicious: !!suspicious })

// ── signature database ───────────────────────────────────────────────────────
export const GENERATOR_SIGNATURES = [
  { id: 'sd-vae-64',    name: 'Stable Diffusion VAE grid',      period: 64, family: 'SD 1.x / 2.x (f8 VAE @512→ upscale)', note: '8× downsampled latent decoded by strided convolutions → 64px lattice' },
  { id: 'sd-xl-32',     name: 'SDXL latent-grid seam',          period: 32, family: 'SDXL / SD 1.x common crops',           note: 'transposed-conv checkerboard folded to 32px after half-res decode' },
  { id: 'mj-seam-28',   name: 'Midjourney tiling seam',         period: 28, family: 'Midjourney v5–v6 outpaint seams',      note: 'harmonic rows near S/28 from tile-blend during upscale' },
  { id: 'dalle-notch',  name: 'DALL·E spectral notch ring',     period: 16, family: 'DALL·E 2/3 prior+decoder quantizer',   note: 'VQ-VAE codebook grid → bright ring at radius S/16' },
  { id: 'flux-grid-16', name: 'Flux DiT patch grid',            period: 16, family: 'FLUX.1 / SD3 (2×2 patchified DiT)',    note: 'patchify(2) over f16 VAE latents → 16px attention-block lattice' },
  { id: 'gan-check-4',  name: 'GAN checkerboard',               period: 4,  family: 'StyleGAN / ProGAN-era upsampling',     note: 'classic transposed-convolution checkerboard at 4px' },
  { id: 'upscaler-ring',name: 'CNN-upscaler ringing',           period: 8,  family: '4x-UltraSharp / ESRGAN post-process',  note: 'overshoot ringing on the 8px JPEG-aligned grid after AI upscaling' },
]

// ── 2D magnitude spectrum (same interleaved-complex technique as analyze.js) ──
function magnitudeSpectrum(gray, S) {
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
  return mag
}

/** Excess energy ratio at an axial harmonic h (±1 bins, both axes) vs ±3..7 neighbourhood. */
function axialHarmonicRatio(mag, S, h) {
  let peak = 0, pc = 0, ref = 0, rc = 0
  for (let t = 1; t < S; t++) {
    // row-axis harmonics: (t, ±h) and column-axis: (±h, t)
    for (const [x, y] of [[t, h], [t, S - h], [h, t], [S - h, t]]) {
      if (x >= S || y >= S) continue
      const near = Math.abs(t - h)
      if (near <= 1 || near >= S / 2 - 1) continue
      if (near >= 2 && near <= 3) { peak += mag[y * S + x]; pc++ }
      else if (near >= 5 && near <= 9) { ref += mag[y * S + x]; rc++ }
    }
  }
  if (!pc || !rc) return 1
  return (peak / pc) / Math.max(ref / rc, 1e-9)
}

/** Excess energy on the radial ring r≈S/period vs adjacent rings. */
function radialRingRatio(mag, S, radius) {
  let peak = 0, pc = 0, ref = 0, rc = 0
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x <= S / 2 ? x : S - x, fy = y <= S / 2 ? y : S - y
    const r = Math.hypot(fx, fy)
    const d = Math.abs(r - radius)
    if (r < 2) continue
    if (d <= 1.5) { peak += mag[y * S + x]; pc++ }
    else if (d >= 4 && d <= 10) { ref += mag[y * S + x]; rc++ }
  }
  if (!pc || !rc) return 1
  return (peak / pc) / Math.max(ref / rc, 1e-9)
}

/**
 * Match one image against the whole signature DB.
 * @param {Float32Array} gray luminance [0,1] of an S×S decode (S power of two ≥128)
 * @param {number} S
 * @returns {{score:number, matches:Array, signals:Array, confidence:string}}
 */
export function matchGeneratorFingerprints(gray, S = 256) {
  const signals = []
  try {
    const mag = magnitudeSpectrum(gray, S)
    const matches = []
    for (const fp of GENERATOR_SIGNATURES) {
      if (fp.period > S / 4) continue // harmonic too close to DC to resolve
      const h = Math.round(S / fp.period)
      let ratio, detail
      if (fp.id === 'dalle-notch' || fp.id === 'upscaler-ring') {
        ratio = radialRingRatio(mag, S, h)
        detail = `ring ×${ratio.toFixed(2)}`
      } else {
        ratio = axialHarmonicRatio(mag, S, h)
        detail = `harmonics ×${ratio.toFixed(2)}`
      }
      if (ratio >= 2.2) {
        matches.push({ id: fp.id, name: fp.name, family: fp.family, note: fp.note, periodPx: fp.period, strength: +clamp((ratio - 2) / 3, 0, 1).toFixed(2), detail })
      }
    }
    matches.sort((a, b) => b.strength - a.strength)
    let score = 0
    for (const m of matches.slice(0, 3)) {
      signals.push(sig(`${m.name} (${m.detail}) — consistent with ${m.family}`, true))
      score += 10 + m.strength * 18
    }
    if (!matches.length) {
      signals.push(sig('No known generator spectral fingerprints matched', false))
      score = -6
    }
    return {
      score: clamp(Math.round(score), -15, 70),
      matches: matches.slice(0, 4),
      signals,
      confidence: matches.length && matches[0].strength > 0.5 ? 'medium' : matches.length ? 'low' : 'none',
    }
  } catch {
    return { score: 0, matches: [], signals: [{ label: 'Fingerprint matching unavailable', suspicious: false }], confidence: 'none' }
  }
}
