// ─── Cross-modal temporal consistency for keyframe sequences ────────────────
// Real footage scores UNIFORMLY across time: the same scene, sensor and codec
// produce a stable per-frame AI-likelihood. Deepfakes and generated video
// "flicker": some frames cross the synthetic threshold while neighbours do
// not, because GAN/diffusion renderers leave per-frame artifacts that drift
// with content motion. This module turns any array of per-frame forensics
// (from frameStats.analyzeFramePixels or videoAnalyze.analyzeFrame) into an
// explainable inconsistency signal used by BOTH the GIF path and the video
// path — the cheap win on top of the existing 16-keyframe extraction.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const sig = (label, suspicious) => ({ label, suspicious: !!suspicious })

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0 }
function stdev(a) {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1))
}
function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0 }

/**
 * @param {Array<{score:number, noise?:number, aiLean?:number}>} perFrame
 *   one entry per sampled keyframe; `score` (or `aiLean`) is the 0–100
 *   per-frame AI-likelihood from the spatial forensics.
 * @returns {{score:number, signals:Array, stats:object}}
 */
export function temporalConsistency(perFrame) {
  const frames = (perFrame || []).filter(f => f && Number.isFinite(f.score ?? f.aiLean))
  const scores = frames.map(f => f.score ?? f.aiLean)
  if (frames.length < 4) {
    return { score: 0, signals: [sig('Too few keyframes for temporal-consistency analysis', false)], stats: { frames: frames.length } }
  }
  const signals = []
  let delta = 0
  const m = mean(scores)
  const sd = stdev(scores)
  const med = median(scores)
  const range = Math.max(...scores) - Math.min(...scores)

  // 1. Threshold flicker: frames crossing the likely-AI line back and forth.
  const above = scores.map(s => s >= 55)
  let crossings = 0
  for (let i = 1; i < above.length; i++) if (above[i] !== above[i - 1]) crossings++
  const crossRate = crossings / (above.length - 1)
  if (crossRate >= 0.35 && crossings >= 3) {
    signals.push(sig(`AI-score flickers across keyframes (${crossings} threshold crossings in ${frames.length} frames) — generated video is temporally inconsistent`, true))
    delta += 12
  } else if (crossings <= 1) {
    signals.push(sig('Per-frame AI-likelihood is temporally stable — consistent capture chain', false))
    delta -= 5
  }

  // 2. Dispersion: real footage sits tight; deepfakes spread.
  const cv = m > 0 ? sd / Math.max(m, 1) : 0
  if (sd >= 14 || range >= 40) {
    signals.push(sig(`High variance between frame scores (σ ${sd.toFixed(1)}, range ${range}) — mixed provenance or partial regeneration`, true))
    delta += 8
  } else if (sd <= 4) {
    signals.push(sig(`Frame scores tightly clustered (σ ${sd.toFixed(1)}) around ${med.toFixed(0)}`, false))
  }

  // 3. Isolated outlier frames → spliced/inpainted segment inside a real clip.
  const outliers = scores.filter(s => Math.abs(s - med) > 25).length
  if (outliers > 0 && outliers <= Math.ceil(frames.length * 0.25)) {
    signals.push(sig(`${outliers}/${frames.length} keyframe(s) deviate >25 pts from the median — possible splice or face-swap segment`, true))
    delta += 10
  }

  // 4. Noise-floor wobble (when the caller supplies per-frame noise proxies).
  const noises = frames.map(f => f.noise).filter(Number.isFinite)
  if (noises.length >= 4) {
    const nm = mean(noises)
    const ncv = nm > 0 ? stdev(noises) / nm : 0
    if (ncv > 0.45) {
      signals.push(sig(`Sensor-noise level swings ±${(ncv * 100).toFixed(0)}% between frames — re-encode/regeneration boundaries`, true))
      delta += 6
    } else if (ncv < 0.18) {
      signals.push(sig('Noise floor steady across the whole timeline', false))
      delta -= 3
    }
  }

  return {
    score: clamp(delta, -12, 30),
    signals,
    stats: {
      frames: frames.length,
      meanScore: +m.toFixed(1),
      medianScore: +med.toFixed(1),
      stdev: +sd.toFixed(1),
      range,
      thresholdCrossings: crossings,
      crossRate: +crossRate.toFixed(2),
      outlierFrames: outliers,
      noiseCV: (() => { const ns = frames.map(f => f.noise).filter(Number.isFinite); if (ns.length < 4) return null; const mm = mean(ns); return mm > 0 ? +(stdev(ns) / mm).toFixed(3) : null })(),
    },
  }
}
