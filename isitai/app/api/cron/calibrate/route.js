import { runCalibration } from '../../../../lib/calibrationJob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Vercel cron target (vercel.json → weekly Mon 06:00 UTC).
// Protected by CRON_SECRET so it can't be triggered externally.
export async function GET(request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization') || ''
    const q = new URL(request.url).searchParams.get('key')
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }
  try {
    const cal = await runCalibration()
    return Response.json({ ok: true, computedAt: new Date(cal.computedAt).toISOString(), samples: cal.samples, actionableBuckets: cal.actionableBuckets, corrections: cal.corrections, thresholds: cal.thresholds })
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
