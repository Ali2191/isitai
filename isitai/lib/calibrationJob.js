// ─── Weekly confidence recalibration (shared by cron route + CLI) ───────────
// Reads the rolling 30-day feedback window, computes per-bucket agreement
// with user-confirmed ground truth, and derives a small additive correction
// per score bucket (clamped ±6 pts, EWMA-smoothed against the previous
// calibration so a single noisy week can't swing verdicts). Also suggests
// threshold shifts when a bucket's agreement collapses.

import { getCalibrationStats, getActiveCalibration, publishCalibration, BUCKETS } from './calibration'

const MIN_SAMPLES_PER_BUCKET = 15   // don't act on noise
const MAX_CORRECTION = 6            // never override evidence, only refine
const EWMA_ALPHA = 0.4              // weight of the new observation

/**
 * Recompute + publish a calibration. Returns the published object.
 * Safe to call repeatedly; with insufficient data it republishes the current
 * corrections unchanged (plus fresh stats) so reports stay timestamped.
 */
export async function runCalibration({ force = false } = {}) {
  const stats = await getCalibrationStats()
  const prev = await getActiveCalibration()

  const corrections = { ...prev.corrections }
  const notes = []
  let actionable = 0

  for (const b of BUCKETS) {
    const s = stats.byBucket[b]
    if (!s || s.n < MIN_SAMPLES_PER_BUCKET) {
      notes.push(`${b}: ${s?.n ?? 0} samples — below threshold (${MIN_SAMPLES_PER_BUCKET}), correction held at ${corrections[b] ?? 0}`)
      continue
    }
    actionable++
    // Derive directional bias: buckets where users say "actually AI" more than
    // "actually real" are under-scoring (we were too generous), and vice versa.
    const over = s.saidAi - s.saidReal
    const raw = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, over / s.n * 12)) // ±12 scale → clamp ±6
    const blended = (EWMA_ALPHA * raw) + ((1 - EWMA_ALPHA) * (corrections[b] ?? 0))
    corrections[b] = +blended.toFixed(2)
    notes.push(`${b}: n=${s.n} agree=${Math.round((s.agree / s.n) * 100)}% → correction ${corrections[b] >= 0 ? '+' : ''}${corrections[b]}`)
  }

  // Threshold suggestion: if the '62-84' bucket agrees < 60% and skews
  // "actually real", raise the likely-ai cut-off slightly (and vice versa).
  const thresholds = { ...prev.thresholds }
  const midHigh = stats.byBucket['62-84']
  if (midHigh && midHigh.n >= MIN_SAMPLES_PER_BUCKET) {
    const skew = (midHigh.saidReal - midHigh.saidAi) / midHigh.n
    if (skew > 0.3) thresholds.aiLikely = Math.min(75, thresholds.aiLikely + 2)
    else if (skew < -0.3) thresholds.aiLikely = Math.max(50, thresholds.aiLikely - 2)
  }

  const cal = {
    computedAt: Date.now(),
    samples: stats.total,
    agreementPct: stats.agreementPct,
    actionableBuckets: actionable,
    corrections,
    thresholds,
    note: force ? 'Manual run' : 'Weekly automatic recalibration',
    historyNotes: [...(prev.historyNotes || []).slice(-6), ...notes],
  }
  await publishCalibration(cal)
  return cal
}
