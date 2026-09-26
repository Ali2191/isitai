import { getStoredReport } from '../../report/route'

export const dynamic = 'force-dynamic'

// GET /api/report/[id] — fetch a stored shareable report (results only)
export async function GET(_request, { params }) {
  const { id } = await params
  const report = getStoredReport(id)
  if (!report) {
    return Response.json({ error: 'Report not found or expired. Reports are kept for 7 days.' }, { status: 404 })
  }
  return Response.json(report)
}
