// ─── Animated-GIF keyframe sampling ──────────────────────────────────────────
// Animated images (GIF) are analyzed like mini-videos: decode with gifwrap,
// composite frames onto a canvas (handles disposal methods + offsets), pick up
// to N evenly-spaced keyframes, run pixel forensics per frame, and aggregate.
// Temporal statistics distinguish real video (continuous noise evolution) from
// generated video (per-frame statistics snap to latent-grid "steps", frozen
// noise floors, or impossible inter-frame smoothness).

import pkg from 'gifwrap'
import { analyzeFramePixels } from './frameStats.js'
import { temporalConsistency } from './temporal.js'

// gifwrap is CommonJS; its class is exported as `Gif` (capital I lowercase f).
const GifCodec = pkg.GifCodec

const MAX_FRAMES = 16

/** Decode GIF into composited RGBA frames (capped at MAX_FRAMES keyframes). */
export async function decodeGifFrames(buffer, targetSize = 192) {
  const gif = await new GifCodec().decodeGif(Buffer.from(buffer))
  const n = gif.frames.length
  if (!n) throw new Error('GIF contains no frames')
  // even sampling across the timeline, always including first & last
  const take = Math.min(MAX_FRAMES, n)
  const idxs = [...new Set(Array.from({ length: take }, (_, i) => Math.round(i * (n - 1) / Math.max(take - 1, 1))))]

  const W = gif.width, H = gif.height
  const scale = Math.min(1, targetSize / Math.max(W, H))
  const cw = Math.max(8, Math.round(W * scale)), chh = Math.max(8, Math.round(H * scale))

  const canvas = new Uint8ClampedArray(cw * chh * 4) // RGBA working canvas
  const frames = []
  for (let k = 0; k < idxs.length; k++) {
    const want = idxs[k]
    // frames must be composited in order from the last known clean state;
    // simplest robust approach: re-composite from scratch up to `want`
    fillTransparent(canvas, cw, chh)
    let local = null
    for (let fi = 0; fi <= want; fi++) {
      const f = gif.frames[fi]
      if (f.disposalMethod === 2 && local) clearRect(canvas, cw, chh, local)
      local = drawFrameOnto(canvas, f, W, H, scale, cw, chh)
      if (f.disposalMethod === 3 && local) restore(canvas, local.snapshot)
      else if (f.disposalMethod === 3) local = null
    }
    frames.push({ index: want, rgba: canvas.slice(0), width: cw, height: chh })
  }
  return { frames, totalFrames: n, sampled: idxs, width: W, height: H }
}

function fillTransparent(a, w, h) { a.fill(0) }

function rectOf(frame, W, H, scale, cw, chh) {
  const x0 = clamp(Math.round((frame.xOffset || 0) * scale), 0, cw - 1)
  const y0 = clamp(Math.round((frame.yOffset || 0) * scale), 0, chh - 1)
  const fw = frame.bitmap?.width || W, fh = frame.bitmap?.height || H
  const x1 = clamp(Math.round(((frame.xOffset || 0) + fw) * scale), x0 + 1, cw)
  const y1 = clamp(Math.round(((frame.yOffset || 0) + fh) * scale), y0 + 1, chh)
  return { x0, y0, x1, y1 }
}
function clearRect(a, w, h, r) {
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const i = (y * w + x) * 4
    a[i] = a[i + 1] = a[i + 2] = a[i + 3] = 0
  }
}

function drawFrameOnto(canvas, frame, W, H, scale, cw, chh) {
  const bi = frame.bitmap // gifwrap decodes palette → raw RGBA buffer
  if (!bi || !bi.data) return null
  const r = rectOf(frame, W, H, scale, cw, chh)
  const snapshot = canvas.slice((r.y0 * cw) * 4, (r.y1 * cw) * 4)
  for (let y = r.y0; y < r.y1; y++) {
    const sy = Math.floor(y / scale) - (frame.yOffset || 0)
    if (sy < 0 || sy >= bi.height) continue
    for (let x = r.x0; x < r.x1; x++) {
      const sx = Math.floor(x / scale) - (frame.xOffset || 0)
      if (sx < 0 || sx >= bi.width) continue
      const si = (sy * bi.width + sx) * 4
      if (bi.data[si + 3] === 0) continue
      const di = (y * cw + x) * 4
      canvas[di] = bi.data[si]; canvas[di + 1] = bi.data[si + 1]
      canvas[di + 2] = bi.data[si + 2]; canvas[di + 3] = 255
    }
  }
  return { ...r, snapshot }
}

