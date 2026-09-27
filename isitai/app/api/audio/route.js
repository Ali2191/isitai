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
    const reference = fd.get('reference')
    if (reference && typeof reference !== 'string' && String(reference.type || '').startsWith('audio/') && reference.size <= MAX_AUDIO_BYTES) {
      const referenceResult = await analyzeAudioPassage(Buffer.from(await reference.arrayBuffer()), reference.type)
      const a = result.stats, b = referenceResult.stats
      if (a && b) {
        const relative = (x, y) => Math.abs(Number(x || 0) - Number(y || 0)) / Math.max(Math.abs(Number(y || 0)), 1)
        const distance = Math.min(1, (relative(a.rms, b.rms) + relative(a.hfRatio, b.hfRatio) + relative(a.zeroCrossRate, b.zeroCrossRate)) / 3)
        result.voiceConsistency = { distance: +distance.toFixed(3), label: distance < 0.25 ? 'Spectrally consistent' : distance < 0.55 ? 'Mixed spectral match' : 'Spectrally different', evidence: 'Compares waveform statistics only; this is not speaker identification.' }
        result.signals = [...(result.signals || []), { label: `Reference recording comparison: ${result.voiceConsistency.label.toLowerCase()}`, suspicious: distance >= 0.55, why: result.voiceConsistency.evidence }]
      }
    }
    return Response.json({ ...result, rateRemaining: rl.remaining })
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
