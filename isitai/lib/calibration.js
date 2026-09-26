// ─── Confidence calibration store + weekly recalibration ────────────────────
// The feedback endpoint records anonymized (bucket, judgement) pairs into a
// rolling 30-day window persisted to disk (DATA_DIR). A weekly job
// (lib/calibrationJob.js — cron on Vercel / `npm run calibrate`) recomputes:
//   • per-bucket agreement rate with user-confirmed ground truth
//   • a suggested threshold shift per bucket (is the score too aggressive?)
//   • an EWMA-smoothed bias correction applied inside analyze.js fusion
// Nothing about individual users or images is ever stored.

import { mkdir, readFile, writeFile, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

const WINDOW_DAYS = 30
const MAX_SAMPLES = 20_000
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.data')
const FB_FILE = join(DATA_DIR, 'feedback.jsonl')
const CAL_FILE = join(DATA_DIR, 'calibration.json')

export const BUCKETS = ['0-14', '15-37', '38-61', '62-84', '85-99']

export function bucketOf(score) {
  if (score < 15) return '0-14'
  if (score < 38) return '15-37'
  if (score < 62) return '38-61'
  if (score < 85) return '62-84'
  return '85-99'
}

let mem = null // in-process mirror of the current window
let writeQueue = Promise.resolve()
let loaded = false

async function ensureDir() {
  try { await mkdir(DATA_DIR, { recursive: true }) } catch { /* best-effort */ }
}

/** Load + prune the rolling window once per process. */
async function load() {
  if (loaded) return mem
  loaded = true
  mem = []
  if (!existsSync(FB_FILE)) return mem
  try {
    const raw = await readFile(FB_FILE, 'utf8')
    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        if (e.at >= cutoff && typeof e.score === 'number') mem.push(e)
      } catch { /* skip malformed line */ }
    }
    if (mem.length > MAX_SAMPLES) mem = mem.slice(-MAX_SAMPLES)
  } catch { /* corrupted file → start fresh */ }
  return mem
}

/** Append one anonymized feedback sample (fire-and-forget safe). */
export async function recordFeedback(entry) {
  const m = await load()
  m.push(entry)
  if (m.length > MAX_SAMPLES) m.splice(0, m.length - MAX_SAMPLES)
  writeQueue = writeQueue.then(async () => {
    await ensureDir()
    try {
      const lines = m.map(e => JSON.stringify(e)).join('\n') + '\n'
      const tmp = FB_FILE + '.tmp'
      await writeFile(tmp, lines)
      await rename(tmp, FB_FILE) // atomic swap
    } catch { /* storage unavailable → memory-only */ }
  })
  return writeQueue
}

/** Aggregate stats over the rolling window (used by /api/stats + status page). */
export async function getCalibrationStats() {
  const m = await load()
  const byBucket = {}
  for (const b of BUCKETS) byBucket[b] = { n: 0, agree: 0, saidReal: 0, saidAi: 0 }
  let agree = 0
  for (const e of m) {
    const b = bucketOf(e.score)
    byBucket[b].n += 1
    if (e.judgement === 'correct') { agree += 1; byBucket[b].agree += 1 }
    else if (e.judgement === 'wrong_real') byBucket[b].saidReal += 1
    else if (e.judgement === 'wrong_ai') byBucket[b].saidAi += 1
  }
  const cal = await getActiveCalibration()
  return {
    windowDays: WINDOW_DAYS,
    total: m.length,
    agreementPct: m.length ? +(agree / m.length * 100).toFixed(1) : null,
    byBucket,
    activeCalibration: cal,
    note: 'Aggregated, anonymized, 30-day rolling window. No images, no ids, no IPs.',
  }
}

/** The last published calibration (or defaults when none exists yet). */
export async function getActiveCalibration() {
  try {
    if (!existsSync(CAL_FILE)) return defaultCalibration()
    const j = JSON.parse(await readFile(CAL_FILE, 'utf8'))
    return { ...defaultCalibration(), ...j }
  } catch {
    return defaultCalibration()
  }
}

function defaultCalibration() {
  return {
    computedAt: null,
    samples: 0,
    agreementPct: null,
    corrections: Object.fromEntries(BUCKETS.map(b => [b, 0])),
    thresholds: { aiLikely: 60, aiDefinitive: 85, realLikely: 15 },
    note: 'No calibration run yet — neutral corrections.',
  }
}

/** Persist a new calibration (called by the weekly job). */
export async function publishCalibration(cal) {
  await ensureDir()
  const tmp = CAL_FILE + '.tmp'
  await writeFile(tmp, JSON.stringify(cal, null, 2))
  await rename(tmp, CAL_FILE)
  return cal
}

/**
 * Score-bias correction for a fused score: small additive nudge learned from
 * user-confirmed ground truth, clamped to ±6 points so it can refine — never
 * override — the evidence. Requires ≥15 samples in the bucket to act.
 */
export function applyCorrection(score, cal) {
  const c = cal?.corrections?.[bucketOf(score)]
  if (!c || Math.abs(c) < 0.5) return score
  return Math.max(1, Math.min(99, Math.round(score + c)))
}
