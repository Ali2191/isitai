// ─── Local-only (in-browser) detection ──────────────────────────────────────
// Used when the user enables "Local mode" — nothing leaves the device.
// Runs a subset of the server heuristics client-side: EXIF/C2PA/SynthID via
// exifr, 2D-FFT frequency analysis, texture variance, dimension heuristics.

export function localAnalyzeDimensions(width, height) {
  const signals = []
  let score = 0
  const aiSizes = [
    [512, 512], [768, 768], [1024, 1024], [1024, 1792], [1792, 1024],
    [1344, 768], [768, 1344], [1216, 832], [832, 1216], [1008, 1776], [1776, 1008],
  ]
  const match = aiSizes.find(([w, h]) => w === width && h === height)
  if (match) { signals.push({ label: `${width}×${height} matches a common generator size`, suspicious: true }); score += 30 }
  else if (width % 64 === 0 && height % 64 === 0 && width >= 512) { signals.push({ label: 'Both dimensions divisible by 64', suspicious: true }); score += 12 }
  if (width * height > 6000 * 4000) { signals.push({ label: 'Very high resolution — typical camera sensor', suspicious: false }); score -= 10 }
  return { score: Math.max(0, Math.min(100, 50 + score)), signals }
}

export async function localAnalyzeMetadata(file) {
  try {
    const data = await file.arrayBuffer()
    const bytes = new Uint8Array(data)
    // Container-level provenance markers (work without any parser)
    let latin = ''
    const chunk = 65536
    for (let i = 0; i < Math.min(bytes.length, 2_000_000); i += chunk) {
      latin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    const text = latin.toLowerCase()
    const signals = []
    let rawScore = 0
    if (text.includes('c2pa')) { signals.push({ label: 'C2PA content credentials present', suspicious: false }); rawScore = 0 }
    if (text.includes('synthid') || text.includes('invisiblewatermark')) { signals.push({ label: 'SynthID / AI watermark marker found', suspicious: true }); rawScore = 95 }
    if (text.includes('gligen')) { signals.push({ label: 'GLIGEN watermark found', suspicious: true }); rawScore = Math.max(rawScore, 90) }

    const exif = await exifrParse(file)
    if (!exif || Object.keys(exif).length === 0) {
      if (rawScore < 50) { signals.push({ label: 'No EXIF data', suspicious: true }); rawScore = Math.max(rawScore, 62) }
      return { score: Math.min(97, rawScore), signals, confidence: 'medium' }
    }
    const sw = (exif.Software || exif.software || exif.CreatorTool || '').toLowerCase()
    const aiTools = ['stable diffusion', 'midjourney', 'dall-e', 'firefly', 'gemini', 'openai', 'runway', 'imagen', 'comfyui', 'automatic1111', 'leonardo', 'invokeai']
    const foundAI = aiTools.find(t => sw.includes(t))
    if (foundAI) { signals.push({ label: `AI tool signature: ${exif.Software || foundAI}`, suspicious: true }); return { score: 96, signals, confidence: 'high' } }
    if (exif.Make || exif.Model) { signals.push({ label: `Camera: ${[exif.Make, exif.Model].filter(Boolean).join(' ')}`, suspicious: false }); rawScore = Math.max(0, rawScore - 25) }
    else { signals.push({ label: 'No camera data', suspicious: true }); rawScore += 15 }
    if (exif.DateTimeOriginal) { signals.push({ label: `Shot ${new Date(exif.DateTimeOriginal).toLocaleDateString()}`, suspicious: false }); rawScore = Math.max(0, rawScore - 5) }
    return { score: Math.max(2, Math.min(97, rawScore)), signals, confidence: 'medium' }
  } catch {
    return { score: 45, signals: [{ label: 'Metadata parse failed', suspicious: true }], confidence: 'low' }
  }
}

async function exifrParse(file) {
  const exifr = await import('exifr')
  return exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true })
}

