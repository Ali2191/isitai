import { analyzeImage, MAX_BYTES } from '../../../lib/analyze'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/detect  — multipart form with `image` file OR JSON body { url }
export async function POST(request) {
  try {
    // ── API key auth (optional): raises limits when ISITAI_API_KEY is configured ──
    const serverKey = process.env.ISITAI_API_KEY
    const authHeader = request.headers.get('authorization') || ''
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
    const authenticated = !!(serverKey && bearer && bearer === serverKey)

    // ── per-IP rate limit ──
    const ip = getClientIp(request)
    const limit = authenticated
      ? Number(process.env.RATE_LIMIT_AUTH || 60)
      : Number(process.env.RATE_LIMIT_DETECT || 12)
    const rl = rateLimit(`detect:${authenticated ? 'key' : ip}`, limit, 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

    const contentType = request.headers.get('content-type') || ''
    let buffer = null
    let mimeType = 'image/jpeg'
    let source = 'upload'

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const image = formData.get('image')
      if (!image || typeof image === 'string') {
        return Response.json({ error: 'No image provided' }, { status: 400 })
      }
      if (!image.type || !image.type.startsWith('image/')) {
        return Response.json({ error: 'File is not an image' }, { status: 415 })
      }
      if (image.size > MAX_BYTES) {
        return Response.json({ error: `Image too large — limit is ${MAX_BYTES / 1024 / 1024} MB` }, { status: 413 })
      }
      mimeType = image.type
      buffer = Buffer.from(await image.arrayBuffer())
    } else if (contentType.includes('application/json')) {
      // URL mode: server fetches the image (bypasses browser CORS on images)
      const body = await request.json().catch(() => ({}))
      const url = body.url
      if (!url || typeof url !== 'string') {
        return Response.json({ error: 'Provide an image "url" or upload a file' }, { status: 400 })
      }
      let parsed
      try { parsed = new URL(url) } catch {
        return Response.json({ error: 'Invalid URL' }, { status: 400 })
      }
      if (!/^https?:$/.test(parsed.protocol)) {
        return Response.json({ error: 'Only http(s) URLs are supported' }, { status: 400 })
      }
      const fetched = await fetchImageFromUrl(url)
      if ('error' in fetched) return Response.json(fetched.body, { status: fetched.status })
      buffer = fetched.buffer
      mimeType = fetched.mimeType
      source = 'url'
    } else {
      return Response.json({ error: 'Send multipart form (image) or JSON { url }' }, { status: 415 })
    }

    const result = await analyzeImage(buffer, mimeType)
    return Response.json({ ...result, source, rateRemaining: rl.remaining })
  } catch (error) {
    return Response.json({ error: String(error?.message || error).slice(0, 200) }, { status: 500 })
  }
}

// SSRF guard: reject localhost/private/link-local ranges before fetching
const BLOCKED_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd])/i

async function fetchImageFromUrl(url) {
  const fail = (msg, status) => ({ error: msg, status, body: { error: msg } })
  let hostname
  try { hostname = new URL(url).hostname } catch { return fail('Invalid URL', 400) }
  if (BLOCKED_HOST_RE.test(hostname)) return fail('Fetching internal/private addresses is not allowed', 400)
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 12_000)
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'isitai-detector/1.0', Accept: 'image/*' },
    })
    // follow up to 2 redirects manually, re-checking each hop
    let finalRes = res
    let hops = 0
    while ([301, 302, 303, 307, 308].includes(finalRes.status) && hops < 2) {
      const loc = finalRes.headers.get('location')
      if (!loc) break
      const next = new URL(loc, url).toString()
      let nh
      try { nh = new URL(next).hostname } catch { clearTimeout(t); return fail('Invalid redirect target', 422) }
      if (BLOCKED_HOST_RE.test(nh)) { clearTimeout(t); return fail('Redirect points to a private address', 400) }
      finalRes = await fetch(next, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'image/*' } })
      hops++
    }
    clearTimeout(t)
    if (!finalRes.ok) return fail(`Remote server returned ${finalRes.status}`, 422)
    const ct = finalRes.headers.get('content-type') || 'image/jpeg'
    if (!ct.startsWith('image/')) return fail('URL did not return an image', 415)
    const ab = await finalRes.arrayBuffer()
    if (ab.byteLength > MAX_BYTES) return fail(`Remote image too large (${Math.round(ab.byteLength / 1024 / 1024)} MB, limit ${MAX_BYTES / 1024 / 1024} MB)`, 413)
    if (ab.byteLength < 100) return fail('Remote image appears empty', 422)
    return { buffer: Buffer.from(ab), mimeType: ct.split(';')[0].trim() }
  } catch (e) {
    return fail(`Could not fetch URL: ${String(e?.message || e).slice(0, 120)}`, 422)
  }
}

// GET /api/detect?id=… — fetch a cached result by id (results only, never images)
// Without ?id: public API documentation + live status
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (id) {
    const hit = getCached(id)
    if (!hit) return Response.json({ error: 'No cached result for that id. Results are kept for 15 minutes.' }, { status: 404 })
    return Response.json({ ...hit, cached: true })
  }
  return Response.json({
    name: 'IsItAI Detection API',
    version: 1,
    usage: {
      endpoint: 'POST /api/detect',
      upload: 'multipart/form-data with field "image"',
      urlMode: 'application/json with { "url": "https://…/image.jpg" }',
      apiKeyHeader: 'Authorization: Bearer $ISITAI_API_KEY (optional — enables higher limits)',
      response: '{ score, band, verdict, layers: { models, metadata, dimensions, structure, pixels } }',
    },
    examples: {
      curlUpload: 'curl -F "image=@photo.jpg" https://isitai-gilt.vercel.app/api/detect',
      curlUrl: 'curl -X POST -H "Content-Type: application/json" -d \'{"url":"https://example.com/a.jpg"}\' https://isitai-gilt.vercel.app/api/detect',
    },
    limits: { anonymous: '12/min per IP', authenticated: '60/min per key', maxBytes: MAX_BYTES },
    privacy: 'Images are analyzed transiently and never stored.',
  })
}
