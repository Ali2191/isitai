// ─── Scoring fusion: weighted rank-average + calibrated abstain tier ────────
// Two jobs:
//
// 1. combineModelScores(): merge an ensemble of model outputs into one
//    0–100 number with a WEIGHTED RANK-AVERAGE instead of a plain weighted
//    mean or single vote. Each model's score is converted to its normalized
//    rank inside the ensemble, ranks are averaged by weight, then mapped back
//    through the sorted scores. A single wildly-off model can therefore never
//    hijack the verdict (classic TrimMean/Borda robustness), while unanimous
//    ensembles keep their extremity. When only one model answers we blend it
//    halfway toward 50 so single-vote output stays honest about its fragility.
//
// 2. plattCalibrate() / calibrateScore(): map raw fused scores onto empirical
//    P(AI) using logistic (Platt) scaling fitted on real user feedback from
//    the 30-day calibration window — but ONLY when ≥40 labelled samples exist
//    and the fit actually beats the constant base rate (log-loss gate). The
//    published curve lives in .data/calibration.json next to the bucket
//    corrections; below the data threshold the identity mapping is used.
//
// 3. abstainBand(): the "Inconclusive" tier. If the calibrated probability
//    falls inside [low, high] (default 0.32–0.55) OR the ensemble spread is
//    extreme with few models, we refuse to force a binary call.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ── 1. weighted rank-average ─────────────────────────────────────────────────
/**
 * @param {Array<{aiScore:number, weight?:number}>} results successful model outputs
 * @returns {{combined:number, method:'rank-average'|'single'|'none', spread:number}}
 */
export function combineModelScores(results) {
  const valid = (results || []).filter(r => Number.isFinite(r.aiScore))
  if (!valid.length) return { combined: null, method: 'none', spread: 0 }
  if (valid.length === 1) {
    // single-vote honesty: pull halfway to neutral
    const s = valid[0].aiScore
    return { combined: Math.round(50 + (s - 50) * 0.75), method: 'single', spread: 0 }
  }
  const W = valid.map(r => Math.max(0.01, r.weight ?? 1))
  const totalW = W.reduce((a, b) => a + b, 0)
  // sort ascending by score; assign mid-ranks for ties
  const order = valid.map((r, i) => ({ s: r.aiScore, i })).sort((a, b) => a.s - b.s)
  const ranks = new Array(valid.length)
  let idx = 0
  while (idx < order.length) {
    let jdx = idx
    while (jdx + 1 < order.length && order[jdx + 1].s === order[idx].s) jdx++
    const midRank = (idx + jdx) / 2 // 0-based average rank for tie group
    for (let k = idx; k <= jdx; k++) ranks[order[k].i] = midRank
    idx = jdx + 1
  }
  // weighted average of normalized ranks ∈ [0,1]
  let wr = 0
  for (let i = 0; i < valid.length; i++) wr += (ranks[i] / (valid.length - 1)) * W[i]
  wr /= totalW
  // map back through the sorted score list (interpolate between neighbours)
  const sortedScores = order.map(o => o.s)
  const pos = wr * (sortedScores.length - 1)
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  const frac = pos - lo
  const combined = Math.round(sortedScores[lo] * (1 - frac) + sortedScores[hi] * frac)
  const spread = Math.max(...valid.map(v => v.aiScore)) - Math.min(...valid.map(v => v.aiScore))
  return { combined: clamp(combined, 1, 99), method: 'rank-average', spread }
}

// ── 2. Platt scaling from feedback ──────────────────────────────────────────
/**
 * Fit P(AI | score) = sigmoid(a·x + b), x = raw score/100, via Newton steps on
 * the regularized negative log-likelihood. Label source: rolling feedback
 * window entries {score, judgement}:
 *   'correct'   → label agrees with what we said (score≥50 ⇒ AI else real)
 *   'wrong_ai'  → user says it IS AI            ⇒ label 1
 *   'wrong_real'→ user says it is REAL          ⇒ label 0
 * @returns {{a:number,b:number,n:number,baseLogLoss:number,fitLogLoss:number}|null}
 */
