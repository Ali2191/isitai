import { getCached } from '../../../lib/cache'
import { buildEvidenceHtml } from '../../../lib/evidencePack'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'

export const runtime = 'nodejs'

// GET /api/report-pdf?id=<reportId> — server-rendered, printable evidence pack.
// Served as text/html with print styles so "Save as PDF" from any browser
// produces the court-ready document without a headless-Chrome dependency.
export async function GET(request) {
  try {
    const rl = rateLimit(`pdf:${getClientIp(request)}`, 20, 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return Response.json({ error: 'missing ?id=' }, { status: 400 })
    const result = getCached(id)
    if (!result) {
      return new Response('<!doctype html><meta charset="utf-8"><p>Report expired (10-minute window). Re-run the analysis to generate a fresh evidence pack.</p>', { status: 410, headers: { 'Content-Type': 'text/html' } })
    }
    const html = buildEvidenceHtml(result, { requester: new URL(request.url).searchParams.get('for') || null })
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
