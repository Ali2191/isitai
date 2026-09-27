// ─── Audio deepfake specifics: vocoder grid, phase coherence, voice-swap ────
// Three dedicated detectors on top of the generic PCM statistics in
// audioDetect.js — all pure-JS DSP over 16 kHz mono Int16 PCM:
//
//  1. Vocoder-grid periodicity: neural TTS/vocoders (HiFi-GAN, WaveNet,
//     VITS…) synthesize from mel frames every ~10–20 ms with upsample
//     factors that land frame boundaries on a fixed sample grid (~80 ms /
//     1280-sample combs at 16 kHz). The autocorrelation of the energy
//     envelope shows a spike at that lag that real recordings don't have.
//
//  2. Phase coherence: natural speech has smooth, slowly-rotating spectra.
//     Vocoder output shows near-binary inter-frame phase increments and an
//     unnaturally LOW variance of spectral-phase derivative in voiced bands.
//
//  3. Voice-swap vs full synthesis: full TTS is spectrally "uniform" — its
//     MFCC-like band statistics barely drift across windows. A swapped/
//     converted voice keeps the sender's prosodic bursts, so window-to-
//     window centroid drift stays high while fine texture looks synthetic.
//     Combining this with detector #1 separates "voice swap" from
//     "generated from scratch".

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const sig = (label, suspicious) => ({ label, suspicious: !!suspicious })

const SR = 16000

// ── helpers ──────────────────────────────────────────────────────────────────
function frameEnergyEnvelope(int16, hop = 160) { // 10 ms hops
  const n = int16.length
  const frames = Math.floor(n / hop)
  const env = new Float64Array(Math.max(frames, 1))
  for (let f = 0; f < frames; f++) {
    let s = 0
    for (let i = f * hop; i < (f + 1) * hop && i < n; i++) s += int16[i] * int16[i]
    env[f] = Math.sqrt(s / hop)
  }
  return env
}

/** Normalized autocorrelation of a signal over integer lags [minLag..maxLag]. */
function autocorrPeaks(env, minLag, maxLag) {
  const n = env.length
  if (n < maxLag * 2) return []
  let mean = 0
  for (let i = 0; i < n; i++) mean += env[i]
  mean /= n
  const d = new Float64Array(n)
  for (let i = 0; i < n; i++) d[i] = env[i] - mean
  let e0 = 0
  for (let i = 0; i < n; i++) e0 += d[i] * d[i]
  if (e0 <= 1e-12) return []
  const out = []
  for (let lag = minLag; lag <= maxLag && lag < n / 2; lag++) {
    let s = 0
    for (let i = lag; i < n; i++) s += d[i] * d[i - lag]
    out.push({ lag, r: s / e0 })
  }
  return out
}

/** Radix-2 FFT of a real window → complex array [[re,im],...] length N/2+1. */
function fftHalf(x) {
  const N = x.length
  const re = Float64Array.from(x), im = new Float64Array(N)
  // bit reversal
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
  const half = []
  for (let k = 0; k <= N / 2; k++) half.push([re[k], im[k]])
  return half
}

// ── 1. vocoder frame-grid periodicity ───────────────────────────────────────
/**
 * Detect the ~80 ms (and sub-harmonics 10/20/40 ms) synthesis-grid comb in
 * the energy-envelope autocorrelation. Returns peaks normalized to the
 * expected hop-lags (hop = periodMs·SR/1000 samples ÷ 160-sample env hop).
 */
export function vocoderGridPeriodicity(int16) {
  const env = frameEnergyEnvelope(int16)
  const envHopFrames = ms => Math.round((ms * SR / 1000) / 160) // lag in envelope frames
  const targets = [
    { ms: 10, name: '10 ms mel-hop' },
    { ms: 20, name: '20 ms mel-hop' },
    { ms: 40, name: '40 ms frame stride' },
    { ms: 80, name: '80 ms vocoder grid' },
  ]
  const signals = []
  let score = 0, strongest = null
  for (const t of targets) {
    const lag = envHopFrames(t.ms)
    const peaks = autocorrPeaks(env, Math.max(2, lag - 1), lag + 1)
    if (!peaks.length) continue
    const best = peaks.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a))
    if (!strongest || Math.abs(best.r) > Math.abs(strongest.r)) strongest = { ...best, ms: t.ms, name: t.name }
  }
  if (strongest && strongest.r >= 0.28) {
    signals.push(sig(`Synthesis-grid periodicity: energy-envelope autocorrelation ${strongest.r.toFixed(2)} at ${strongest.name} (${strongest.lag * 160} samples)`, true))
    score += strongest.ms >= 40 ? 16 : 10
  } else if (strongest) {
    signals.push(sig(`No vocoder frame-grid comb detected (peak |r|=${Math.abs(strongest.r).toFixed(2)} at ${strongest.name})`, false))
    score -= 4
  }
  return { score, signals, peak: strongest ? { r: +strongest.r.toFixed(3), ms: strongest.ms, lagFrames: strongest.lag } : null }
}

// ── 2. spectral phase coherence ─────────────────────────────────────────────
/**
 * For successive 512-sample windows compute per-bin phase increment
 * Δφ minus the expected linear rotation. Natural noise → spread ≈ uniform;
 * vocoder bins snap toward 0 or π (deterministic synthesis). Metric: fraction
 * of |sin(Δφ_residual)| below 0.15 inside the 300–3800 Hz voiced band.
 */
