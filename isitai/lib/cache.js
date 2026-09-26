// ─── Image result cache (LRU + TTL) ──────────────────────────────────────────
// Keyed by SHA-256 of the image bytes. Stores only ANALYSIS RESULTS — never
// the image itself (privacy guarantee). Entries expire after TTL_MS.

import { createHash } from 'crypto'

const MAX_ENTRIES = 300
const TTL_MS = 10 * 60 * 1000 // 10 minutes

const store = new Map() // hash -> { value, expiresAt }

export function hashImage(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function cacheGet(hash) {
  const e = store.get(hash)
  if (!e) return null
  if (e.expiresAt <= Date.now()) {
    store.delete(hash)
    return null
  }
  // refresh LRU recency
  store.delete(hash)
  store.set(hash, e)
  return e.value
}

export function cacheSet(hash, value) {
  if (store.size >= MAX_ENTRIES) {
    const firstKey = store.keys().next().value
    if (firstKey !== undefined) store.delete(firstKey)
  }
  store.set(hash, { value, expiresAt: Date.now() + TTL_MS })
}

// Lookup by the short public id (first 16 hex chars of the SHA-256).
// Used by GET /api/detect?id=… — returns results only, never images.
export function getCached(id) {
  if (!id || typeof id !== 'string') return null
  for (const [hash, e] of store) {
    if (e.expiresAt <= Date.now()) { store.delete(hash); continue }
    if (hash.startsWith(id)) return e.value
  }
  return null
}
