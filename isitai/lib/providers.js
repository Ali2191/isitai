// ─── Multi-provider model ensemble with per-model circuit breakers ──────────
// The image classifier used to depend solely on Hugging Face Inference. This
// module adds Replicate and fal.ai as fallback providers plus a small
// circuit-breaker so a cold/rate-limited provider stops costing latency:
//
//   • every (provider, model) pair gets its own breaker: after 3 consecutive
//     failures it OPENs for 60 s (fail-fast), then half-opens for one probe;
//   • models are declared with a preferred provider but transparently fall
//     back to any other configured provider that can serve them;
//   • scores from all successful calls feed lib/fusion.js which combines them
//     with a weighted rank-average (robust to one wildly-off model) instead of
//     a single-vote or plain mean.
//
// Env keys:
//   HUGGINGFACE_API_KEY  → HF Inference router
//   REPLICATE_API_TOKEN  → replicate.com prediction API
//   FAL_KEY              → fal.run queue REST API ("keyid:keysecret")
//   MODEL_TIMEOUT_MS     → per-call timeout (default 12 000 ms)

const FAIL_THRESHOLD = Number(process.env.BREAKER_FAILS || 3)
const OPEN_MS = Number(process.env.BREAKER_OPEN_MS || 60_000)

// ── circuit breaker ──────────────────────────────────────────────────────────
const breakers = new Map() // key -> { fails, openedAt }

export function breakerState(key) {
  const b = breakers.get(key)
  if (!b) return 'closed'
  if (b.openedAt && Date.now() - b.openedAt > OPEN_MS) return 'half-open'
  return b.openedAt ? 'open' : 'closed'
}

export function breakerAllows(key) {
  return breakerState(key) !== 'open'
}

export function breakerRecord(key, ok) {
  const b = breakers.get(key) || { fails: 0, openedAt: null }
  if (ok) {
    b.fails = 0
    b.openedAt = null
  } else {
    b.fails += 1
    if (b.fails >= FAIL_THRESHOLD) b.openedAt = Date.now()
  }
  breakers.set(key, b)
}

/** Snapshot for /api/status — how healthy is each provider right now? */
export function breakerSnapshot() {
  const out = {}
  for (const [k, b] of breakers) out[k] = { fails: b.fails, state: breakerState(k) }
  return out
}

// ── provider registry ────────────────────────────────────────────────────────
export function activeProviders() {
  const list = []
  if (process.env.HUGGINGFACE_API_KEY) list.push('huggingface')
  if (process.env.REPLICATE_API_TOKEN) list.push('replicate')
  if (process.env.FAL_KEY) list.push('fal')
  return list
}

function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms) }),
  ])
}

// ── Hugging Face Inference router ────────────────────────────────────────────
async function hfClassify(modelName, buffer, mimeType, timeoutMs) {
  const key = process.env.HUGGINGFACE_API_KEY
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`https://router.huggingface.co/hf-inference/models/${modelName}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': mimeType },
      body: buffer,
      signal: controller.signal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 120)}`)
    }
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { throw new Error(`Non-JSON response: ${text.slice(0, 80)}`) }
    if (data.error) throw new Error(String(data.error).slice(0, 120))
    if (!Array.isArray(data)) throw new Error('Unexpected response format')
    const aiEntry = data.find(d => {
      const label = (d.label || '').toLowerCase()
      return label.includes('artificial') || label.includes('fake') || label.includes('ai') ||
        label === 'ai-generated' || label === 'generated' || label === 'deepfake' || label === 'positive'
    })
    if (!aiEntry) throw new Error(`No AI label in: ${data.map(d => d.label).join(', ')}`)
    return { aiScore: Math.round(aiEntry.score * 100), rawLabels: data.map(d => ({ label: d.label, score: Math.round(d.score * 100) })) }
  } finally { clearTimeout(t) }
}

