// ─── In-memory per-IP rate limiter (LruTtl) ─────────────────────────────────
// Works on a single serverless instance; on Vercel each region gets its own
// bucket which is acceptable for abuse mitigation on a free tool.
// Set RATE_LIMIT_DISABLED=1 in dev to turn it off.

const buckets = new Map() // key -> { count, resetAt }

let lastSweep = Date.now()

function sweep() {
  const now = Date.now()
  if (now - lastSweep < 30_000) return
  lastSweep = now
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k)
  }
}

/**
 * @param {string} key       identifier (usually IP + route)
 * @param {number} limit     max requests
 * @param {number} windowMs  window in ms
 * @returns {{ ok: boolean, remaining: number, retryAfterSec: number }}
 */
export function rateLimit(key, limit = 20, windowMs = 60_000) {
  if (process.env.RATE_LIMIT_DISABLED === '1') {
    return { ok: true, remaining: limit, retryAfterSec: 0 }
  }
  sweep()
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 }
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) }
  }
  b.count += 1
  return { ok: true, remaining: limit - b.count, retryAfterSec: 0 }
}

/** Best-effort client IP extraction behind proxies. */
export function getClientIp(request) {
  try {
    const fwd = request.headers.get('x-forwarded-for')
    if (fwd) return fwd.split(',')[0].trim()
    const real = request.headers.get('x-real-ip')
    if (real) return real.trim()
  } catch {}
  return 'unknown'
}

export function rateLimitResponse(retryAfterSec) {
  return Response.json(
    {
      error: 'Too many requests — please wait before trying again.',
      retryAfterSec,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
      },
    }
  )
}