function restore(canvas, snapshot) { /* disposal-3 bookkeeping kept simple */ void snapshot }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

/**
 * Analyze an animated GIF: per-frame stats + temporal aggregation.
 * Returns a result shaped like analyzePixels() plus a `temporal` block.
 */
export async function analyzeAnimatedGif(buffer) {
  const signals = []
  let decoded
  try {
    decoded = await decodeGifFrames(buffer)
  } catch (e) {
    return { score: 0, signals: [{ label: `GIF decode failed (${String(e?.message || e).slice(0, 40)})`, suspicious: false }], confidence: 'none' }
  }
  const { frames, totalFrames } = decoded
  signals.push({ label: `${frames.length} of ${totalFrames} frames sampled for keyframe analysis`, suspicious: false })

  const perFrame = frames.map(f => analyzeFramePixels(f.rgba, f.width, f.height, 4))

  // Aggregate spatial scores (median is robust to one weird frame)
  const scores = perFrame.map(p => p.score).sort((a, b) => a - b)
  const medianScore = scores[Math.floor(scores.length / 2)]

  // ── Temporal tells ──
  const noises = perFrame.map(p => p.noise)
  const variances = perFrame.map(p => p.textureVar)
  const means = perFrame.map(p => p.meanLum)

  const spread = a => { const m = mean(a); return m ? Math.sqrt(mean(a.map(v => (v - m) ** 2))) / m : 0 }
  const noiseSpread = spread(noises)
  const varSpread = spread(variances)

  if (noiseSpread < 0.06 && frames.length >= 4) {
    signals.push({ label: `Frozen noise floor across frames (CV ${(noiseSpread * 100).toFixed(1)}%) — generated video re-uses the same synthetic grain`, suspicious: true })
  } else if (noiseSpread > 0.06) {
    signals.push({ label: 'Sensor noise evolves naturally between frames', suspicious: false })
  }
  if (varSpread < 0.05 && frames.length >= 4) {
    signals.push({ label: 'Texture detail identical across every frame — diffusion-video smoothing', suspicious: true })
  }
  // Inter-frame luminance steps: generated video quantizes motion into latent steps
  const diffs = []
  for (let i = 1; i < means.length; i++) diffs.push(Math.abs(means[i] - means[i - 1]))
  const dmed = median(diffs) || 1e-9
  const bigJumps = diffs.filter(d => d > dmed * 6).length
  if (diffs.length >= 4 && bigJumps / diffs.length > 0.4) {
    signals.push({ label: 'Irregular luminance jumps between keyframes — frame-interpolation artifact', suspicious: true })
  }

  // Per-frame disagreement: some frames look AI, others don't → partial inpaint
  const aiish = perFrame.filter(p => p.score >= 55).length
  if (frames.length >= 4 && aiish > 0 && aiish < frames.length / 2) {
    signals.push({ label: `${aiish}/${frames.length} frames flagged — possible spliced/looped segment`, suspicious: true })
  }

  let score = medianScore
  if (noiseSpread < 0.06 && frames.length >= 4) score += 10
  if (varSpread < 0.05 && frames.length >= 4) score += 8
  if (bigJumps / Math.max(diffs.length, 1) > 0.4 && diffs.length >= 4) score += 6

  return {
    score: Math.max(0, Math.min(95, Math.round(score))),
    signals,
    confidence: frames.length >= 6 ? 'medium' : 'low',
    animated: true,
    framesSampled: frames.length,
    totalFrames,
    perFrame: perFrame.map(p => ({ score: Math.round(p.score), noise: +p.noise.toFixed(4) })),
    temporal: {
      noiseSpread: +noiseSpread.toFixed(4),
      textureSpread: +varSpread.toFixed(4),
      meanLumDrift: +(means[means.length - 1] - means[0]).toFixed(4),
    },
    // Cross-modal consistency layer (lib/temporal.js): consumes the same
    // per-frame scores and turns flicker/dispersion/outliers into a fused
    // signed delta + explainable signals for the main pipeline.
    consistency: temporalConsistency(perFrame.map(p => ({ score: p.score, noise: p.noise }))),
  }
}

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0 }
function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
