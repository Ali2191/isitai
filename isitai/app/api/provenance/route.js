import { readProvenance } from '../../../lib/c2pa'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'
import { record } from '../../../lib/metrics'

export const runtime = 'nodejs'
export const maxDuration = 30

// POST /api/provenance — upload a file, get a readable provenance report
// (C2PA manifest chain + EXIF/XMP history). Nothing is stored.
export async function POST(request) {
  const t0 = Date.now()
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`provenance:${ip}`, Number(process.env.RATE_LIMIT_PROVENANCE || 20), 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

    const ct = request.headers.get('content-type') || ''
    if (!ct.includes('multipart/form-data')) {
      return Response.json({ error: 'Upload a file as multipart form field "file"' }, { status: 400 })
    }
    const fd = await request.formData()
    const file = fd.get('file')
    if (!file || typeof file === 'string') return Response.json({ error: 'No file provided' }, { status: 400 })
    if (file.size > 25 * 1024 * 1024) return Response.json({ error: 'File too large (25 MB cap)' }, { status: 413 })
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await readProvenance(buffer)
    result.fileName = file.name || null
    record('provenance', Date.now() - t0, true)
    return Response.json(result)
  } catch (e) {
    record('provenance', Date.now() - t0, false)
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
