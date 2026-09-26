import { analyzeImage, MAX_BYTES } from '../../../lib/analyze'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/report — create a shareable report.
// Accepts multipart `image` file OR JSON { url }.
// Returns { id } for /r/[id]. Only the ANALYSIS RESULT is stored (TTL 7 days);
// the image itself is never persisted.

const REPORTS = new Map() // id -> { result, createdAt }
const REPORT_TTL_MS = 7 * 24 * 3600_000
let lastPurge = Date.now()

// Keep only the fields we trust from a client-supplied result (strip anything
// unexpected; results never contain image bytes anyway).
function sanitizeLayers(layers) {
  if (!layers || typeof layers !== 'object') return {}
  const pick = l => l && typeof l === 'object'
    ? { score: l.score, aiScore: l.aiScore, available: l.available, degraded: l.degraded, signals: Array.isArray(l.signals) ? l.signals.slice(0, 40) : [], results: Array.isArray(l.results) ? l.results.slice(0, 8) : [] }
    : undefined
  return { models: pick(layers.models), metadata: pick(layers.metadata), dimensions: pick(layers.dimensions), structure: pick(layers.structure), pixels: pick(layers.pixels) }
}

function purge() {
  const now = Date.now()
  if (now - lastPurge < 60_000) return
  lastPurge = now
  for (const [k, v] of REPORTS) if (now - v.createdAt > REPORT_TTL_MS) REPORTS.delete(k)
}

export async function POST(request) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`report:${ip}`, Number(process.env.RATE_LIMIT_REPORT || 10), 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

    const contentType = request.headers.get('content-type') || ''
    let buffer = null
    let mimeType = 'image/jpeg'

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const image = formData.get('image')
      if (!image || typeof image === 'string') {
        return Response.json({ error: 'No image provided' }, { status: 400 })
      }
      if (image.size > MAX_BYTES) {
        return Response.json({ error: `Image too large — limit is ${MAX_BYTES / 1024 / 1024} MB` }, { status: 413 })
      }
      mimeType = image.type || 'image/jpeg'
      buffer = Buffer.from(await image.arrayBuffer())
    } else if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}))
      // Client can share an already-computed result (from /api/detect) instead
      // of re-uploading the image — avoids double analysis and double HF calls.
      if (body.result && typeof body.result === 'object' && typeof body.result.score === 'number') {
        purge()
        const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
        const id = `${String(body.result.id || 'rpt').slice(0, 16)}-${Math.random().toString(36).slice(2, 8)}`
        const stored = { ...body.result, shareId: id, layers: sanitizeLayers(body.result.layers) }
        REPORTS.set(id, { result: stored, createdAt: Date.now() })
        return Response.json({
          id,
          url: `${base}/r/${id}`,
          expiresInSeconds: Math.round(REPORT_TTL_MS / 1000),
          score: stored.score,
          verdict: stored.verdict,
        })
      }
      const url = body.url
      if (!url || typeof url !== 'string') return Response.json({ error: 'Provide "url" or upload an image' }, { status: 400 })
      let parsed
      try { parsed = new URL(url) } catch { return Response.json({ error: 'Invalid URL' }, { status: 400 }) }
      if (!/^https?:$/.test(parsed.protocol)) return Response.json({ error: 'Only http(s) URLs supported' }, { status: 400 })
      const BLOCKED = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd])/i
      if (BLOCKED.test(parsed.hostname)) return Response.json({ error: 'Private addresses not allowed' }, { status: 400 })
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 12_000)
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'image/*' } }).finally(() => clearTimeout(t))
      if (!res.ok) return Response.json({ error: `Remote server returned ${res.status}` }, { status: 422 })
      const ct = res.headers.get('content-type') || ''
      if (!ct.startsWith('image/')) return Response.json({ error: 'URL did not return an image' }, { status: 415 })
      const ab = await res.arrayBuffer()
      if (ab.byteLength > MAX_BYTES) return Response.json({ error: 'Remote image too large' }, { status: 413 })
      buffer = Buffer.from(ab)
      mimeType = ct.split(';')[0].trim()
    } else {
      return Response.json({ error: 'Send multipart form (image) or JSON { url }' }, { status: 415 })
    }

    const result = await analyzeImage(buffer, mimeType)
    purge()
    const id = `${result.id}-${Math.random().toString(36).slice(2, 8)}`
    REPORTS.set(id, { result: { ...result, shareId: id }, createdAt: Date.now() })

    const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
    return Response.json({
      id,
      url: `${base}/r/${id}`,
      expiresInSeconds: Math.round(REPORT_TTL_MS / 1000),
      score: result.score,
      verdict: result.verdict,
    })
  } catch (error) {
    return Response.json({ error: String(error?.message || error).slice(0, 200) }, { status: 500 })
  }
}

export function getStoredReport(id) {
  purge()
  const e = REPORTS.get(id)
  if (!e) return null
  return e.result
}
