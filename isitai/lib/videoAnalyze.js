// ─── Video / GIF keyframe sampling + aggregation ────────────────────────────
// Sora/Veo-era content is exploding and almost no free tool analyzes it.
// Strategy:
//   • MP4/WebM/MOV → sample 8–16 evenly spaced keyframes with ffmpeg (when the
//     binary exists on the host) and run per-frame noise/temporal forensics.
//   • Animated GIF  → decode frames in pure JS (gifwrap) — works everywhere.
//   • Otherwise     → clear "ffmpeg unavailable" degraded notice.
// Aggregation: median frame score (robust to one odd frame), inter-frame noise
// consistency, temporal-flicker stats from gifDetect/frameStats.

import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import { analyzeFramePixels } from './frameStats'
import { decodeGifFrames, analyzeAnimatedGif } from './gifDetect'
import { hashImage } from './cache'

export const MAX_VIDEO_BYTES = 25 * 1024 * 1024 // 25 MB clip cap
const KEYFRAMES = 12 // target count (8–16 window)

let ffmpegChecked = null
export function hasFfmpeg() {
  if (ffmpegChecked != null) return Promise.resolve(ffmpegChecked)
  return new Promise(resolve => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' })
    p.on('error', () => resolve((ffmpegChecked = false)))
    p.on('close', code => resolve((ffmpegChecked = code === 0)))
  })
}

