// ─── Reproducible verdict registry ───────────────────────────────────────────
// Public, queryable content-hash → result mapping. When the same image bytes
// are analyzed repeatedly we can show "analyzed N× before, verdicts agree",
// serve the stored verdict instantly (compute saving), and publish a public
// /i/<sha256> page. Only analysis RESULTS are kept — never images.
//
// Storage is a small JSONL log + in-memory index (DATA_DIR/verdicts.jsonl).
// On read-only filesystems it degrades gracefully to memory-only mode.

import { mkdir, readFile, writeFile, appendFile, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.data')
const FILE = join(DATA_DIR, 'verdicts.jsonl')
const MAX_ENTRIES = 10_000
const TTL_MS = 90 * 86_400_000 // keep public verdict history for 90 days

let index = null // sha256 -> { entries: [summaries], lastResult }
let loaded = false
let writeChain = Promise.resolve()
let persistedCount = 0

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function load() {
  if (loaded) return index
  loaded = true
  index = new Map()
  persistedCount = 0
  if (!existsSync(FILE)) return index
  try {
    const raw = await readFile(FILE, 'utf8')
    const cutoff = Date.now() - TTL_MS
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        if (e.at < cutoff) continue
        addEntry(e.sha, e, false)
        persistedCount++
      } catch { /* skip */ }
    }
  } catch { /* start fresh */ }
  return index
}

function addEntry(sha, e, countUp = true) {
  let rec = index.get(sha)
  if (!rec) { rec = { count: 0, levels: {}, lastResult: null, firstAt: e.at, lastAt: e.at }; index.set(sha, rec) }
  rec.count += 1
  rec.levels[e.level] = (rec.levels[e.level] || 0) + 1
  rec.lastAt = Math.max(rec.lastAt, e.at)
  if (e.result) rec.lastResult = e.result
  void countUp
}

/** Record one completed analysis. Stores compact summary + full result. */
export async function recordVerdict(sha, result) {
  await load()
  const entry = {
    sha,
    at: result.analyzedAt || Date.now(),
    score: result.score,
    level: result.verdict?.level || 'unknown',
    band: result.band?.label || null,
    result: slim(result),
  }
  addEntry(sha, entry)
  evictIfNeeded()
  writeChain = writeChain.then(async () => {
    try {
      await mkdir(DATA_DIR, { recursive: true })
      if (persistedCount === 0 && index.size > 0) {
        // rewrite whole file on first persist (fresh or after eviction)
        const lines = [...index.entries()].map(([sha2, r]) =>
          JSON.stringify({ sha: sha2, at: r.lastAt, score: r.lastResult?.score, level: Object.keys(r.levels).sort((a, b) => r.levels[b] - r.levels[a])[0], result: r.lastResult })
        ).join('\n') + '\n'
        const tmp = FILE + '.tmp'
        await writeFile(tmp, lines)
        await rename(tmp, FILE)
        persistedCount = index.size
      } else {
        await appendFile(FILE, JSON.stringify(entry) + '\n')
        persistedCount++
      }
    } catch { /* read-only fs → memory only */ }
  })
  return entry
}

function slim(r) {
  return {
    id: r.id, score: r.score, band: r.band, verdict: r.verdict,
    confidence: r.confidence, degraded: !!r.degraded,
    imageDimensions: r.imageDimensions, analyzedAt: r.analyzedAt,
    layers: {
      models: { available: r.layers?.models?.available, combined: r.layers?.models?.combined, results: (r.layers?.models?.results || []).slice(0, 8), disagreement: r.layers?.models?.disagreement },
      metadata: { aiScore: r.layers?.metadata?.aiScore, camera: r.layers?.metadata?.camera, signals: (r.layers?.metadata?.signals || []).slice(0, 12) },
      dimensions: { score: r.layers?.dimensions?.score, signals: (r.layers?.dimensions?.signals || []).slice(0, 8) },
      structure: { score: r.layers?.structure?.score, signals: (r.layers?.structure?.signals || []).slice(0, 8) },
      pixels: { score: r.layers?.pixels?.score, signals: (r.layers?.pixels?.signals || []).slice(0, 14) },
      noise: r.layers?.noise ? { score: r.layers.noise.score, signals: (r.layers.noise.signals || []).slice(0, 8) } : undefined,
      anatomy: r.layers?.anatomy ? { suspicious: r.layers.anatomy.suspicious, signals: (r.layers.anatomy.signals || []).slice(0, 8) } : undefined,
    },
    saliency: r.saliency ? { grid: r.saliency.grid, mean: r.saliency.mean, peak: r.saliency.peak, flagged: r.saliency.flagged } : undefined,
    animated: r.animated || undefined,
  }
}

function evictIfNeeded() {
  if (index.size <= MAX_ENTRIES) return
  const byAge = [...index.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)
  for (const [k] of byAge.slice(0, index.size - MAX_ENTRIES)) index.delete(k)
}

/** History for one hash: count, agreement, majority result (or null). */
export async function getVerdictHistory(sha) {
  await load()
  const rec = index.get(sha)
  if (!rec) return null
  const levels = Object.entries(rec.levels).sort((a, b) => b[1] - a[1])
  const [majorityLevel, majorityN] = levels[0]
  return {
    sha,
    count: rec.count,
    firstAt: rec.firstAt,
    lastAt: rec.lastAt,
    levels: Object.fromEntries(levels),
    agreementPct: +(majorityN / rec.count * 100).toFixed(0),
    unanimous: levels.length === 1,
    majorityLevel,
    lastResult: rec.lastResult,
  }
}

/** Registry-wide counters for the status/benchmark pages. */
export async function registryStats() {
  await load()
  let total = 0, reused = 0
  for (const r of index.values()) { total += r.count; if (r.count > 1) reused += r.count - 1 }
  return { uniqueImages: index.size, totalAnalyses: total, cacheHitsSaved: reused }
}
