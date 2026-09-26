import { analyzeTextFeatures, classifyTextWithWorker } from '../../../lib/textDetect'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'

export const runtime = 'nodejs'
export const maxDuration = 30

// POST /api/text  { text } → stylometry + (optional) worker model verdict
export async function POST(request) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`text:${ip}`, Number(process.env.RATE_LIMIT_TEXT || 20), 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)
    const body = await request.json().catch(() => ({}))
    const text = typeof body.text === 'string' ? body.text.slice(0, 20_000) : ''
    if (text.trim().length < 40) return Response.json({ error: 'Provide at least ~40 words of text' }, { status: 400 })

    const feat = analyzeTextFeatures(text)
    if (feat.score == null) return Response.json(feat)

    let model = null, modelError = null
    try { model = await classifyTextWithWorker(text) } catch (e) { modelError = String(e?.message || e).slice(0, 120) }

    const score = model ? Math.round(feat.score * 0.45 + model.aiScore * 0.55) : feat.score
    const half = model ? 12 : 20
    return Response.json({
      kind: 'text', score,
      band: { lo: Math.max(0, score - half), hi: Math.min(100, score + half), label: `${Math.max(0, score - half)}–${Math.min(100, score + half)}%` },
      verdict: score >= 60
        ? { level: 'likely-ai', emoji: '⚠️', color: '#f97316', line1: 'This text leans AI-generated' }
        : score >= 38 ? { level: 'uncertain', emoji: '🤔', color: '#eab308', line1: "We're uncertain about this text" }
        : { level: 'likely-real', emoji: '✅', color: '#22c55e', line1: 'This text appears human-written' },
      confidence: model ? 'medium' : feat.confidence,
      statistical: feat, model, modelError,
      privacy: 'Text is analyzed transiently and never stored.',
      rateRemaining: rl.remaining,
    })
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