// ── Replicate (image-classifier style deployments) ──────────────────────────
async function replicateClassify(modelName, buffer, timeoutMs) {
  const token = process.env.REPLICATE_API_TOKEN
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const b64 = buffer.toString('base64')
    const mime = 'image/jpeg'
    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait', // synchronous completion when supported
      },
      body: JSON.stringify({
        version: modelName, // pin a public version id or owner/name:version
        input: { img: `data:${mime};base64,${b64}` },
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 120)}`)
    }
    const j = await res.json()
    if (j.status && j.status !== 'succeeded') throw new Error(`replicate status: ${j.status}`)
    const out = j.output
    return normalizeOutput(out)
  } finally { clearTimeout(t) }
}

// ── fal.ai (queue REST, subscription-friendly) ──────────────────────────────
async function falClassify(endpoint, buffer, timeoutMs) {
  const key = process.env.FAL_KEY // "keyid:keysecret"
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`https://queue.fal.run/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: `data:image/jpeg;base64,${buffer.toString('base64')}` }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 120)}`)
    }
    let j = await res.json()
    // queue API returns a request id first — poll the status URL if needed
    if (j.status_url && !j.response) {
      const base = j.status_url.replace(/^https:\/\/queue\.fal\.run/, '')
      const statusUrl = base.startsWith('http') ? base : `https://queue.fal.run${base}`
      const logUrl = statusUrl.replace('/status/', '/status-stream/') + '?logs=0'
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const sr = await fetch(logUrl, { headers: { Authorization: `Key ${key}` }, signal: controller.signal })
        if (sr.ok) {
          const sj = await sr.json().catch(() => null)
          if (sj && (sj.status === 'COMPLETED' || sj.payload)) { j = sj.payload || sj; break }
          if (sj && sj.status === 'FAILED') throw new Error('fal request failed')
        }
        await new Promise(r => setTimeout(r, 900))
      }
    }
    return normalizeOutput(j.response ?? j.output ?? j)
  } finally { clearTimeout(t) }
}

/** Normalize heterogeneous classifier outputs → {aiScore, rawLabels}. */
function normalizeOutput(out) {
  if (out == null) throw new Error('empty output')
  if (typeof out === 'number') return { aiScore: Math.round(out <= 1 ? out * 100 : out), rawLabels: [{ label: 'score', score: Math.round(out) }] }
  if (typeof out === 'string') {
    if (/real|human|authentic/i.test(out)) return { aiScore: 5, rawLabels: [{ label: out, score: 95 }] }
    if (/ai|fake|generated|deepfake/i.test(out)) return { aiScore: 95, rawLabels: [{ label: out, score: 95 }] }
    const n = Number(out); if (Number.isFinite(n)) return normalizeOutput(n)
    throw new Error(`unparseable string output: ${out.slice(0, 40)}`)
  }
  if (Array.isArray(out)) {
    // replicate often returns [{label,score}] like HF
    const flat = out[0] && typeof out[0] === 'object' && 'label' in out[0] ? out : null
    if (flat) {
      const ai = flat.find(d => /ai|fake|generated|deepfake|artificial/i.test(d.label || ''))
      if (ai) return { aiScore: Math.round((ai.score <= 1 ? ai.score * 100 : ai.score)), rawLabels: flat.map(d => ({ label: d.label, score: Math.round(d.score <= 1 ? d.score * 100 : d.score) })) }
      throw new Error('no AI label in array output')
    }
    return normalizeOutput(out[0])
  }
  if (typeof out === 'object') {
    for (const k of ['ai_score', 'aiscore', 'probability', 'score', 'label']) {
      if (out[k] != null) {
        const v = out[k]
        if (typeof v === 'number') return { aiScore: Math.round(v <= 1 ? v * 100 : v), rawLabels: [{ label: k, score: Math.round(v <= 1 ? v * 100 : v) }] }
        if (typeof v === 'string') return normalizeOutput(v)
      }
    }
    throw new Error(`unrecognized object output: ${Object.keys(out).slice(0, 6).join(',')}`)
  }
  throw new Error('unrecognized output shape')
}

const PROVIDERS = {
  huggingface: { call: (m, buf, mime, to) => hfClassify(m.name, buf, mime, to) },
  replicate: { call: (m, buf, _mime, to) => replicateClassify(m.replicate || m.name, buf, to) },
  fal: { call: (m, buf, _mime, to) => falClassify(m.fal || m.name, buf, to) },
}

/**
 * Call one logical model through its preferred provider, falling back to any
 * other configured provider that knows it. Each (provider,model) pair has an
 * independent circuit breaker.
 * @returns {Promise<{aiScore:number, rawLabels:Array, provider:string}>}
 */
export async function callProvider(model, buffer, mimeType = 'image/jpeg', timeoutMs = Number(process.env.MODEL_TIMEOUT_MS || 12000)) {
  const chain = [model.provider, ...(model.fallbacks || [])].filter(Boolean)
  const errors = []
  for (const p of chain) {
    const impl = PROVIDERS[p]
    if (!impl) { errors.push(`${p}: unknown provider`); continue }
    if (!activeProviders().includes(p)) { errors.push(`${p}: not configured`); continue }
    const key = `${p}:${model.name}`
    if (!breakerAllows(key)) { errors.push(`${p}: circuit open`); continue }
    try {
      const r = await withTimeout(impl.call(model, buffer, mimeType, timeoutMs), timeoutMs + 1500, `${p}/${model.shortName || model.name}`)
      breakerRecord(key, true)
      return { ...r, provider: p }
    } catch (e) {
      breakerRecord(key, false)
      errors.push(`${p}: ${String(e?.message || e).slice(0, 110)}`)
    }
  }
  throw new Error(errors.join(' | ').slice(0, 240))
}
