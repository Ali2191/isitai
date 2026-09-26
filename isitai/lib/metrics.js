// ─── Lightweight in-process metrics for the public status dashboard ─────────
// Counts + latency EWMA per endpoint, plus a ring buffer of recent events so
// users can see model health, degraded-mode frequency and cache hit rate.
// No external deps; resets on cold start (serverless-friendly by design).

const endpoints = new Map() // name -> { count, errors, lastLatencyMs, ewmaLatencyMs }
const events = [] // { at, kind, detail }  (ring, max 100)
const startedAt = Date.now()

export function record(name, ms, ok = true) {
  let e = endpoints.get(name)
  if (!e) { e = { count: 0, errors: 0, ewmaLatencyMs: 0 }; endpoints.set(name, e) }
  e.count++
  if (!ok) e.errors++
  const alpha = 0.3
  e.ewmaLatencyMs = e.ewmaLatencyMs ? e.ewmaLatencyMs * (1 - alpha) + ms * alpha : Math.round(ms)
}

export function note(kind, detail = '') {
  events.push({ at: Date.now(), kind, detail: String(detail).slice(0, 200) })
  if (events.length > 100) events.shift()
}

export function snapshot() {
  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    startedAt,
    endpoints: Object.fromEntries([...endpoints].map(([k, v]) => [k, { ...v }])),
    recentEvents: events.slice(-30),
  }
}