// 2D magnitude spectrum via row+column DFT on a downsampled grayscale grid
export async function localPixelAnalysis(file) {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const S = 128
        const c = document.createElement('canvas'); c.width = S; c.height = S
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, S, S)
        const d = ctx.getImageData(0, 0, S, S).data
        URL.revokeObjectURL(url)
        const gray = new Float64Array(S * S)
        for (let i = 0; i < S * S; i++) gray[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255

        const mag = sig => {
          const N = sig.length, out = new Float64Array(N / 2)
          for (let k = 0; k < N / 2; k++) {
            let re = 0, im = 0
            for (let n = 0; n < N; n++) { const a = (2 * Math.PI * k * n) / N; re += sig[n] * Math.cos(a); im -= sig[n] * Math.sin(a) }
            out[k] = Math.hypot(re, im)
          }
          return out
        }
        // radial-ish average: mean magnitude per frequency bin over rows & cols
        const bins = new Float64Array(S / 2); const counts = new Float64Array(S / 2)
        for (let y = 0; y < S; y++) { const m = mag(gray.subarray(y * S, (y + 1) * S)); for (let k = 0; k < S / 2; k++) { bins[k] += m[k]; counts[k]++ } }
        for (let x = 0; x < S; x++) {
          const col = new Float64Array(S); for (let y = 0; y < S; y++) col[y] = gray[y * S + x]
          const m = mag(col); for (let k = 0; k < S / 2; k++) { bins[k] += m[k]; counts[k]++ }
        }
        for (let k = 0; k < bins.length; k++) bins[k] /= counts[k] || 1

        const q1 = Math.floor(S / 8)
        let lf = 0, hf = 0
        for (let k = 1; k < q1; k++) lf += bins[k]
        for (let k = q1; k < S / 2; k++) hf += bins[k]
        const ratio = lf > 0 ? hf / lf : 0

        // block texture variance
        const bs = 16, nb = S / bs
        let tv = 0
        for (let by = 0; by < nb; by++) for (let bx = 0; bx < nb; bx++) {
          let s = 0, sq = 0, cnt = 0
          for (let y = by * bs; y < (by + 1) * bs; y++) for (let x = bx * bs; x < (bx + 1) * bs; x++) { const v = gray[y * S + x]; s += v; sq += v * v; cnt++ }
          const m = s / cnt; tv += sq / cnt - m * m
        }
        const av = tv / (nb * nb)

        const signals = []; let score = 50
        if (ratio > 0.5) { signals.push({ label: 'GAN-like high-frequency energy', suspicious: true }); score += 22 }
        else if (ratio > 0.3) { signals.push({ label: 'Elevated high-frequency energy', suspicious: true }); score += 10 }
        else { signals.push({ label: 'Natural frequency distribution', suspicious: false }); score -= 8 }
        if (av < 0.004) { signals.push({ label: 'Unnaturally smooth texture', suspicious: true }); score += 18 }
        else if (av > 0.02) { signals.push({ label: 'Natural sensor-noise-like texture', suspicious: false }); score -= 6 }
        resolve({ score: Math.max(2, Math.min(98, score)), signals, confidence: 'low' })
      } catch { URL.revokeObjectURL(url); resolve({ score: 50, signals: [], confidence: 'none' }) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ score: 50, signals: [], confidence: 'none' }) }
    img.src = url
  })
}

export async function runLocalAnalysis(file) {
  const dims = await new Promise(resolve => {
    const img = new Image(); const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); resolve(localAnalyzeDimensions(img.naturalWidth, img.naturalHeight)) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ score: 50, signals: [] }) }
    img.src = url
  })
  const [meta, pix] = await Promise.all([localAnalyzeMetadata(file), localPixelAnalysis(file)])
  // Weighted fusion — metadata dominates, pixels are weak evidence locally
  const score = Math.round(Math.max(1, Math.min(99, meta.score * 0.5 + pix.score * 0.3 + dims.score * 0.2)))
  const bandHalf = 20 // local-only is inherently less certain
  const band = { lo: Math.max(0, score - bandHalf), hi: Math.min(100, score + bandHalf), label: `${Math.max(0, score - bandHalf)}–${Math.min(100, score + bandHalf)}%` }
  const verdict = score >= 82
    ? { level: 'likely-ai', emoji: '⚠️', color: '#f97316', line1: 'This image appears to be AI-generated', line2: `Local heuristics lean ${score}% toward AI.`, sub: 'Run with models disabled in settings for full server accuracy.' }
    : score >= 62
      ? { level: 'likely-ai', emoji: '⚠️', color: '#f97316', line1: 'This image shows AI indicators', line2: `${score}% of local heuristic weight points toward AI.`, sub: 'Confidence is limited without model inference.' }
      : score >= 38
        ? { level: 'uncertain', emoji: '🤔', color: '#eab308', line1: "We're uncertain about this image", line2: `Mixed local signals — ${score}% lean toward AI.`, sub: 'Enable server analysis for a much stronger verdict.' }
        : { level: 'likely-real', emoji: '✅', color: '#22c55e', line1: 'This image appears to be real', line2: `Local heuristics found mostly genuine-camera evidence (${100 - score}%).`, sub: 'Confidence is limited without model inference.' }
  return {
    id: `local-${Date.now().toString(36)}`,
    score, band, verdict,
    confidence: 'low',
    degraded: true,
    degradedReason: 'Local-only mode: no ML models were used. Everything ran in your browser.',
    combined: null,
    imageDimensions: {},
    layers: {
      models: { available: false, degraded: true, reason: 'Skipped (local mode)', combined: null, results: [], failed: [], disagreement: false },
      metadata: { ...meta, signals: meta.signals.map(s => ({ ...s, why: undefined })) },
      dimensions: { ...dims },
      structure: { score: 0, signals: [] },
      pixels: { ...pix },
    },
    cached: false,
    local: true,
    analyzedAt: Date.now(),
    privacy: 'Processed entirely in your browser. The image never left this device.',
  }
}
