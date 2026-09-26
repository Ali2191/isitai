import { analyzeTextPassage } from '../../../lib/textAnalyze'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'

export const runtime = 'nodejs'
export const maxDuration = 30

// POST /api/text  { text } → full multi-layer pipeline (stylometry + structure
// + AI-trace scan + optional worker model + sentence-level localization),
// returning the same score/band/verdict/layers envelope as /api/detect.
export async function POST(request) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`text:${ip}`, Number(process.env.RATE_LIMIT_TEXT || 20), 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)
    const body = await request.json().catch(() => ({}))
    const text = typeof body.text === 'string' ? body.text.slice(0, 20_000) : ''
    if (text.trim().length < 40) return Response.json({ error: 'Provide at least ~40 words of text' }, { status: 400 })

    const result = await analyzeTextPassage(text)
    return Response.json({ ...result, rateRemaining: rl.remaining })
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
