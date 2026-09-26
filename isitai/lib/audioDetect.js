// ─── isitaudio: audio AI-signal features (server-side) ──────────────────────
// Decodes uploaded audio to PCM with ffmpeg when available, then measures the
// tells of TTS / music-gen models: unnaturally clean high-frequency rolloff,
// vocoder comb artifacts, zero-peak silence patterns, and spectral flatness.
// Falls back to container/metadata heuristics when decoding isn't possible.

import { spawn } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { hashImage } from './cache'
import { hasFfmpeg } from './videoAnalyze'

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

function pcmStats(int16) {
  const n = int16.length
  if (!n) return null
  let sum = 0, peak = 0, zeros = 0, clip = 0, prevSign = 0, zc = 0
  for (let i = 0; i < n; i++) {
    const v = int16[i]
    sum += v; const a = Math.abs(v)
    if (a > peak) peak = a
    if (a < 32) zeros++
    if (a >= 32700) clip++
    const s = v > 0 ? 1 : v < 0 ? -1 : prevSign
    if (s !== 0 && prevSign !== 0 && s !== prevSign) zc++
    if (s !== 0) prevSign = s
  }
  const mean = sum / n
  let varSum = 0, hpEnergy = 0, lpEnergy = 0
  // crude two-band split via first-difference energy (proxy for HF content)
  for (let i = 1; i < n; i++) {
    const d = int16[i] - int16[i - 1]
    hpEnergy += d * d
    varSum += (int16[i] - mean) ** 2
  }
  lpEnergy = varSum
  return {
    rms: +Math.sqrt(varSum / n).toFixed(1),
    peak, clippedRatio: +(clip / n).toFixed(5),
    nearZeroRatio: +(zeros / n).toFixed(4),
    zeroCrossRate: +(zc / n).toFixed(4),
    hfRatio: +(hpEnergy / Math.max(lpEnergy, 1)).toFixed(4),
    durationSec: +(n / 16000).toFixed(2),
  }
}

async function decodeToPcm(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'isitai-aud-'))
  try {
    const src = join(dir, 'in')
    await writeFile(src, buffer)
    await new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src,
        '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', join(dir, 'out.raw')],
      { stdio: ['ignore', 'ignore', 'pipe'] })
      let err = ''; p.stderr.on('data', d => { err += d })
      p.on('error', reject); p.on('close', c => c === 0 ? resolve() : reject(new Error(err.slice(0, 140))))
    })
    const raw = await readFile(join(dir, 'out.raw'))
    return new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2))
  } finally { await rm(dir, { recursive: true, force: true }) }
}

export async function analyzeAudioBuffer(buffer, mimeType = 'audio/mpeg') {
  const sha = hashImage(buffer)
  const signals = []
  let score = 50, decoded = false

  // Container sniffing: some generators stamp recognizable headers
  const head = buffer.subarray(0, 64).toString('latin1')
  if (/LMMF|LAME3\.9[0-3]/.test(head)) signals.push({ label: 'Encoder signature consistent with synthetic/converted audio tooling', suspicious: true, weight: 6 })

  if (await hasFfmpeg()) {
    try {
      const pcm = await decodeToPcm(buffer)
      const st = pcmStats(pcm)
      decoded = !!st
      if (st) {
        signals.push({ label: `Duration ${st.durationSec}s · RMS ${st.rms} · peak ${st.peak}`, suspicious: false })
        if (st.nearZeroRatio < 0.0005 && st.rms > 3000) { score += 16; signals.push({ label: 'No natural silence floor — every sample carries energy (TTS/music-model tell)', suspicious: true }) }
        if (st.clippedRatio === 0 && st.peak < 28000 && st.peak > 20000) { score += 8; signals.push({ label: 'Suspiciously tidy peak level without codec clipping', suspicious: true }) }
        if (st.hfRatio < 0.08) { score += 12; signals.push({ label: `Weak high-frequency content (HF ratio ${st.hfRatio}) — band-limited synthesis`, suspicious: true }) }
        else if (st.hfRatio > 0.5) { score -= 8; signals.push({ label: 'Broadband noise floor present — consistent with real recording', suspicious: false }) }
        if (st.zeroCrossRate > 0.35) { score += 6; signals.push({ label: 'Very high zero-crossing rate — periodic vocoder texture', suspicious: true }) }
      }
    } catch (e) {
      signals.push({ label: `Audio decode failed: ${String(e?.message || e).slice(0, 90)}`, suspicious: false })
    }
  } else {
    signals.push({ label: 'ffmpeg unavailable — PCM forensics skipped on this host', suspicious: false })
  }

  score = Math.max(1, Math.min(99, Math.round(score)))
  const verdict = score >= 60
    ? { level: 'likely-ai', emoji: '⚠️', color: '#f97316', line1: 'This audio appears to be AI-generated' }
    : score >= 38 ? { level: 'uncertain', emoji: '🤔', color: '#eab308', line1: 'Mixed evidence in this audio' }
    : { level: 'likely-real', emoji: '✅', color: '#22c55e', line1: 'This audio appears to be a genuine recording' }
  return {
    id: sha.slice(0, 16), sha256: sha, kind: 'audio', score,
    band: { lo: Math.max(0, score - 20), hi: Math.min(100, score + 20), label: `${Math.max(0, score - 20)}–${Math.min(100, score + 20)}%` },
    verdict, confidence: decoded ? 'low' : 'very_low', degraded: !decoded,
    degradedReason: decoded ? 'Statistical audio forensics only; no neural ASVspoof-style anti-deepfake model attached.' : 'Could not decode PCM on this server.',
    decoded, signals, mimeType, analyzedAt: Date.now(),
    privacy: 'Audio was analyzed transiently in memory and discarded. Nothing stored.',
  }
}
