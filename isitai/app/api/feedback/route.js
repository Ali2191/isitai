import { recordFeedback, getCalibrationStats } from '../../../lib/calibration'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'

export const runtime = 'nodejs'

// ─── User feedback loop for accuracy calibration ────────────────────────────
// Wired into lib/calibration.js: every sample is appended to a rolling,
// persisted 30-day window (DATA_DIR/feedback.jsonl). The weekly job
// (app/api/calibrate/route.js + scripts/calibrate.js) recomputes per-bucket
// agreement and publishes threshold corrections that analyze.js applies.
// Stores ONLY: score, verdict level, degraded flag, model count and the
// user's judgement. No images, no text, no ids, no IPs.

export async function POST(request) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`feedback:${ip}`, 30, 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

    const body = await request.json().catch(() => ({}))
    const { score, judgement, verdict, level, degraded, modelsUsed } = body
    if (typeof score !== 'number' || !['correct', 'wrong_real', 'wrong_ai'].includes(judgement)) {
      return Response.json({ error: 'Provide numeric score and judgement in {correct, wrong_real, wrong_ai}' }, { status: 400 })
    }
    const entry = {
      score: Math.round(Math.max(0, Math.min(100, score))),
      verdict: String(verdict || level || '').slice(0, 24),
      judgement,
      degraded: !!degraded,
      models: Number.isFinite(modelsUsed) ? Math.max(0, Math.min(8, modelsUsed)) : null,
      at: Date.now(),
    }
    await recordFeedback(entry)
    return Response.json({ ok: true, thankYou: true })
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 120) }, { status: 500 })
  }
}

// GET /api/feedback — public accuracy summary ("last 30 days: X% agreement")
export async function GET() {
  const stats = await getCalibrationStats()
  return Response.json(stats)
}
