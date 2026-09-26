// ─── Face & hand anatomy checks (classical CV, dependency-free) ─────────────
// face-api.js is in package.json but its models are heavy and browser-oriented;
// for the server pipeline we use robust classical computer-vision heuristics
// that target the classic generative tells:
//   • warped / asymmetric eyes (differing darkness area or vertical offset)
//   • impossible teeth/mouth bands (uniform bright band without structure)
//   • hand-like regions with implausible finger counts (periodic stripe test)
// Every check returns normalized boxes so the UI can zoom + overlay a heatmap.

/** Skin-tone mask on RGBA data (YCbCr rule, widely used and fast). */
export function skinMask(data, w, h, ch) {
  const mask = new Uint8Array(w * h)
  let count = 0
  for (let i = 0; i < w * h; i++) {
    const r = data[i * ch], g = data[i * ch + 1], b = data[i * ch + 2]
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    if (y > 60 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) { mask[i] = 1; count++ }
  }
  return { mask, count, frac: count / (w * h) }
}

/** Connected components (4-neighbour BFS) → largest blob bbox + fill ratio. */
export function largestBlob(mask, w, h, minArea = 24) {
  const seen = new Uint8Array(w * h)
  let best = null
  const stack = new Int32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue
    let sp = 0
    stack[sp++] = i
    seen[i] = 1
    let minX = w, maxX = 0, minY = h, maxY = 0, area = 0
    while (sp > 0) {
      const p = stack[--sp]
      const x = p % w, y = (p - x) / w
      area++
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1 }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1 }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w }
    }
    if (area >= minArea && (!best || area > best.area)) {
      const bw = maxX - minX + 1, bh = maxY - minY + 1
      best = { x: minX, y: minY, w: bw, h: bh, area, fill: area / (bw * bh) }
    }
  }
  return best
}

/**
 * Detect a plausible face region: largest skin blob with portrait-ish aspect.
 * Returns { box:{x,y,w,h (normalized)}, score } or null.
 */
export function detectFaceRegion(mask, w, h) {
  const blob = largestBlob(mask, w, h, Math.max(60, w * h * 0.002))
  if (!blob) return null
  const ar = blob.h / blob.w
  if (ar < 0.9 || ar > 2.4) return null           // faces are taller than wide
  if (blob.fill < 0.45) return null               // faces are solid blobs
  if (blob.w < w * 0.08 || blob.h < h * 0.1) return null
  return {
    box: { x: blob.x / w, y: blob.y / h, w: blob.w / w, h: blob.h / h },
    px: blob,
    score: Math.min(1, ar / 1.35) * blob.fill,
  }
}

/** Horizontal luminance profile inside a box (for eye-band analysis). */
function colProfile(gray, S, x0, y0, x1, y1) {
  const out = []
  for (let x = x0; x < x1; x++) {
    let s = 0, c = 0
    for (let y = y0; y < y1; y++) { s += gray[y * S + x]; c++ }
    out.push(c ? s / c : 0)
  }
  return out
}

/** Row-wise mean profile inside a box. */
function rowProfile(gray, S, x0, y0, x1, y1) {
  const out = []
  for (let y = y0; y < y1; y++) {
    let s = 0, c = 0
    for (let x = x0; x < x1; x++) { s += gray[y * S + x]; c++ }
    out.push(c ? s / c : 0)
  }
  return out
}

