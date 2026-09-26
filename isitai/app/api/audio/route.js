import { analyzeAudioPassage } from '../../../lib/audioAnalyze'
import { MAX_AUDIO_BYTES } from '../../../lib/audioDetect'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/audio — multipart field `audio` (mp3/wav/m4a/flac/ogg)
export async function POST(request) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`audio:${ip}`, Number(process.env.RATE_LIMIT_AUDIO || 4), 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)
    const ct = request.headers.get('content-type') || ''
    if (!ct.includes('multipart/form-data')) return Response.json({ error: 'Send multipart form with field "audio"' }, { status: 415 })
    const fd = await request.formData()
    const file = fd.get('audio')
    if (!file || typeof file === 'string') return Response.json({ error: 'No audio provided' }, { status: 400 })
    if (!(file.type || '').startsWith('audio/')) return Response.json({ error: 'File is not audio' }, { status: 415 })
    if (file.size > MAX_AUDIO_BYTES) return Response.json({ error: `Audio too large (limit ${MAX_AUDIO_BYTES / 1024 / 1024} MB)` }, { status: 413 })
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await analyzeAudioPassage(buffer, file.type)
    return Response.json({ ...result, rateRemaining: rl.remaining })
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
