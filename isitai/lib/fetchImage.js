// ─── Shared, SSRF-safe remote image fetcher ─────────────────────────────────
// Used by /api/detect (URL mode), /api/video, /api/bulk. Rejects private /
// loopback / link-local hosts and re-checks every redirect hop manually.

import { MAX_BYTES } from './analyze'

const BLOCKED_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd])/i

export async function fetchImageFromUrl(url, { maxBytes = MAX_BYTES, timeoutMs = 12_000 } = {}) {
  const fail = (msg, status) => ({ error: msg, status, body: { error: msg } })
  let hostname
  try { hostname = new URL(url).hostname } catch { return fail('Invalid URL', 400) }
  if (BLOCKED_HOST_RE.test(hostname)) return fail('Fetching internal/private addresses is not allowed', 400)
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let res = await fetch(url, { signal: controller.signal, redirect: 'manual', headers: { 'User-Agent': 'isitai-detector/1.0', Accept: 'image/*,video/*' } })
    let hops = 0
    while ([301, 302, 303, 307, 308].includes(res.status) && hops < 3) {
      const loc = res.headers.get('location')
      if (!loc) break
      const next = new URL(loc, url).toString()
      let nh
      try { nh = new URL(next).hostname } catch { return fail('Invalid redirect target', 422) }
      if (BLOCKED_HOST_RE.test(nh)) return fail('Redirect points to a private address', 400)
      res = await fetch(next, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'image/*,video/*' } })
      hops++
    }
    if (!res.ok) return fail(`Remote server returned ${res.status}`, 422)
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim()
    const cl = Number(res.headers.get('content-length') || 0)
    if (cl > maxBytes) return fail(`Remote file too large (${Math.round(cl / 1024 / 1024)} MB)`, 413)
    const ab = await res.arrayBuffer()
    if (ab.byteLength > maxBytes) return fail(`Remote file too large (${Math.round(ab.byteLength / 1024 / 1024)} MB, limit ${Math.round(maxBytes / 1024 / 1024)} MB)`, 413)
    if (ab.byteLength < 100) return fail('Remote file appears empty', 422)
    return { buffer: Buffer.from(ab), mimeType: ct || 'application/octet-stream' }
  } catch (e) {
    return fail(`Could not fetch URL: ${String(e?.message || e).slice(0, 120)}`, 422)
  } finally {
    clearTimeout(t)
  }
}
