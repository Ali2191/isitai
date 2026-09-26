import { runCalibration } from '../../../lib/calibrationJob'
import { getActiveCalibration, getCalibrationStats } from '../../../lib/calibration'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── Weekly calibration cron endpoint ────────────────────────────────────────
// Vercel Cron (vercel.json): { "crons": [{ "path": "/api/calibrate", "schedule": "0 4 * * 0" }] }
// Protected by CRON_SECRET (Vercel sends Authorization: Bearer $CRON_SECRET).
export async function GET(request) {
  try {
    const secret = process.env.CRON_SECRET
    if (secret) {
      const auth = request.headers.get('authorization') || ''
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null
      const url = new URL(request.url)
      if (bearer !== secret && url.searchParams.get('key') !== secret) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
    const cal = await runCalibration()
    return Response.json({ ok: true, calibration: cal })
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// POST — manual/forced run (same auth), returns freshly computed calibration
export async function POST(request) {
  try {
    const secret = process.env.CRON_SECRET
    if (secret) {
      const auth = request.headers.get('authorization') || ''
      if (auth.slice(7) !== secret) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const cal = await runCalibration({ force: true })
    return Response.json({ ok: true, calibration: cal })
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// Public read of the current published calibration + accuracy report summary.
export async function HEAD() { return new Response(null, { status: 200 }) }
export async function OPTIONS() {
  const cal = await getActiveCalibration().catch(() => null)
  const stats = await getCalibrationStats().catch(() => null)
  return Response.json({ calibration: cal, stats })
}
