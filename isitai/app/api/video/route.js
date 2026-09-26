import { analyzeVideoBuffer, MAX_VIDEO_BYTES } from '../../../lib/videoAnalyze'
import { fetchImageFromUrl } from '../../../lib/fetchImage'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'

export const runtime = 'nodejs'
export const maxDuration = 60

// ─── POST /api/video — video/GIF keyframe analysis ──────────────────────────
// Accepts multipart `video` file OR JSON { url }. Samples up to 16 keyframes
// (ffmpeg when available, animated-GIF decoder otherwise) and aggregates
// per-frame forensics + temporal signals into one verdict.
export async function POST(request) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`video:${ip}`, Number(process.env.RATE_LIMIT_VIDEO || 4), 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

    const contentType = request.headers.get('content-type') || ''
    let buffer = null, mimeType = 'video/mp4'

    if (contentType.includes('multipart/form-data')) {
      const fd = await request.formData()
      const file = fd.get('video') || fd.get('image')
      if (!file || typeof file === 'string') return Response.json({ error: 'No video provided' }, { status: 400 })
      if (file.size > MAX_VIDEO_BYTES) return Response.json({ error: `Video too large — limit is ${MAX_VIDEO_BYTES / 1024 / 1024} MB` }, { status: 413 })
      mimeType = file.type || 'video/mp4'
      buffer = Buffer.from(await file.arrayBuffer())
    } else if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}))
      if (!body.url || typeof body.url !== 'string') return Response.json({ error: 'Provide a "url" or upload a video file' }, { status: 400 })
      try { new URL(body.url) } catch { return Response.json({ error: 'Invalid URL' }, { status: 400 }) }
      const fetched = await fetchImageFromUrl(body.url, { maxBytes: MAX_VIDEO_BYTES, timeoutMs: 20_000 })
      if ('error' in fetched) return Response.json(fetched.body, { status: fetched.status })
      buffer = fetched.buffer
      mimeType = fetched.mimeType
    } else {
      return Response.json({ error: 'Send multipart form (video) or JSON { url }' }, { status: 415 })
    }

    const result = await analyzeVideoBuffer(buffer, mimeType)
    return Response.json({ ...result, rateRemaining: rl.remaining })
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// GET /api/video — API docs
export async function GET() {
  return Response.json({
    name: 'IsItAI Video Detection API',
    usage: { endpoint: 'POST /api/video', upload: 'multipart/form-data field "video"', urlMode: 'JSON { "url": "https://…/clip.mp4" }' },
    pipeline: '8–16 keyframe sampling (ffmpeg or GIF decoder) → per-frame noise/temporal forensics → aggregate score + per-frame table',
    limits: { anonymous: '4/min per IP', maxBytes: MAX_VIDEO_BYTES },
    privacy: 'Videos are analyzed transiently and never stored.',
  })
}
