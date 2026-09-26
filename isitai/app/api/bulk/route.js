import { parseCsv, runBulkAudit, toCsv } from '../../../lib/bulk'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'
import { record, note } from '../../../lib/metrics'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/bulk — batch audit endpoint. Body: CSV text (URLs) or JSON {urls:[...]}.
// No API key required — internal usage only, protected by per-IP rate limiting.
// Query ?format=csv for spreadsheet export.
// Every run is written to an append-only audit log (DATA_DIR/bulk-audit.log).
export async function POST(request) {
  const t0 = Date.now()
  try {
    const rl = rateLimit(`bulk:${getClientIp(request)}`, Number(process.env.RATE_LIMIT_BULK || 5), 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

    const body = await request.text()
    let urls
    try { urls = JSON.parse(body).urls } catch { /* csv below */ }
    if (!Array.isArray(urls)) urls = parseCsv(body)
    if (!urls.length) return Response.json({ error: 'No URLs found. Send CSV (one http(s) URL per line) or {"urls": [...]}.' }, { status: 400 })

    const rows = await runBulkAudit(urls)
    record('bulk', Date.now() - t0, true)
    note('bulk', `${rows.length} urls audited`)

    // Audit log (org accountability): who ran what when, results only.
    try {
      const { appendFile, mkdir } = await import('fs/promises')
      const { join } = await import('path')
      const dir = process.env.DATA_DIR || join(process.cwd(), '.data')
      await mkdir(dir, { recursive: true })
      await appendFile(join(dir, 'bulk-audit.log'), JSON.stringify({ at: new Date().toISOString(), n: rows.length, summary: rows.map(r => ({ u: r.url, s: r.score, v: r.verdict })) }) + '\n')
    } catch { /* read-only fs: skip logging rather than fail the job */ }

    const wantCsv = new URL(request.url).searchParams.get('format') === 'csv'
    if (wantCsv) {
      return new Response(toCsv(rows), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="isitai-bulk-audit.csv"' } })
    }
    return Response.json({ generatedAt: new Date().toISOString(), count: rows.length, rows })
  } catch (e) {
    record('bulk', Date.now() - t0, false)
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