/** Find dark "eye" minima in the upper-middle band of a face box. */
function findEyes(gray, S, f) {
  const { x, y } = f.px
  const ex0 = x, ex1 = x + f.px.w
  const ey0 = y + Math.floor(f.px.h * 0.28), ey1 = y + Math.floor(f.px.h * 0.52)
  if (ey1 - ey0 < 3 || ex1 - ex0 < 8) return null
  const prof = colProfile(gray, S, ex0, ey0, ex1, ey1)
  const m = mean(prof)
  // two darkest contiguous dips left/right of center
  const half = Math.floor(prof.length / 2)
  const dip = arr => {
    let bi = -1, bv = Infinity
    for (let i = 2; i < arr.length - 2; i++) {
      const v = arr[i - 2] + arr[i - 1] + arr[i] + arr[i + 1] + arr[i + 2]
      if (v < bv) { bv = v; bi = i }
    }
    return { idx: bi, depth: m - bv / 5 }
  }
  const L = dip(prof.slice(0, half)), R = dip(prof.slice(half))
  if (L.idx < 0 || R.idx < 0) return null
  // vertical offset: darkest row within ±3 rows of each eye column
  const darkRow = cx => {
    let bi = -1, bv = Infinity
    for (let yy = ey0; yy < ey1; yy++) {
      const v = gray[yy * S + cx]
      if (v < bv) { bv = v; bi = yy }
    }
    return bi
  }
  const lcx = ex0 + L.idx, rcx = ex0 + half + R.idx
  return {
    left: { x: lcx, y: darkRow(lcx), depth: L.depth },
    right: { x: rcx, y: darkRow(rcx), depth: R.depth },
    span: rcx - lcx,
    bandTop: ey0, bandBottom: ey1,
  }
}

/** Mouth/teeth band analysis: bright uniform band with no internal texture. */
function mouthBandAnomaly(gray, S, f) {
  const { x, y } = f.px
  const my0 = y + Math.floor(f.px.h * 0.62), my1 = y + Math.floor(f.px.h * 0.85)
  const mx0 = x + Math.floor(f.px.w * 0.28), mx1 = x + Math.floor(f.px.w * 0.72)
  if (my1 - my0 < 3 || mx1 - mx0 < 6) return null
  const rows = rowProfile(gray, S, mx0, my0, mx1, my1)
  const brightRow = rows.indexOf(Math.max(...rows))
  const bright = rows[brightRow]
  const surrounding = mean(rows.filter((_, i) => Math.abs(i - brightRow) > 1))
  const contrast = bright - surrounding
  if (contrast < 0.06) return null // no visible teeth band
  // internal horizontal variance of the bright row — real teeth have structure
  const ry = my0 + brightRow
  const line = colProfile(gray, S, mx0, ry, mx1, ry + 1)
  const lv = variance(line)
  // very smooth bright band spanning most of mouth width = painted-on teeth
  const smoothness = 1 - Math.min(1, lv / 0.002)
  const widthFrac = (mx1 - mx0) / f.px.w
  return { smoothness: +(smoothness * widthFrac).toFixed(3), contrast: +contrast.toFixed(3) }
}

/** Periodicity detector used for finger-count plausibility in hand regions. */
function fingerPeriodicity(gray, S, region) {
  const { x0, y0, x1, y1 } = region
  if (y1 - y0 < 8 || x1 - x0 < 8) return null
  // take the middle third rows (where fingers separate) and count runs of
  // alternating light/dark along x
  const ry0 = y0 + Math.floor((y1 - y0) * 0.35), ry1 = y0 + Math.floor((y1 - y0) * 0.65)
  const prof = colProfile(gray, S, x0, ry0, x1, ry1)
  const m = mean(prof)
  let runs = 0, prev = null
  for (const v of prof) {
    const side = v > m + 0.03 ? 1 : v < m - 0.03 ? -1 : 0
    if (side !== 0 && side !== prev) { runs++; prev = side }
  }
  return runs / 2 // approx number of bright stripes (fingers)
}

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0 }
function variance(a) { const m = mean(a); return mean(a.map(v => (v - m) ** 2)) }

/**
 * Main entry. Runs all anatomy heuristics on a decoded square frame.
 * @returns {{ signals: Array, boxes: Array, suspicious: boolean }}
 * boxes are normalized {x,y,w,h,label,severity} for the heatmap overlay.
 */
