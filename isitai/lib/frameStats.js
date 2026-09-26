// ─── Per-frame pixel statistics (shared by GIF + video keyframe analysis) ────
// Lightweight version of the server pixel forensics that runs on raw RGBA
// arrays without sharp/FFT — fast enough to run over 16 frames in one request.

/** @returns {{score:number, noise:number, textureVar:number, meanLum:number}} */
export function analyzeFramePixels(rgba, w, h, ch = 4) {
  const gray = new Float32Array(w * h)
  let lumSum = 0
  for (let i = 0; i < w * h; i++) {
    const v = (0.299 * rgba[i * ch] + 0.587 * rgba[i * ch + 1] + 0.114 * rgba[i * ch + 2]) / 255
    gray[i] = v
    lumSum += v
  }
  const meanLum = lumSum / (w * h)

  // Noise: median-filter residual RMS (3×3 via insertion into small window)
  let nSum = 0, nCnt = 0
  const win = new Float32Array(9)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let k = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) win[k++] = gray[(y + dy) * w + (x + dx)]
    insertionSort(win)
    const med = win[4]
    const d = gray[y * w + x] - med
    nSum += d * d; nCnt++
  }
  const noise = nCnt ? Math.sqrt(nSum / nCnt) : 0

  // Texture variance across 16×16 blocks
  const bs = Math.max(8, Math.min(16, Math.floor(Math.min(w, h) / 6)))
  const nbx = Math.floor(w / bs), nby = Math.floor(h / bs)
  let tv = 0, tc = 0
  for (let by = 0; by < nby; by++) for (let bx = 0; bx < nbx; bx++) {
    let s = 0, sq = 0, c = 0
    for (let y = by * bs; y < (by + 1) * bs && y < h; y++) for (let x = bx * bs; x < (bx + 1) * bs && x < w; x++) {
      const v = gray[y * w + x]; s += v; sq += v * v; c++
    }
    if (c > 4) { const m = s / c; tv += sq / c - m * m; tc++ }
  }
  const textureVar = tc ? tv / tc : 0

  // Block-boundary flatness (JPEG-grid tell)
  let edge = 0, ec = 0, inner = 0, ic = 0
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) {
    const d = Math.abs(gray[y * w + x] - gray[y * w + x - 1])
    if (x % 8 === 0) { edge += d; ec++ } else { inner += d; ic++ }
  }
  const bb = (inner / Math.max(ic, 1)) > 0 ? (edge / Math.max(ec, 1)) / (inner / Math.max(ic, 1)) : 1

  // Simple heuristic score (0..100), mirrors the spirit of server pixel layer
  let score = 50
  if (noise < 0.006) score += 18
  else if (noise > 0.012 && noise < 0.05) score -= 12
  if (textureVar < 0.004) score += 14
  else if (textureVar > 0.02) score -= 6
  if (bb < 0.55) score += 10
  else if (bb > 1.4) score -= 6
  score = Math.max(0, Math.min(100, score))

  return { score, noise, textureVar, meanLum, blockBoundary: bb }
}

function insertionSort(a) {
  for (let i = 1; i < a.length; i++) {
    const v = a[i]
    let j = i - 1
    while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j-- }
    a[j + 1] = v
  }
}