export function plattFit(samples) {
  const pts = []
  for (const e of samples || []) {
    if (typeof e.score !== 'number') continue
    let label = null
    if (e.judgement === 'wrong_ai') label = 1
    else if (e.judgement === 'wrong_real') label = 0
    else if (e.judgement === 'correct') label = e.score >= 50 ? 1 : 0
    if (label == null) continue
    pts.push({ x: clamp(e.score, 0, 100) / 100, y: label })
  }
  const n = pts.length
  if (n < 40) return null // too little ground truth to trust a curve
  const pos = pts.filter(p => p.y === 1).length
  const base = clamp(pos / n, 0.02, 0.98)
  const baseLogLoss = -(pos * Math.log(base) + (n - pos) * Math.log(1 - base)) / n

  // Newton-Raphson with mild L2 (lambda=0.01) on (a,b); features [x, 1]
  let a = 0, b = Math.log(base / (1 - base))
  const lambda = 0.01
  for (let iter = 0; iter < 60; iter++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0
    for (const p of pts) {
      const z = a * p.x + b
      const ph = 1 / (1 + Math.exp(-clamp(z, -30, 30)))
      const d = ph - p.y
      const wgt = Math.max(ph * (1 - ph), 1e-6)
      g0 += d * p.x; g1 += d
      h00 += wgt * p.x * p.x; h01 += wgt * p.x; h11 += wgt
    }
    g0 += lambda * a; g1 += lambda * b
    h00 += lambda; h11 += lambda
    const det = h00 * h11 - h01 * h01
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break
    const da = (h11 * g0 - h01 * g1) / det
    const db = (h00 * g1 - h01 * g0) / det
    a -= da; b -= db
    if (Math.abs(da) + Math.abs(db) < 1e-6) break
  }
  let ll = 0
  for (const p of pts) {
    const ph = clamp(1 / (1 + Math.exp(-clamp(a * p.x + b, -30, 30))), 1e-6, 1 - 1e-6)
    ll -= p.y * Math.log(ph) + (1 - p.y) * Math.log(1 - ph)
  }
  ll /= n
  // only publish the curve when it genuinely beats "always say base rate"
  if (!(ll < baseLogLoss - 1e-4)) return { a: 0, b: 0, n, baseLogLoss, fitLogLoss: ll, rejected: true }
  return { a, b, n, baseLogLoss, fitLogLoss: ll }
}

/** Apply a Platt curve (or fall back to identity) to a raw fused score. */
export function calibrateScore(rawScore, platt) {
  if (!platt || !Number.isFinite(platt.a) || (platt.a === 0 && platt.b === 0)) {
    return { prob: rawScore / 100, calibrated: false }
  }
  const z = platt.a * (rawScore / 100) + platt.b
  return { prob: 1 / (1 + Math.exp(-clamp(z, -30, 30))), calibrated: true }
}

// ── 3. abstain ("Inconclusive") tier ────────────────────────────────────────
export function defaultAbstain() { return { low: 0.32, high: 0.55 } }

/**
 * Decide whether to abstain. Triggers when the calibrated probability sits in
 * the inconclusive band, or the evidence base is thin AND the ensemble fights.
 */
export function shouldAbstain(prob, { abstain = defaultAbstain(), spread = 0, modelCount = 0, degraded = false } = {}) {
  if (prob >= abstain.low && prob <= abstain.high) return true
  if (modelCount <= 1 && degraded && spread === 0 && Math.abs(prob - 0.5) < 0.18) return true
  return false
}

export const ABSTAIN_VERDICT = { level: 'inconclusive', emoji: '🤔', color: '#6b7280', line1: 'Inconclusive — not enough signal to call this either way' }
