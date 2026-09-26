// ─── isitext: statistical text-AI signals (server-side, dependency-free) ────
// Fast, transparent stylometry features that separate LLM prose from human
// writing. Not a black-box classifier — every feature is explainable and the
// score fuses them with an optional RoBERTa-style model via the self-hosted
// worker (worker/app.py /classify_text) or HF Inference when configured.
//
// Layer architecture mirrors the image pipeline: each numbered layer owns a
// family of signals and contributes to the fused 0–100 AI-likelihood score,
// so the UI can present per-layer evidence cards exactly like /api/detect.

const STOPWORDS = new Set(('the a an and or but if then than that this these those of in on at to for from with without is are was were be been being it its as by not no yes so such can will would could should may might must do does did done have has had having i you he she we they them their your his her our what which who whom whose when where why how all any both each few more most other some no nor and'.split(' ')))

function tokenize(text) { return (text.toLowerCase().match(/[a-z']+/g) || []) }

function sentenceSplit(text) {
  return text.split(/(?<=[.!?…])\s+(?=[A-Z"'(])/).map(s => s.trim()).filter(Boolean)
}

function burstiness(values) {
  // coefficient of variation of sentence lengths — humans vary more
  const n = values.length
  if (n < 2) return 0
  const m = values.reduce((a, b) => a + b, 0) / n
  if (!m) return 0
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1))
  return sd / m
}

export function analyzeTextFeatures(text) {
  const clean = String(text || '').replace(/\r/g, '')
  const words = tokenize(clean)
  const sentences = sentenceSplit(clean)
  const signals = []
  let score = 50

  if (words.length < 40) {
    return { score: null, confidence: 'none', signals: [{ label: 'Too little text (<40 words) for reliable stylometry', suspicious: false }], features: null }
  }

  const sentLens = sentences.map(s => tokenize(s).length)
  const burst = burstiness(sentLens)
  const avgLen = sentLens.reduce((a, b) => a + b, 0) / Math.max(sentLens.length, 1)

  // type-token ratio (lexical diversity) over first 200 tokens
  const head = words.slice(0, 200)
  const ttr = new Set(head).size / head.length

  const uniqueWordFreq = {}
  for (const w of words) if (!STOPWORDS.has(w)) uniqueWordFreq[w] = (uniqueWordFreq[w] || 0) + 1
  const contentTypes = Object.keys(uniqueWordFreq).length
  const rareish = Object.values(uniqueWordFreq).filter(c => c === 1).length
  const hapaxRatio = contentTypes ? rareish / contentTypes : 0

  // punctuation profile
  const emDash = (clean.match(/—/g) || []).length
  const semis = (clean.match(/;/g) || []).length
  const quotes = (clean.match(/["“”]/g) || []).length
  const per100 = x => x / (words.length / 100)

  // hedge/listing phrases common in RLHF-tuned output
  const PHRASES = ['delve', 'in conclusion', "it's important to note", 'important to note', 'tapestry', 'navigate the', 'a testament to', 'foster', 'ever-evolving', 'in today\u2019s world', 'plays a crucial role', 'showcase', 'meticulous', 'harness the power', 'seamless', 'robust', 'leveraging', 'moreover,', 'additionally,', 'overall,']
  const lower = clean.toLowerCase()
  const hits = PHRASES.filter(p => lower.includes(p))

  // repetition of sentence openers
  const openers = sentences.map(s => tokenize(s).slice(0, 2).join(' ')).filter(Boolean)
  const openerRepeat = openers.length ? 1 - new Set(openers).size / openers.length : 0

  const features = {
    words: words.length, sentences: sentences.length,
    avgSentenceLength: +avgLen.toFixed(1), burstiness: +burst.toFixed(3),
    typeTokenRatio: +ttr.toFixed(3), hapaxRatio: +hapaxRatio.toFixed(3),
    emDashPer100: +per100(emDash).toFixed(2), semicolonsPer100: +per100(semis).toFixed(2),
    phraseHits: hits.slice(0, 8), openerRepetition: +openerRepeat.toFixed(2),
  }

  // ── fuse into 0–100 AI-likelihood ──
  if (burst < 0.35) { score += 18; signals.push({ label: `Very even sentence lengths (burstiness ${burst.toFixed(2)}) — uniform rhythm typical of LLM output`, suspicious: true }) }
  else if (burst > 0.6) { score -= 14; signals.push({ label: `Highly varied sentence rhythm (burstiness ${burst.toFixed(2)}) — human-like`, suspicious: false }) }
  if (avgLen > 24) { score += 8; signals.push({ label: `Long average sentence (${avgLen.toFixed(0)} words)`, suspicious: true }) }
  if (ttr < 0.45) { score += 10; signals.push({ label: `Low lexical diversity (TTR ${ttr.toFixed(2)})`, suspicious: true }) }
  else if (ttr > 0.62) { score -= 8; signals.push({ label: `Rich vocabulary (TTR ${ttr.toFixed(2)})`, suspicious: false }) }
  if (hapaxRatio > 0.55) { score -= 8; signals.push({ label: 'Many one-off word choices — idiosyncratic, human-like', suspicious: false }) }
  if (per100(emDash) > 0.8) { score += 8; signals.push({ label: `Frequent em-dashes (${per100(emDash).toFixed(1)} per 100 words) — GPT style marker`, suspicious: true }) }
  if (hits.length >= 2) { score += 6 * Math.min(hits.length, 4); signals.push({ label: `LLM-cliché phrases: ${hits.slice(0, 4).join(', ')}`, suspicious: true }) }
  else if (hits.length === 1) { score += 4; signals.push({ label: `One LLM-cliché phrase: ${hits[0]}`, suspicious: true }) }
  if (openerRepeat > 0.35) { score += 8; signals.push({ label: `Repeated sentence openers (${Math.round(openerRepeat * 100)}% duplicated)`, suspicious: true }) }
  if (quotes / Math.max(sentences.length, 1) > 0.5) { score += 5; signals.push({ label: 'Unusual scare-quoted term density', suspicious: true }) }

  return {
    score: Math.max(1, Math.min(99, Math.round(score))),
    confidence: words.length > 160 ? 'medium' : 'low',
    signals, features,
  }
}

// Optional model check through the same self-hosted worker used for images.
export async function classifyTextWithWorker(text) {
  const base = process.env.MODEL_WORKER_URL
  if (!base) return null
  const url = base.replace(/\/$/, '') + '/classify_text'
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 4000) }),
      signal: controller.signal,
    })
    clearTimeout(t)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = await res.json()
    if (typeof j.aiScore !== 'number') throw new Error('bad worker response')
    return { name: 'worker:text-classifier', aiScore: Math.round(j.aiScore), source: 'worker' }
  } catch (e) {
    clearTimeout(t)
    throw new Error(String(e?.message || e).slice(0, 120))
  }
}

// ─── Sentence-level localization ("saliency" for text) ───────────────────────
// The image pipeline answers WHICH region of a photo looks synthetic; this
// answers WHICH sentences of a passage look machine-written. Each sentence is
// scored on its own burstiness contribution, cliché hits, opener repetition
// and rhythm uniformity, then normalized to a 0–1 suspicion value so the UI
// can render an inline heatmap over the original text.
const SENTENCE_CLICHES = ['delve', 'tapestry', 'a testament to', 'in conclusion', "it's important to note", 'important to note', 'navigate the', 'ever-evolving', 'plays a crucial role', 'harness the power', 'moreover', 'additionally', 'foster', 'seamless', 'meticulous', 'robust', 'leveraging', 'in today']

export function analyzeTextLocalization(text) {
  const clean = String(text || '').replace(/\r/g, '')
  // keep byte offsets so the UI can highlight the ORIGINAL passage
  const parts = []
  const re = /(?<=[.!?…])\s+(?=[A-Z"'(])/
  let cursor = 0
  const chunks = clean.split(re)
  for (const chunk of chunks) {
    const idx = clean.indexOf(chunk, cursor)
    if (idx === -1) continue
    parts.push({ start: idx, end: idx + chunk.length, raw: chunk })
    cursor = idx + chunk.length
  }
  if (parts.length < 2) return null

  const tokenCounts = parts.map(p => tokenize(p.raw).length)
  const meanLen = tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length
  const sd = Math.sqrt(tokenCounts.reduce((a, b) => a + (b - meanLen) ** 2, 0) / tokenCounts.length) || 1e-9
  const openers = parts.map(p => tokenize(p.raw).slice(0, 2).join(' '))
  const openerFreq = {}
  for (const o of openers) openerFreq[o] = (openerFreq[o] || 0) + 1

  const sentences = parts.map((p, i) => {
    const toks = tokenize(p.raw)
    const n = toks.length
    const lower = p.raw.toLowerCase()
    let v = 0.5 // neutral prior
    const reasons = []
    // length close to the passage average → uniform rhythm (AI tell)
    const z = Math.abs(tokenCounts[i] - meanLen) / sd
    if (z < 0.35 && parts.length >= 5) { v += 0.22; reasons.push('sentence length matches the passage average — uniform rhythm') }
    else if (z > 1.2) { v -= 0.18; reasons.push('length deviates from the average — human-like variation') }
    const clic = SENTENCE_CLICHES.filter(c => lower.includes(c))
    if (clic.length) { v += 0.15 * Math.min(clic.length, 3); reasons.push(`LLM-cliché: ${clic.slice(0, 2).join(', ')}`) }
    if ((openerFreq[openers[i]] || 0) >= 2 && openers[i]) { v += 0.12; reasons.push('repeated sentence opener') }
    if (/—/.test(p.raw)) { v += 0.06; reasons.push('em-dash aside') }
    if (/[a-z]{2,}\s[a-z]{2,}\s[a-z]{2,}/.test(lower) && n < 6) { v -= 0.1 }
    if (n < 3) v = Math.min(v, 0.45) // fragments are usually human
    return {
      index: i, start: p.start, end: p.end,
      preview: p.raw.trim().slice(0, 140),
      words: n,
      suspicion: +Math.max(0, Math.min(1, v)).toFixed(3),
      reasons,
    }
  })

  const flagged = sentences
    .filter(s => s.suspicion >= 0.72)
    .sort((a, b) => b.suspicion - a.suspicion)
    .slice(0, 5)
  const mean = +(sentences.reduce((a, s) => a + s.suspicion, 0) / sentences.length).toFixed(3)
  return { kind: 'sentence', count: sentences.length, mean, flagged, sentences }
}
