import { compareImages } from '../../../lib/compare'
import { rateLimit, getClientIp, rateLimitResponse } from '../../../lib/rateLimit'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request) {
  try {
    const rl = rateLimit(`compare:${getClientIp(request)}`, 8, 60_000)
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)
    if (!(request.headers.get('content-type') || '').includes('multipart/form-data')) return Response.json({ error: 'Send multipart fields "original" and "suspected".' }, { status: 415 })
    const fd = await request.formData()
    const original = fd.get('original'), suspected = fd.get('suspected')
    if (!original || typeof original === 'string' || !suspected || typeof suspected === 'string') return Response.json({ error: 'Upload both original and suspected images.' }, { status: 400 })
    if (!String(original.type).startsWith('image/') || !String(suspected.type).startsWith('image/')) return Response.json({ error: 'Both files must be images.' }, { status: 415 })
    if (original.size > 20 * 1024 * 1024 || suspected.size > 20 * 1024 * 1024) return Response.json({ error: 'Each image must be 20 MB or smaller.' }, { status: 413 })
    const result = await compareImages(Buffer.from(await original.arrayBuffer()), Buffer.from(await suspected.arrayBuffer()), original.type, suspected.type)
    return Response.json({ ...result, rateRemaining: rl.remaining })
  } catch (error) {
    return Response.json({ error: String(error?.message || error).slice(0, 200) }, { status: 500 })
  }
}
