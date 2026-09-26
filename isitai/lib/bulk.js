// ─── Bulk audit engine (journalists / moderators) ────────────────────────────
// CSV in (one URL per line, optional header "url"), parallel detection with a
// bounded worker pool, JSON/CSV out. Requires ISITAI_API_KEY on the request —
// this is the paid-team surface; free tier stays single-image.

import { analyzeImage, MAX_BYTES } from './analyze'
import { fetchImageFromUrl } from './fetchImage'

export function parseCsv(text) {
  return text.split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .filter((l, i) => !(i === 0 && /^url\s*(,.*)?$/i.test(l)))
    .map(l => l.split(',')[0].trim())
    .filter(u => /^https?:\/\//i.test(u))
    .slice(0, Number(process.env.BULK_MAX_ROWS || 50))
}

async function pool(items, concurrency, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      try { out[idx] = await fn(items[idx], idx) }
      catch (e) { out[idx] = { url: items[idx], error: String(e?.message || e).slice(0, 160) } }
    }
  }))
  return out
}

export async function runBulkAudit(urls) {
  return pool(urls, 3, async (url) => {
    const fetched = await fetchImageFromUrl(url)
    if (fetched.error) throw new Error(fetched.error)
    if (fetched.buffer.length > MAX_BYTES) throw new Error('image too large')
    const r = await analyzeImage(fetched.buffer, fetched.mimeType)
    return {
      url,
      sha256: r.sha256,
      score: r.score,
      verdict: r.verdict?.level ?? null,
      confidence: r.confidence,
      degraded: !!r.degraded,
      topSignals: Object.values(r.layers || {}).flatMap(l => l?.signals || []).filter(s => s.suspicious).slice(0, 5).map(s => s.label),
      permalink: `/i/${r.sha256}`,
      analyzedAt: new Date(r.analyzedAt).toISOString(),
    }
  })
}

export function toCsv(rows) {
  const head = 'url,score,verdict,confidence,degraded,top_signals,sha256,permalink,analyzed_at'
  const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`
  return [head, ...rows.map(r => [esc(r.url), r.score ?? '', esc(r.verdict), esc(r.confidence), r.degraded, esc((r.topSignals || []).join('; ')), esc(r.sha256), esc(r.permalink), esc(r.analyzedAt)].join(','))].join('\n')
}
