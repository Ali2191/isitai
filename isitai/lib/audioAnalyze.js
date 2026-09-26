// ─── isitaudio pipeline orchestrator ─────────────────────────────────────────
// Mirrors lib/analyze.js (images) and lib/textAnalyze.js (text): fuses the PCM
// statistics from audioDetect.js with container-structure checks, an optional
// neural anti-spoofing worker model and the waveform localization strip into
// ONE response envelope the shared UI consumes:
//   { kind, score, band, verdict, confidence, degraded, layers{...}, waveform }

import { analyzeAudioBuffer } from './audioDetect.js'
import { explainSignal } from './signals.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ─── Layer: container & header structure ─────────────────────────────────────
export function analyzeAudioStructure(buffer, mimeType = '') {
  const head = buffer.subarray(0, 64)
  const latin = head.toString('latin1')
  const signals = []
  let s = 0

  if (/^RIFF/.test(latin) && /^WAVE/.test(latin.slice(8, 12))) {
    // canonical WAV: data chunk size should match file length closely
    const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    let dataChunk = null, fmtBytes = null
    for (let off = 12; off + 8 <= Math.min(buffer.length, 4096); ) {
      const id = latin.slice(off, off + 4) || String.fromCharCode(...new Uint8Array(buffer.subarray(off, off + 4)))
      const size = dv.getUint32(off + 4, true)
      if (id === 'data') dataChunk = size
      if (id === 'fmt ') fmtBytes = size
      off += 8 + size + (size % 2)
    }
    if (dataChunk != null && Math.abs(dataChunk - (buffer.length - 44)) > Math.max(64, buffer.length * 0.05)) {
      s += 10; signals.push({ label: 'WAV data-chunk length disagrees with file size — generated or spliced container', suspicious: true })
    } else {
      signals.push({ label: 'Well-formed WAV container (RIFF/fmt/data consistent)', suspicious: false })
    }
    if (fmtBytes === 40) { s += 4; signals.push({ label: 'EXTENSIBLE WAV format — typical of export pipelines rather than recorders', suspicious: true }) }
  } else if (/^ID3|^[\u00FF\u00FB]/.test(latin) || mimeType.includes('mpeg')) {
    if (/Lavf|Lavc|libav/i.test(buffer.subarray(0, 2048).toString('latin1'))) {
      s += 8; signals.push({ label: 'ffmpeg/Libav encoder tags — synthetic render or transcode chain', suspicious: true })
    }
  } else if (/^OggS/.test(latin)) {
    signals.push({ label: 'Ogg container parsed', suspicious: false })
  } else if (/^\u0000\u0000\u0000(f| )ftyp/.test(latin)) {
    const brand = latin.slice(8, 12)
    if (/M4A |mp42|isom/.test(brand)) signals.push({ label: `ISO-BMFF audio container (${brand.trim()})`, suspicious: false })
  } else {
    s += 6; signals.push({ label: 'Unrecognized audio container — cannot validate recorder metadata', suspicious: true })
  }

  return { score: clamp(s + 20, 0, 90), signals, confidence: 'low' }
}

// Optional neural anti-deepfake model through the self-hosted worker.
export async function classifyAudioWithWorker(buffer) {
  const base = process.env.MODEL_WORKER_URL
  if (!base) return null
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/classify_audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(process.env.MODEL_WORKER_TOKEN ? { Authorization: `Bearer ${process.env.MODEL_WORKER_TOKEN}` } : {}),
      },
      body: new Uint8Array(buffer),
      signal: controller.signal,
    })
    clearTimeout(t)
    if (!res.ok) throw new Error(`worker HTTP ${res.status}`)
    const j = await res.json()
    if (typeof j.aiScore !== 'number') throw new Error('worker: missing aiScore')
    return { name: j.model || 'self-hosted-asv', shortName: `worker:${(j.model || 'asvspoof').split('/').pop()}`, aiScore: Math.round(j.aiScore), source: 'worker' }
  } catch (e) {
    clearTimeout(t)
    throw new Error(String(e?.message || e).slice(0, 120))
  }
}

const annotate = arr => (arr || []).map(s => ({ ...s, why: s.why || explainSignal(s.label) }))

/**
 * Full audio-analysis pipeline: PCM forensics + container structure + optional
 * neural model, fused like the image detector's nine-layer ensemble.
 */
export async function analyzeAudioPassage(buffer, mimeType = 'audio/mpeg') {
  const pcm = await analyzeAudioBuffer(buffer, mimeType)
  const structure = analyzeAudioStructure(buffer, mimeType)

  let model = null, modelError = null
  try { model = await classifyAudioWithWorker(buffer) } catch (e) { modelError = String(e?.message || e).slice(0, 120) }

  // fuse: PCM stats own the score; structure nudges; model dominates when present
  let score = pcm.score
  score = Math.round(score * 0.7 + structure.score * 0.3)
  if (model) score = Math.round(score * 0.45 + model.aiScore * 0.55)
  score = clamp(score, 1, 99)

  const half = model ? 14 : pcm.decoded ? 20 : 26
  const lo = clamp(score - half, 0, 100), hi = clamp(score + half, 0, 100)
  const band = { lo, hi, label: `${lo}–${hi}%`, width: hi - lo }
  const verdict = score >= 60
    ? { level: 'likely-ai', emoji: '⚠️', color: '#f97316', line1: 'This audio appears to be AI-generated' }
    : band.lo < 60 && band.hi >= 38
      ? { level: 'uncertain', emoji: '🤔', color: '#eab308', line1: "We're uncertain about this audio" }
      : { level: 'likely-real', emoji: '✅', color: '#22c55e', line1: 'This audio appears to be a genuine recording' }

  return {
    ...pcm,
    score, band, verdict,
    confidence: model ? 'medium' : pcm.confidence,
    degraded: !model,
    degradedReason: model ? null : 'Statistical DSP forensics only — configure MODEL_WORKER_URL to attach a neural ASVspoof-style anti-spoofing model.',
    modelError,
    layers: {
      models: {
        available: !!model,
        degraded: !model,
        reason: model ? null : 'no anti-spoofing model attached',
        combined: model?.aiScore ?? null,
        results: model ? [{ name: model.name, shortName: model.shortName, weight: 0.55, aiScore: model.aiScore }] : [],
        failed: modelError ? [modelError] : [],
        disagreement: false, spread: 0,
        confidence: model ? 'medium' : 'very_low',
      },
      waveform: { score: pcm.score, decoded: pcm.decoded, stats: pcm.stats, signals: annotate(pcm.signals) },
      structure: { ...structure, signals: annotate(structure.signals) },
    },
  }
}
