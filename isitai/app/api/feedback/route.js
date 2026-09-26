import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'

export const runtime = 'nodejs'

// ─── User feedback loop for accuracy calibration ────────────────────────────
// Stores ONLY: score bucket, verdict level, whether models were degraded, and
// the user's judgement (correct / wrong-real / wrong-ai). No images, no text.
const FEEDBACK = [] // rolling buffer (last 1000)
let stats = { total: 0, correct: 0, wrongReal: 0, wrongAi: 0, byBucket: {} }

function bucketOf(score) {
  if (score < 15) return '0-14'
  if (score < 38) return '15-37'
  if (score < 62) return '38-61'
  if (score < 85) return '62-84'
  return '85-99'
}

export async function POST(request) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`feedback:${ip}`, 30, 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

    const body = await request.json().catch(() => ({}))
    const { score, verdict, judgement, degraded } = body
    if (typeof score !== 'number' || !['correct', 'wrong_real', 'wrong_ai'].includes(judgement)) {
      return Response.json({ error: 'Provide numeric score and judgement in {correct, wrong_real, wrong_ai}' }, { status: 400 })
    }
    const entry = { score: Math.round(Math.max(0, Math.min(100, score))), verdict: String(verdict || ''), judgement, degraded: !!degraded, at: Date.now() }
    FEEDBACK.push(entry)
    if (FEEDBACK.length > 1000) FEEDBACK.shift()

    stats.total += 1
    if (judgement === 'correct') stats.correct += 1
    else if (judgement === 'wrong_real') stats.wrongReal += 1
    else stats.wrongAi += 1
    const b = bucketOf(entry.score)
    stats.byBucket[b] = stats.byBucket[b] || { n: 0, correct: 0 }
    stats.byBucket[b].n += 1
    if (judgement === 'correct') stats.byBucket[b].correct += 1

    return Response.json({ ok: true, thankYou: true })
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 120) }, { status: 500 })
  }
}

export async function GET() {
  const acc = stats.total ? (stats.correct / stats.total * 100).toFixed(1) : null
  return Response.json({
    total: stats.total,
    accuracyPct: acc == null ? null : Number(acc),
    wrongReal: stats.wrongReal,
    wrongAi: stats.wrongAi,
    byScoreBucket: stats.byBucket,
    note: 'Aggregated, anonymized calibration data. Cleared on cold start.',
  })
}
