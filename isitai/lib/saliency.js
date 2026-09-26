// ─── Region-level saliency / localization map ────────────────────────────────
// Instead of one global score, produce an 8×8 grid of per-region "suspicion"
// values (0–1) so the UI can overlay a heatmap and answer: WHICH part of this
// image looks synthetic? (inpainted background, swapped face, spliced object)
//
// Evidence fused per region:
//   • PRNU residual deviation from the image-wide noise level (from prnu.js)
//   • local texture variance vs. global distribution
//   • local edge density anomaly (seams around composited regions)
//   • JPEG block-boundary energy discontinuity (grid from prnu.js)

const G = 8 // saliency grid resolution

/**
 * @param {Float32Array} gray  luminance [0,1], S×S
 * @param {{ data: Buffer-like RGBA, w:number, h:number, ch:number }} px decoded pixels
 * @param {object} noiseMaps   maps from analyzeNoiseAndCompression()
 */
export function buildSaliencyMap(gray, S, noiseMaps) {
  const cell = Math.floor(S / G)
  if (cell < 4) return null

  // Per-cell stats: local variance + mean absolute gradient (edge density)
  const varGrid = new Float64Array(G * G)
  const gradGrid = new Float64Array(G * G)
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    let s = 0, sq = 0, c = 0, gsum = 0, gc = 0
    for (let y = gy * cell; y < Math.min((gy + 1) * cell, S); y++) {
      for (let x = gx * cell; x < Math.min((gx + 1) * cell, S); x++) {
        const v = gray[y * S + x]
        s += v; sq += v * v; c++
        if (x > 0 && y > 0) {
          gsum += Math.abs(v - gray[y * S + x - 1]) + Math.abs(v - gray[(y - 1) * S + x])
          gc++
        }
      }
    }
    const m = s / Math.max(c, 1)
    varGrid[gy * G + gx] = Math.max(sq / Math.max(c, 1) - m * m, 0)
    gradGrid[gy * G + gx] = gsum / Math.max(gc, 1)
  }

  // Global references (robust: median instead of mean where possible)
  const medVar = median(Array.from(varGrid)) || 1e-9
  const medGrad = median(Array.from(gradGrid)) || 1e-9

  // PRNU region grid upsampled from its own resolution (typically 4×4) to 8×8
  let prnuDev = new Float64Array(G * G)
  if (noiseMaps?.prnuGrid?.length) {
    const R = noiseMaps.prnuR
    const prnuMed = median(noiseMaps.prnuGrid) || 1e-9
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const ry = Math.min(R - 1, Math.floor(gy * R / G)), rx = Math.min(R - 1, Math.floor(gx * R / G))
      const v = noiseMaps.prnuGrid[ry * R + rx]
      // ratio < 1 → less noise than rest of image → suspicious (smoothed-in region)
      prnuDev[gy * G + gx] = clamp01(0.5 + 0.5 * (1 - v / prnuMed))
    }
  }

  // Block-energy discontinuity map (8×8-JPEG-block energies aggregated to G×G)
  let seamDev = new Float64Array(G * G)
  if (noiseMaps?.blockEnergy?.length && noiseMaps.blockB >= G) {
    const B = noiseMaps.blockB
    const be = noiseMaps.blockEnergy
    const bmed = median(be) || 1e-9
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      let acc = 0, cnt = 0
      const y0 = Math.floor(gy * B / G), y1 = Math.floor((gy + 1) * B / G)
      const x0 = Math.floor(gx * B / G), x1 = Math.floor((gx + 1) * B / G)
      for (let by = y0; by < y1; by++) for (let bx = x0; bx < x1; bx++) {
        const v = be[by * B + bx]
        acc += Math.abs(v - bmed) / bmed; cnt++
      }
      seamDev[gy * G + gx] = clamp01((cnt ? acc / cnt : 0) * 1.6)
    }
  }

  // Fuse: suspicion = weighted z-anomalies, clipped to [0,1]
  const cells = []
  let maxScore = 0
  for (let i = 0; i < G * G; i++) {
    // low variance relative to median → over-smoothed (generated/inpainted)
    const smoothness = clamp01(0.5 + 0.5 * (1 - varGrid[i] / (medVar * 1.6)))
    // extremely uniform edge density inside a cell is also generator-typical
    const gradAnom = clamp01(Math.abs(gradGrid[i] - medGrad) / (medGrad * 2))
    const v =
      0.40 * prnuDev[i] +
      0.30 * smoothness +
      0.18 * seamDev[i] +
      0.12 * gradAnom
    cells.push(+v.toFixed(3))
    if (v > maxScore) maxScore = v
  }

  const mean = cells.reduce((a, b) => a + b, 0) / cells.length
  // Top regions worth flagging in copy ("bottom-right corner looks synthetic")
  const flagged = []
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] >= Math.max(0.62, mean + 0.22)) {
      const gx = i % G, gy = Math.floor(i / G)
      flagged.push({ x: gx / G, y: gy / G, w: 1 / G, h: 1 / G, value: cells[i], where: regionName(gx, gy, G) })
    }
  }
  flagged.sort((a, b) => b.value - a.value)

  return {
    grid: G,
    cells,
    mean: +mean.toFixed(3),
    peak: +maxScore.toFixed(3),
    flagged: flagged.slice(0, 4),
  }
}

function regionName(gx, gy, G) {
  const col = gx < G / 3 ? 'left' : gx < (2 * G) / 3 ? 'center' : 'right'
  const row = gy < G / 3 ? 'top' : gy < (2 * G) / 3 ? 'middle' : 'bottom'
  return row === 'middle' && col === 'center' ? 'center' : `${row}-${col}`
}

function median(a) {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
function clamp01(v) { return Math.max(0, Math.min(1, v)) }

export const SALIENCY_GRID = G