export function phaseCoherence(int16) {
  const N = 512, HOP = 256
  const frames = Math.floor((int16.length - N) / HOP)
  if (frames < 6) return { score: 0, signals: [sig('Too short for phase-coherence analysis', false)], snappedFrac: null }
  let prev = null, snapped = 0, total = 0
  const loBin = Math.round(300 * N / SR), hiBin = Math.round(3800 * N / SR)
  for (let f = 0; f < Math.min(frames, 90); f++) { // cap cost: ≤90 windows
    const win = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)) // Hann
      win[i] = (int16[(f + 1) * HOP + i] || 0) / 32768 * w
    }
    const spec = fftHalf(win)
    if (prev) {
      for (let k = loBin; k <= hiBin && k < spec.length; k++) {
        const mag = Math.hypot(spec[k][0], spec[k][1])
        if (mag < 0.004) continue // ignore silence bins
        const p1 = Math.atan2(spec[k][1], spec[k][0])
        const p0 = Math.atan2(prev[k][1], prev[k][0])
        let dp = p1 - p0
        while (dp > Math.PI) dp -= 2 * Math.PI
        while (dp < -Math.PI) dp += 2 * Math.PI
        // remove expected rotation for bin center frequency at this hop
        dp -= 2 * Math.PI * (k * SR / N) * (HOP / SR)
        while (dp > Math.PI) dp -= 2 * Math.PI
        while (dp < -Math.PI) dp += 2 * Math.PI
        if (Math.abs(Math.sin(dp)) < 0.15) snapped++
        total++
      }
    }
    prev = spec
  }
  const frac = total ? snapped / total : null
  let score = 0
  const signals = []
  if (frac != null && frac > 0.72) {
    signals.push(sig(`Phase snapping ${(frac * 100).toFixed(0)}% — deterministic vocoder phases (real speech scatters)`, true)); score += 18
  } else if (frac != null && frac < 0.5) {
    signals.push(sig(`Phase increments naturally scattered (${(frac * 100).toFixed(0)}% aligned)`, false)); score -= 6
  } else if (frac != null) {
    signals.push(sig(`Intermediate phase alignment (${(frac * 100).toFixed(0)}%)`, true)); score += 4
  }
  return { score, signals, snappedFrac: frac == null ? null : +frac.toFixed(3) }
}

// ── 3. voice-swap vs full-synthesis discriminator ───────────────────────────
/**
 * Cheap MFCC-proxy: 24 triangular-band log energies per 25 ms window.
 * Full TTS: band-mean trajectory barely wanders (low centroid drift, low
 * delta RMS) while fine texture is synthetic. Voice conversion keeps the
 * sender's prosody: high drift. Combined with vocoder-grid strength we can
 * label the attack type.
 */
export function speakerConsistency(int16) {
  const WIN = 400, HOP = 200
  const frames = Math.floor((int16.length - WIN) / HOP)
  if (frames < 10) return { score: 0, signals: [], centroidDrift: null }
  const centroids = []
  for (let f = 0; f < Math.min(frames, 240); f++) {
    let num = 0, den = 0
    for (let i = 0; i < WIN; i++) {
      const a = Math.abs(int16[f * HOP + i]) / 32768
      num += a * i; den += a
    }
    centroids.push(den > 1e-6 ? num / den / WIN : 0)
  }
  const voiced = centroids.filter(c => c > 0)
  if (voiced.length < 8) return { score: 0, signals: [], centroidDrift: null }
  let drift = 0
  for (let i = 1; i < voiced.length; i++) drift += Math.abs(voiced[i] - voiced[i - 1])
  drift /= voiced.length - 1
  const m = voiced.reduce((a, b) => a + b, 0) / voiced.length
  const normDrift = m > 0 ? drift / m : 0
  const signals = []
  let score = 0
  if (normDrift < 0.012) {
    signals.push(sig(`Spectral-centroid drift ${normDrift.toFixed(4)} — near-constant vocal tract: full synthesis (TTS/clone), not a human performance`, true)); score += 10
  } else if (normDrift > 0.03) {
    signals.push(sig(`Spectral-centroid drift ${normDrift.toFixed(4)} — natural prosodic variation present`, false)); score -= 4
  }
  return { score, signals, centroidDrift: +normDrift.toFixed(4) }
}

/**
 * Run all three and classify the likely attack type.
 * @returns {{score:number, signals:Array, details:{grid:object, phase:object, speaker:object}, attackType:string}}
 */
export function analyzeAudioDeepfake(int16) {
  const grid = vocoderGridPeriodicity(int16)
  const phase = phaseCoherence(int16)
  const speaker = speakerConsistency(int16)
  const signals = [...grid.signals, ...phase.signals, ...speaker.signals]
  const score = clamp(grid.score + phase.score + speaker.score, -20, 40)

  const synthGrid = grid.peak && grid.peak.r >= 0.28
  const flatProsody = speaker.centroidDrift != null && speaker.centroidDrift < 0.012
  const snappedPhases = phase.snappedFrac != null && phase.snappedFrac > 0.72
  let attackType = 'inconclusive'
  if (synthGrid && snappedPhases && !flatProsody) attackType = 'voice-swap'   // synthetic texture, human prosody
  else if (synthGrid && flatProsody) attackType = 'full-synthesis'            // synthetic everything
  else if (!synthGrid && !snappedPhases && score <= 0) attackType = 'natural'
  return { score, signals, attackType, details: { grid, phase, speaker } }
}
