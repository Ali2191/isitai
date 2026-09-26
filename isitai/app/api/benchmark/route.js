import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { evaluate } from '../../../lib/benchmark'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.data')

// GET /api/benchmark — published evaluation vs labeled reference sets.
export async function GET() {
  const file = join(DATA_DIR, 'benchmark.jsonl')
  const out = { generatedAt: new Date().toISOString(), datasets: {}, overall: null, note: null }
  if (!existsSync(file)) {
    out.note = 'Benchmark run not yet executed on this deployment. Reproduce with: node scripts/benchmark.mjs <samples-dir>'
    return Response.json(out)
  }
  try {
    const raw = await readFile(file, 'utf8')
    const bySet = {}
    const all = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let o; try { o = JSON.parse(line) } catch { continue }
      ;(bySet[o.set || 'mixed'] ||= []).push(o)
      all.push(o)
    }
    for (const [k, v] of Object.entries(bySet)) out.datasets[k] = evaluate(v)
    out.overall = evaluate(all)
  } catch (e) {
    out.note = 'Benchmark data unreadable: ' + String(e?.message || e).slice(0, 120)
  }
  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } })
}