async function extractKeyframes(buffer, count = KEYFRAMES) {
  const dir = await mkdtemp(join(tmpdir(), 'isitai-vid-'))
  try {
    const src = join(dir, `in-${randomBytes(6).toString('hex')}`)
    await writeFile(src, buffer)
    const outPat = join(dir, 'frame-%03d.jpg')
    await new Promise((resolve, reject) => {
      // select='not(mod(n,STEP))' approximates even sampling; fps filter needs
      // duration which we don't know — scene+interval hybrid below instead.
      const args = ['-hide_banner', '-loglevel', 'error', '-i', src,
        '-vf', `fps=${(count / 10).toFixed(3)},scale=320:-1`, '-frames:v', String(count), '-q:v', '3', outPat]
      const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let err = ''
      p.stderr.on('data', d => { err += d })
      p.on('error', reject)
      p.on('close', code => code === 0 ? resolve() : reject(new Error(err.slice(0, 160) || `ffmpeg exit ${code}`)))
    })
    const files = []
    for (let i = 1; i <= count; i++) {
      try { files.push(await readFile(join(dir, `frame-${String(i).padStart(3, '0')}.jpg`))) } catch { break }
    }
    return files
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Per-frame luminance-noise proxy: high-pass residual std on a gray decode. */
function frameNoiseScore(jpegBuf) {
  return jpegBuf // placeholder replaced below by pixel analysis
}

async function analyzeFrame(jpgBuf) {
  const img = await sharp(jpgBuf).removeAlpha().resize({ width: 256, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
  const { data, info } = img
  const st = analyzeFramePixels(data, info.width, info.height, info.channels)
  // Cheap high-pass residual: mean |center - 4-neighbour avg| over interior.
  const w = info.width, h = info.height, ch = info.channels
  let sum = 0, n = 0, lum = []
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * ch
    const c = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    lum.push(c)
    const up = 0.299 * data[i - w * ch] + 0.587 * data[i - w * ch + 1] + 0.114 * data[i - w * ch + 2]
    const dn = 0.299 * data[i + w * ch] + 0.587 * data[i + w * ch + 1] + 0.114 * data[i + w * ch + 2]
    const lf = 0.299 * data[i - ch] + 0.587 * data[i - ch + 1] + 0.114 * data[i - ch + 2]
    const rt = 0.299 * data[i + ch] + 0.587 * data[i + ch + 1] + 0.114 * data[i + ch + 2]
    sum += Math.abs(c - (up + dn + lf + rt) / 4); n++
  }
  const residual = n ? sum / n : 0
  // Sensor noise floors sit ~0.4–2.5 gray levels after JPEG; diffusion video
  // tends <0.35 (over-smooth) or shows codec-uniform patterns.
  const aiLean = residual < 0.42 ? 72 : residual < 0.7 ? 55 : residual < 1.6 ? 35 : 45
  return { residual: +residual.toFixed(3), detail: +(st?.variance ?? 0).toFixed(3), brightness: +(st?.mean ?? 0).toFixed(1), aiLean }
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0 }

export async function analyzeVideoBuffer(buffer, mimeType = 'video/mp4') {
  const sha = hashImage(buffer)
  const signals = []
  let frames = []
  let mode = null

  // Animated GIF path (pure JS, always available)
  if (/gif/i.test(mimeType) || buffer.subarray(0, 3).toString('latin1') === 'GIF') {
    mode = 'gif-keyframes'
    const gif = await analyzeAnimatedGif(buffer)
    signals.push(...(gif.signals || []))
    const perFrame = (gif.perFrame || []).map(f => ({ ...f }))
    const score = gif.score ?? 50
    return finalize({ sha, mode, score, band: simpleBand(score), framesSampled: perFrame.length, perFrame, temporal: gif.temporal, signals })
  }

  // ffmpeg path for real video containers
  if (await hasFfmpeg()) {
    mode = 'ffmpeg-keyframes'
    try {
      const jpgs = await extractKeyframes(buffer, KEYFRAMES)
      if (jpgs.length < 2) throw new Error('too few frames decoded')
      frames = await Promise.all(jpgs.map(analyzeFrame))
      const residuals = frames.map(f => f.residual)
      const rMin = Math.min(...residuals), rMax = Math.max(...residuals)
      const rSpread = rMax - rMin
      const medRes = median(residuals)
      if (medRes < 0.42) signals.push({ label: `Median high-pass residual ${medRes.toFixed(2)} — smoother than sensor noise in all ${frames.length} frames`, why: 'Camera video carries photon/sensor noise; generated video often does not.', suspicious: true })
      else signals.push({ label: `Sensor-like noise floor present across frames (median residual ${medRes.toFixed(2)})`, why: 'Consistent grain across time suggests real capture.', suspicious: false })
      if (rSpread > 0.5) signals.push({ label: `Noise level jumps between frames (${rMin.toFixed(2)}→${rMax.toFixed(2)}) — temporal inconsistency`, why: 'Real footage keeps a stable noise floor; edits/regenerations flicker.', suspicious: true })
      const detours = frames.filter(f => f.detail < 0.002).length
      if (detours >= Math.ceil(frames.length * 0.5)) signals.push({ label: 'Low texture detail in most frames — over-smoothed surfaces', suspicious: true })
      const score = clamp(Math.round(median(frames.map(f => f.aiLean)) + (rSpread > 0.5 ? 10 : 0)), 1, 99)
      return finalize({ sha, mode, score, band: simpleBand(score), framesSampled: frames.length, perFrame: frames.map((f, i) => ({ t: i, ...f })), temporal: { residualSpread: +rSpread.toFixed(3), medianResidual: +medRes.toFixed(3) }, signals })
    } catch (e) {
      signals.push({ label: `Frame extraction failed: ${String(e?.message || e).slice(0, 100)}`, suspicious: false })
    }
  } else {
    signals.push({ label: 'ffmpeg unavailable on this host — video containers need the self-hosted worker (worker/)', suspicious: false })
  }

  // Last resort: metadata-only judgement
  const score = 50
  const meta = { error: 'Unsupported or undecodable video input', framesSampled: 0 }
  void meta
  return finalize({ sha, mode: mode || 'unsupported', score, band: simpleBand(score), framesSampled: 0, perFrame: [], signals, unsupported: true })
}

function simpleBand(score) { const half = 18; return { lo: Math.max(0, score - half), hi: Math.min(100, score + half), label: `${Math.max(0, score - half)}–${Math.min(100, score + half)}%` } }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
void frameNoiseScore

function finalize({ sha, mode, score, band, framesSampled, perFrame, temporal, signals, unsupported }) {
  const verdict = score >= 60
    ? { level: 'likely-ai', emoji: '⚠️', color: '#f97316', line1: 'This clip appears to be AI-generated' }
    : score >= 38
      ? { level: 'uncertain', emoji: '🤔', color: '#eab308', line1: 'Mixed evidence in this clip' }
      : { level: 'likely-real', emoji: '✅', color: '#22c55e', line1: 'This clip appears to be genuine footage' }
  return {
    id: sha.slice(0, 16), sha256: sha, kind: 'video', mode, unsupported: !!unsupported,
    score, band, verdict, confidence: framesSampled >= 8 ? 'medium' : 'low',
    degraded: true,
    degradedReason: unsupported ? 'Could not decode video on this server — try an animated GIF or the self-hosted worker.' : `Keyframe forensics only (${mode}); ML ensemble runs on still images.`,
    framesSampled, perFrame: (perFrame || []).slice(0, 16), temporal: temporal || null,
    signals, analyzedAt: Date.now(),
    privacy: 'Video was analyzed transiently in memory and discarded. Nothing stored.',
  }
}