export function analyzeAnatomy(gray, S, data, w, h, ch) {
  const signals = []
  const boxes = []
  let suspicious = false

  const { mask, frac } = skinMask(data, w, h, ch)
  if (frac < 0.015) {
    signals.push({ label: 'No skin-toned regions — anatomy checks skipped', suspicious: false })
    return { signals, boxes, suspicious }
  }
  const face = detectFaceRegion(mask, w, h)
  if (!face) {
    signals.push({ label: 'No face-like region found', suspicious: false })
    return { signals, boxes, suspicious }
  }
  signals.push({ label: `Face region located (${Math.round(face.box.w * 100)}% of frame width)`, suspicious: false })

  const eyes = findEyes(gray, S, face)
  if (eyes && eyes.span > 4) {
    // Asymmetry metrics
    const depthDiff = Math.abs(eyes.left.depth - eyes.right.depth) / (Math.max(eyes.left.depth, eyes.right.depth) || 1e-9)
    const yOff = Math.abs(eyes.left.y - eyes.right.y) / face.box.h
    if (depthDiff > 0.62) {
      suspicious = true
      signals.push({ label: `Warped eyes — one eye ${Math.round(depthDiff * 100)}% darker/flatter than the other`, suspicious: true })
      const worst = eyes.left.depth < eyes.right.depth ? eyes.left : eyes.right
      boxes.push({ x: (worst.x - 4) / S, y: (worst.y - 4) / S, w: 8 / S, h: 8 / S, label: 'warped eye', severity: Math.min(1, depthDiff) })
    } else if (depthDiff < 0.22) {
      signals.push({ label: 'Eye darkness near-identical — uncanny GAN symmetry', suspicious: true })
      suspicious = true
      boxes.push({ x: face.box.x + face.box.w * 0.18, y: face.box.y + face.box.h * 0.28, w: face.box.w * 0.64, h: face.box.h * 0.2, label: 'symmetric eyes', severity: 0.5 })
    } else {
      signals.push({ label: 'Eye asymmetry within natural human range', suspicious: false })
    }
    if (yOff > 0.055) {
      suspicious = true
      signals.push({ label: `Eyes vertically misaligned (${Math.round(yOff * 100)}% of face height)`, suspicious: true })
      boxes.push({ x: face.box.x + face.box.w * 0.15, y: face.box.y + face.box.h * 0.26, w: face.box.w * 0.7, h: face.box.h * 0.24, label: 'misaligned eyes', severity: Math.min(1, yOff * 8) })
    }
  }

  const mouth = mouthBandAnomaly(gray, S, face)
  if (mouth && mouth.smoothness > 0.72) {
    suspicious = true
    signals.push({ label: 'Teeth band is a single smooth highlight — painted-on smile artifact', suspicious: true })
    boxes.push({ x: face.box.x + face.box.w * 0.28, y: face.box.y + face.box.h * 0.62, w: face.box.w * 0.44, h: face.box.h * 0.2, label: 'impossible teeth', severity: Math.min(1, mouth.smoothness) })
  } else if (mouth) {
    signals.push({ label: 'Mouth band shows natural internal structure', suspicious: false })
  }

  // Hand check: only meaningful when there is substantial skin outside the
  // face blob (hands held up, POV shots…). Counts bright finger stripes in
  // the lower-central region; >5.5 stripes suggests an extra-digit artifact.
  try {
    const cand = { x0: Math.floor(S * 0.1), y0: Math.floor(S * 0.5), x1: Math.floor(S * 0.9), y1: S }
    const skinOutsideFace = countSkinOutside(mask, w, h, face.px)
    if (skinOutsideFace > w * h * 0.02) {
      const fp = fingerPeriodicity(gray, S, cand)
      if (fp != null && fp >= 5.6) {
        suspicious = true
        signals.push({ label: `Hand region shows ~${Math.round(fp)} parallel finger stripes — extra-digit artifact`, suspicious: true })
        boxes.push({ x: cand.x0 / S, y: (cand.y0 + (cand.y1 - cand.y0) * 0.35) / S, w: (cand.x1 - cand.x0) / S, h: 0.2, label: 'finger anomaly', severity: Math.min(1, (fp - 5) / 3) })
      } else if (fp != null && fp >= 3 && fp <= 5.5) {
        signals.push({ label: `Finger-stripe count plausible (~${Math.round(fp)})`, suspicious: false })
      }
    }
  } catch { /* hand heuristics are opportunistic */ }

  return { signals, boxes, suspicious }
}

function countSkinOutside(mask, w, h, faceRect) {
  let n = 0
  const pad = 4
  const fx0 = faceRect.x - pad, fx1 = faceRect.x + faceRect.w + pad
  const fy0 = faceRect.y - pad, fy1 = faceRect.y + faceRect.h + pad
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue
    const x = i % w, y = (i - x) / w
    if (x < fx0 || x > fx1 || y < fy0 || y > fy1) n++
  }
  return n
}
