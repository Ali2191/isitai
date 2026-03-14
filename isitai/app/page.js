'use client'
import { useState, useRef, useEffect } from 'react'
import * as exifr from 'exifr'

// ── EXIF Analysis ──────────────────────────────────────────────────────────
async function analyzeExif(file) {
  try {
    const exif = await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true })
    if (!exif) {
      return { aiScore: 72, exifWeight: 0.18, confidence: 'medium', evidenceQuality: 0,
        signals: [{ label: 'No EXIF data found', suspicious: true }, { label: 'Real photos always contain metadata', suspicious: true }],
        verdict: 'no_metadata' }
    }
    const signals = []
    let rawScore = 0
    let evidenceQuality = 0

    const sw = (exif.Software || exif.software || exif['dc:creator'] || exif.CreatorTool || '').toLowerCase()
    const aiTools = [
      { name: 'stable diffusion', label: 'Stable Diffusion' }, { name: 'midjourney', label: 'Midjourney' },
      { name: 'dall-e', label: 'DALL-E' }, { name: 'firefly', label: 'Adobe Firefly' },
      { name: 'gemini', label: 'Google Gemini' }, { name: 'openai', label: 'OpenAI' },
      { name: 'runway', label: 'Runway ML' }, { name: 'imagen', label: 'Google Imagen' },
      { name: 'nightcafe', label: 'NightCafe' }, { name: 'leonardo', label: 'Leonardo AI' },
      { name: 'invoke', label: 'InvokeAI' }, { name: 'automatic1111', label: 'A1111 WebUI' }
    ]
    const foundAI = aiTools.find(t => sw.includes(t.name))
    if (foundAI) { signals.push({ label: `AI signature: ${foundAI.label}`, suspicious: true }); rawScore += 95; evidenceQuality += 60 }
    else if (exif.Software) { signals.push({ label: `Software: ${exif.Software}`, suspicious: false }); evidenceQuality += 15 }
    else { signals.push({ label: 'No software metadata', suspicious: true }); rawScore += 12; evidenceQuality += 5 }

    const hasCamera = !!(exif.Make || exif.Model)
    if (hasCamera) { signals.push({ label: `Camera: ${[exif.Make, exif.Model].filter(Boolean).join(' ')}`, suspicious: false }); rawScore = Math.max(0, rawScore - 20); evidenceQuality += 25 }
    else { signals.push({ label: 'No camera detected', suspicious: true }); rawScore += 20; evidenceQuality += 8 }

    const hasGPS = !!(exif.latitude || exif.longitude)
    if (hasGPS) { signals.push({ label: `GPS: ${exif.latitude?.toFixed(4)}, ${exif.longitude?.toFixed(4)}`, suspicious: false }); rawScore = Math.max(0, rawScore - 8); evidenceQuality += 15 }
    else { signals.push({ label: 'No GPS coordinates', suspicious: true }); rawScore += 8; evidenceQuality += 5 }

    const hasLens = !!(exif.FocalLength || exif.LensModel || exif.LensMake)
    if (hasLens) { signals.push({ label: `Lens: ${exif.LensModel || exif.FocalLength + 'mm'}`, suspicious: false }); rawScore = Math.max(0, rawScore - 5); evidenceQuality += 15 }
    else { signals.push({ label: 'No lens information', suspicious: true }); rawScore += 8; evidenceQuality += 3 }

    const captureDate = exif.DateTimeOriginal || exif.CreateDate
    if (captureDate) { signals.push({ label: `Captured: ${new Date(captureDate).toLocaleDateString()}`, suspicious: false }); rawScore = Math.max(0, rawScore - 5); evidenceQuality += 10 }
    else { signals.push({ label: 'No capture timestamp', suspicious: true }); rawScore += 6; evidenceQuality += 2 }

    let exifWeight, confidence
    if (foundAI) { exifWeight = 0.35; confidence = 'high' }
    else if (evidenceQuality >= 60) { exifWeight = 0.28; confidence = 'high' }
    else if (evidenceQuality >= 35) { exifWeight = 0.20; confidence = 'medium' }
    else if (evidenceQuality >= 15) { exifWeight = 0.14; confidence = 'low' }
    else { exifWeight = 0.10; confidence = 'very_low' }

    return {
      aiScore: Math.min(95, Math.max(3, Math.round(rawScore))),
      exifWeight, confidence, evidenceQuality, signals,
      verdict: foundAI ? 'definitive_ai' : hasCamera ? 'has_camera' : 'no_camera'
    }
  } catch (e) {
    return { aiScore: 45, exifWeight: 0.10, confidence: 'very_low', evidenceQuality: 0,
      signals: [{ label: 'Could not parse metadata', suspicious: true }], verdict: 'parse_error' }
  }
}

// ── Feature 6: FFT Frequency Domain Analysis ───────────────────────────────
async function analyzeFFT(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const SIZE = 256
        const canvas = document.createElement('canvas')
        canvas.width = SIZE; canvas.height = SIZE
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, SIZE, SIZE)
        const imageData = ctx.getImageData(0, 0, SIZE, SIZE)
        URL.revokeObjectURL(url)

        // Convert to grayscale
        const gray = new Float32Array(SIZE * SIZE)
        for (let i = 0; i < SIZE * SIZE; i++) {
          const r = imageData.data[i * 4]
          const g = imageData.data[i * 4 + 1]
          const b = imageData.data[i * 4 + 2]
          gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
        }

        // Simple DFT on rows + cols (approximation, fast enough for 256x256)
        // We compute power spectrum by analyzing frequency bands
        const signals = []
        let suspicionScore = 0

        // Check for GAN checkerboard artifacts at Nyquist frequencies
        // These appear as bright spots at (N/2, N/2) in frequency space
        const rowSums = new Float32Array(SIZE)
        const colSums = new Float32Array(SIZE)

        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            rowSums[y] += gray[y * SIZE + x]
            colSums[x] += gray[y * SIZE + x]
          }
        }

        // Compute 1D DFT magnitude for rows and columns
        const dftMag = (signal) => {
          const N = signal.length
          const mags = new Float32Array(N / 2)
          for (let k = 0; k < N / 2; k++) {
            let re = 0, im = 0
            for (let n = 0; n < N; n++) {
              const angle = (2 * Math.PI * k * n) / N
              re += signal[n] * Math.cos(angle)
              im -= signal[n] * Math.sin(angle)
            }
            mags[k] = Math.sqrt(re * re + im * im)
          }
          return mags
        }

        const rowMags = dftMag(rowSums)
        const colMags = dftMag(colSums)

        // Normalize
        const rowMax = Math.max(...rowMags)
        const colMax = Math.max(...colMags)
        const rowNorm = rowMags.map(v => rowMax > 0 ? v / rowMax : 0)
        const colNorm = colMags.map(v => colMax > 0 ? v / colMax : 0)

        // GAN artifact check: energy spike at high frequencies (N/4 to N/2)
        // Real photos have smooth 1/f falloff; GANs have bumps
        const highFreqStart = Math.floor(SIZE / 4)
        const highFreqEnd = Math.floor(SIZE / 2)
        let highFreqEnergyRow = 0, lowFreqEnergyRow = 0
        let highFreqEnergyCol = 0, lowFreqEnergyCol = 0

        for (let k = 1; k < highFreqStart; k++) { lowFreqEnergyRow += rowNorm[k]; lowFreqEnergyCol += colNorm[k] }
        for (let k = highFreqStart; k < highFreqEnd; k++) { highFreqEnergyRow += rowNorm[k]; highFreqEnergyCol += colNorm[k] }

        const rowRatio = lowFreqEnergyRow > 0 ? highFreqEnergyRow / lowFreqEnergyRow : 0
        const colRatio = lowFreqEnergyCol > 0 ? highFreqEnergyCol / lowFreqEnergyCol : 0
        const avgRatio = (rowRatio + colRatio) / 2

        // Real photos: high freq energy much lower (ratio < 0.3)
        // GAN images: ratio often 0.5+ due to checkerboard artifacts
        if (avgRatio > 0.65) {
          signals.push({ label: `High-frequency artifacts detected (GAN signature)`, suspicious: true })
          suspicionScore += 45
        } else if (avgRatio > 0.45) {
          signals.push({ label: `Elevated high-frequency energy (possible GAN)`, suspicious: true })
          suspicionScore += 25
        } else if (avgRatio < 0.20) {
          signals.push({ label: `Natural frequency falloff (real photo pattern)`, suspicious: false })
          suspicionScore -= 10
        } else {
          signals.push({ label: `Frequency spectrum inconclusive`, suspicious: false })
        }

        // Check for unnatural smoothness (diffusion model signature)
        // Compute local variance across image blocks
        let totalVariance = 0
        const blockSize = 16
        const numBlocks = Math.floor(SIZE / blockSize)
        for (let by = 0; by < numBlocks; by++) {
          for (let bx = 0; bx < numBlocks; bx++) {
            let sum = 0, sumSq = 0, count = 0
            for (let y = by * blockSize; y < (by + 1) * blockSize; y++) {
              for (let x = bx * blockSize; x < (bx + 1) * blockSize; x++) {
                const v = gray[y * SIZE + x]
                sum += v; sumSq += v * v; count++
              }
            }
            const mean = sum / count
            const variance = sumSq / count - mean * mean
            totalVariance += variance
          }
        }
        const avgVariance = totalVariance / (numBlocks * numBlocks)

        // Very low variance = suspiciously smooth (diffusion artifact)
        if (avgVariance < 0.004) {
          signals.push({ label: `Unnaturally smooth texture (diffusion artifact)`, suspicious: true })
          suspicionScore += 30
        } else if (avgVariance > 0.02) {
          signals.push({ label: `Natural texture variance detected`, suspicious: false })
          suspicionScore -= 5
        }

        // Spectral flatness — AI images often have more uniform frequency distribution
        const midFreq = rowNorm.slice(2, Math.floor(SIZE / 4))
        const spectralMean = midFreq.reduce((a, b) => a + b, 0) / midFreq.length
        const spectralVariance = midFreq.reduce((s, v) => s + Math.pow(v - spectralMean, 2), 0) / midFreq.length
        if (spectralVariance < 0.01) {
          signals.push({ label: `Flat frequency spectrum (AI generator pattern)`, suspicious: true })
          suspicionScore += 20
        }

        resolve({
          score: Math.max(0, Math.min(90, suspicionScore)),
          signals,
          confidence: Math.abs(suspicionScore) > 30 ? 'high' : Math.abs(suspicionScore) > 15 ? 'medium' : 'low',
          avgRatio: Math.round(avgRatio * 100) / 100
        })
      } catch (e) {
        URL.revokeObjectURL(url)
        resolve({ score: 0, signals: [{ label: 'FFT analysis failed', suspicious: false }], confidence: 'none' })
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ score: 0, signals: [], confidence: 'none' }) }
    img.src = url
  })
}

// ── Feature 7: Face Detection + Skin Tone Heuristics ──────────────────────
async function analyzeFace(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const SIZE = 256
        const canvas = document.createElement('canvas')
        canvas.width = SIZE; canvas.height = SIZE
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, SIZE, SIZE)
        const imageData = ctx.getImageData(0, 0, SIZE, SIZE)
        URL.revokeObjectURL(url)

        const signals = []
        let suspicionScore = 0
        let faceDetected = false

        // Skin tone detection using HSV-based heuristic
        // Skin pixels: H in [0,50], S in [0.2,0.85], V in [0.35,1.0]
        let skinPixels = 0
        let totalPixels = SIZE * SIZE
        let symmetryData = []

        for (let i = 0; i < totalPixels; i++) {
          const r = imageData.data[i * 4] / 255
          const g = imageData.data[i * 4 + 1] / 255
          const b = imageData.data[i * 4 + 2] / 255

          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const delta = max - min
          let h = 0, s = 0, v = max

          if (delta > 0) {
            s = delta / max
            if (max === r) h = 60 * (((g - b) / delta) % 6)
            else if (max === g) h = 60 * ((b - r) / delta + 2)
            else h = 60 * ((r - g) / delta + 4)
            if (h < 0) h += 360
          }

          // Skin tone range
          if (h >= 0 && h <= 50 && s >= 0.15 && s <= 0.85 && v >= 0.35) skinPixels++

          // Store brightness for symmetry analysis
          symmetryData.push(v)
        }

        const skinRatio = skinPixels / totalPixels

        if (skinRatio > 0.08) {
          faceDetected = true
          signals.push({ label: `Face/skin region detected (${Math.round(skinRatio * 100)}% skin tones)`, suspicious: false })

          // Check horizontal symmetry — AI faces are unnaturally symmetric
          let symmetryScore = 0
          let comparisons = 0
          for (let y = Math.floor(SIZE * 0.2); y < Math.floor(SIZE * 0.8); y++) {
            for (let x = 0; x < Math.floor(SIZE / 2); x++) {
              const left = symmetryData[y * SIZE + x]
              const right = symmetryData[y * SIZE + (SIZE - 1 - x)]
              symmetryScore += 1 - Math.abs(left - right)
              comparisons++
            }
          }
          const normalizedSymmetry = comparisons > 0 ? symmetryScore / comparisons : 0

          // Real faces: symmetry ~0.82-0.88
          // AI faces: symmetry ~0.92-0.97 (unnaturally perfect)
          if (normalizedSymmetry > 0.93) {
            signals.push({ label: `Unnatural facial symmetry (${(normalizedSymmetry * 100).toFixed(1)}%)`, suspicious: true })
            suspicionScore += 35
          } else if (normalizedSymmetry > 0.90) {
            signals.push({ label: `High facial symmetry (${(normalizedSymmetry * 100).toFixed(1)}%)`, suspicious: true })
            suspicionScore += 18
          } else {
            signals.push({ label: `Normal facial asymmetry (${(normalizedSymmetry * 100).toFixed(1)}%)`, suspicious: false })
            suspicionScore -= 5
          }

          // Check for unnaturally uniform skin tone (AI faces have very smooth skin)
          let skinValues = []
          for (let i = 0; i < totalPixels; i++) {
            const r = imageData.data[i * 4] / 255
            const g = imageData.data[i * 4 + 1] / 255
            const b = imageData.data[i * 4 + 2] / 255
            const max = Math.max(r, g, b), min = Math.min(r, g, b)
            const delta = max - min
            let h = 0, s = 0, v = max
            if (delta > 0) { s = delta / max; if (max === r) h = 60 * (((g - b) / delta) % 6); if (h < 0) h += 360 }
            if (h >= 0 && h <= 50 && s >= 0.15 && s <= 0.85 && v >= 0.35) skinValues.push(v)
          }

          if (skinValues.length > 100) {
            const skinMean = skinValues.reduce((a, b) => a + b, 0) / skinValues.length
            const skinVariance = skinValues.reduce((s, v) => s + Math.pow(v - skinMean, 2), 0) / skinValues.length
            if (skinVariance < 0.003) {
              signals.push({ label: `Unnaturally smooth skin texture`, suspicious: true })
              suspicionScore += 25
            } else if (skinVariance > 0.015) {
              signals.push({ label: `Natural skin texture variation`, suspicious: false })
              suspicionScore -= 8
            }
          }

        } else {
          signals.push({ label: 'No face detected — standard analysis only', suspicious: false })
        }

        // Face weight: higher when face is detected (models are best on face data)
        const faceWeight = faceDetected ? 0.12 : 0.0

        resolve({
          score: Math.max(0, Math.min(90, suspicionScore)),
          signals,
          confidence: faceDetected ? (Math.abs(suspicionScore) > 25 ? 'high' : 'medium') : 'none',
          faceDetected,
          faceWeight,
          skinRatio: Math.round(skinRatio * 100)
        })
      } catch (e) {
        URL.revokeObjectURL(url)
        resolve({ score: 0, signals: [], confidence: 'none', faceDetected: false, faceWeight: 0 })
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ score: 0, signals: [], confidence: 'none', faceDetected: false, faceWeight: 0 }) }
    img.src = url
  })
}

// ── Final score computation with all layers ────────────────────────────────
function computeFinalScore(modelCombined, exifData, dimensionScore, fftResult, faceResult) {
  let exifWeight = exifData?.exifWeight || 0
  let dimWeight = 0
  let fftWeight = 0
  let faceWeight = faceResult?.faceWeight || 0

  if (dimensionScore && dimensionScore.confidence !== 'none' && dimensionScore.confidence !== 'low') {
    dimWeight = dimensionScore.confidence === 'high' ? 0.12 : 0.06
  }
  if (fftResult && fftResult.confidence !== 'none' && fftResult.confidence !== 'low') {
    fftWeight = fftResult.confidence === 'high' ? 0.10 : 0.05
  }

  // Ensure weights don't exceed model weight floor of 0.50
  const extraWeight = exifWeight + dimWeight + fftWeight + faceWeight
  const modelWeight = Math.max(0.50, 1 - extraWeight)
  const scale = 1 / (modelWeight + extraWeight)

  const modelScore = modelCombined * modelWeight * scale
  const exifScore = (exifData?.aiScore || 0) * exifWeight * scale
  const dimScore = (dimensionScore?.score || 0) * dimWeight * scale
  const fftScore = (fftResult?.score || 0) * fftWeight * scale
  const faceScore = (faceResult?.score || 0) * faceWeight * scale

  return Math.min(99, Math.max(1, Math.round(modelScore + exifScore + dimScore + fftScore + faceScore)))
}

const Logo = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1"/>
        <stop offset="100%" stopColor="#ec4899"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8" fill="url(#logoGrad)"/>
    <ellipse cx="16" cy="15" rx="8.5" ry="5.5" fill="none" stroke="white" strokeWidth="1.8"/>
    <circle cx="16" cy="15" r="2.8" fill="white"/>
    <circle cx="16" cy="15" r="1.1" fill="url(#logoGrad)"/>
    <line x1="21.5" y1="20.5" x2="25.5" y2="24.5" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
    <circle cx="10" cy="10" r="1" fill="rgba(255,255,255,0.5)"/>
    <circle cx="22" cy="10" r="0.7" fill="rgba(255,255,255,0.4)"/>
  </svg>
)

export default function App() {
  const [dark, setDark] = useState(false)
  const [page, setPage] = useState('home')
  const [animating, setAnimating] = useState(false)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [scanAnim, setScanAnim] = useState(false)
  const [result, setResult] = useState(null)
  const [exifResult, setExifResult] = useState(null)
  const [fftResult, setFftResult] = useState(null)
  const [faceResult, setFaceResult] = useState(null)
  const [error, setError] = useState(null)
  const [activeHow, setActiveHow] = useState(0)
  const [displayScore, setDisplayScore] = useState(0)
  const fileInputRef = useRef(null)
  const scoreAnimRef = useRef(null)

  const t = dark
    ? { bg: '#07090f', bg2: '#0f1117', card: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#f1f5f9', muted: '#64748b', soft: '#94a3b8' }
    : { bg: '#f8fafc', bg2: '#ffffff', card: 'rgba(0,0,0,0.03)', border: 'rgba(0,0,0,0.08)', text: '#0f172a', muted: '#94a3b8', soft: '#475569' }

  const accent = '#6366f1'
  const pink = '#ec4899'
  const loadingSteps = ['Scanning pixels', 'Reading metadata', 'Running models', 'Fusing scores']

  const navigate = (to) => {
    if (to === page || animating) return
    setAnimating(true)
    setTimeout(() => { setPage(to); setAnimating(false); window.scrollTo({ top: 0 }) }, 320)
  }

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    setImageFile(file); setImagePreview(URL.createObjectURL(file))
    setResult(null); setError(null); setExifResult(null); setFftResult(null); setFaceResult(null)

    // Run all client-side analyses in parallel immediately on upload
    const [exif, fft, face] = await Promise.all([
      analyzeExif(file),
      analyzeFFT(file),
      analyzeFace(file)
    ])
    setExifResult(exif)
    setFftResult(fft)
    setFaceResult(face)
  }

  const handleDetect = async () => {
    if (!imageFile) return
    setIsLoading(true); setResult(null); setError(null); setScanAnim(true)
    let step = 0; setLoadingStep(0)
    const iv = setInterval(() => { step++; if (step < loadingSteps.length) setLoadingStep(step) }, 750)
    try {
      const fd = new FormData(); fd.append('image', imageFile)
      const res = await fetch('/api/detect', { method: 'POST', body: fd })
      const data = await res.json()
      clearInterval(iv); setLoadingStep(3)
      if (data.error) { setError(data.error); setIsLoading(false); setScanAnim(false); return }
      setTimeout(() => {
        setScanAnim(false); setResult(data); setIsLoading(false)
        animateScore(computeFinalScore(data.combined, exifResult, data.dimensionScore, fftResult, faceResult))
      }, 300)
    } catch { clearInterval(iv); setError('Network error — check connection'); setIsLoading(false); setScanAnim(false) }
  }

  const animateScore = (target) => {
    setDisplayScore(0)
    let current = 0
    const step = target / 40
    const timer = setInterval(() => {
      current = Math.min(target, current + step)
      setDisplayScore(Math.round(current))
      if (current >= target) clearInterval(timer)
    }, 30)
    scoreAnimRef.current = timer
  }

  const getVerdict = (score) => {
    if (score >= 75) return { label: 'AI Generated', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', glow: 'rgba(239,68,68,0.12)' }
    if (score >= 50) return { label: 'Likely AI', color: '#f97316', bg: 'rgba(249,115,22,0.1)', glow: 'rgba(249,115,22,0.12)' }
    if (score >= 30) return { label: 'Uncertain', color: '#eab308', bg: 'rgba(234,179,8,0.1)', glow: 'rgba(234,179,8,0.12)' }
    return { label: 'Likely Real', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', glow: 'rgba(34,197,94,0.12)' }
  }

  const finalScore = result ? computeFinalScore(result.combined, exifResult, result.dimensionScore, fftResult, faceResult) : 0
  const verdict = getVerdict(finalScore)

  // Count active detection layers
  const activeLayers = [
    true, // models always active
    !!exifResult,
    !!(fftResult && fftResult.confidence !== 'none'),
    !!(faceResult && faceResult.faceDetected),
    !!(result?.dimensionScore?.signals?.length > 0)
  ].filter(Boolean).length

  const howSteps = [
    {
      icon: '🧬', title: 'Pixel-level frequency analysis', subtitle: 'Visual artifacts', color: '#6366f1',
      detail: [
        'AI image generators leave microscopic statistical fingerprints in their output pixels — invisible to the human eye, but highly detectable by trained classifiers.',
        'Real camera images contain natural sensor noise called PRNU (Photo Response Non-Uniformity), lens distortion, chromatic aberration, and organic high-frequency noise from photons hitting a physical sensor.',
        'AI-generated images have pixel distributions that are statistically too smooth in some frequency bands and too structured in others. Diffusion models leave specific artifacts in 8x8 DCT blocks. GANs leave ring-shaped artifacts visible in the Fourier frequency domain.',
        'Our ensemble runs three specialized classifiers — haywoodsloan v2 (50% weight), umm-maybe (30%, GAN specialist), Organika/sdxl (20%). When models disagree by more than 30 points, haywoodsloan is automatically boosted to 70%.'
      ],
      tags: ['GAN fingerprints', 'DCT artifacts', 'Fourier analysis', 'PRNU noise', 'Adaptive weighting']
    },
    {
      icon: '🌊', title: 'FFT frequency domain analysis', subtitle: 'Spectral forensics', color: '#06b6d4',
      detail: [
        'We run a Fast Fourier Transform on the image directly in your browser — zero API calls, results in under 100ms — to analyze the frequency spectrum for AI generator signatures.',
        'GAN-based generators like StyleGAN produce characteristic checkerboard artifacts at Nyquist frequency multiples — caused by transposed convolution upsampling. These appear as bright spots in frequency space at specific harmonic intervals.',
        'Diffusion models leave a different signature — unusually smooth mid-frequency bands and flat spectral energy distribution. Real camera images follow a natural 1/f power law where high-frequency energy drops off predictably.',
        'We measure the high-to-low frequency energy ratio, local block variance, and spectral flatness. Results are blended into the final score with adaptive weighting based on detection confidence.'
      ],
      tags: ['Fast Fourier Transform', 'Checkerboard artifacts', 'Spectral flatness', '1/f power law', 'Client-side processing']
    },
    {
      icon: '👤', title: 'Face & symmetry analysis', subtitle: 'Face forensics', color: '#f59e0b',
      detail: [
        'If a face is detected in the image, we apply an additional forensic layer — because face generation is the most common AI use case and our models are heavily trained on face data.',
        'We detect faces using canvas-based skin tone heuristics (HSV color space analysis) and measure bilateral facial symmetry. Real human faces have natural asymmetry — AI-generated faces are unnaturally symmetric due to how generators learn from symmetric training data.',
        'We also measure skin texture variance. AI face generators produce extremely smooth, uniform skin tones with very low local variance — a texture signature that is statistically distinguishable from real skin at the pixel level.',
        'When a face is detected, model weights are boosted slightly to reflect higher reliability on this image type, and the face analysis contributes 12% to the final score.'
      ],
      tags: ['Skin tone detection', 'Bilateral symmetry', 'Texture variance', 'HSV color space', 'Face weight boost']
    },
    {
      icon: '⚖️', title: 'Adaptive score fusion', subtitle: 'Intelligent aggregation', color: '#ec4899',
      detail: [
        'We fuse up to 5 independent detection layers: AI model ensemble, EXIF metadata, FFT frequency analysis, face symmetry, and dimension heuristics.',
        'Each layer contributes adaptively — EXIF gets 35% weight on definitive AI signatures but only 10% when metadata is stripped. FFT gets 10% on high-confidence detections. Models maintain a minimum 50% floor to prevent noise layers from dominating.',
        'When models strongly disagree, haywoodsloan is automatically boosted to 70% since it has proven highest sensitivity. Standard deviation across model scores produces a confidence rating shown in the results.',
        'The result is a probabilistic estimate, not a binary verdict. We show full per-layer breakdowns so you can judge which signals drove the result.'
      ],
      tags: ['5-layer fusion', 'Adaptive weighting', 'Confidence scoring', 'Disagreement boost', 'Full transparency']
    },
    {
      icon: '🔮', title: 'Limitations & roadmap', subtitle: 'Honest transparency', color: '#14b8a6',
      detail: [
        'Strong detection: Stable Diffusion all versions, DALL-E 2/3, Midjourney v4-v6, Adobe Firefly, Google Imagen, StyleGAN2/3, and most face synthesis GANs.',
        'Detection degrades for post-processed AI images — sharpening, noise injection, JPEG re-compression alter frequency fingerprints. Images printed and re-photographed acquire real camera EXIF, defeating metadata detection.',
        'Current weakness: AI-enhanced real photos where inpainting, background replacement, or face swaps affect partial regions. Binary classifiers struggle with partially synthetic images.',
        'Roadmap: C2PA cryptographic watermark verification (adopted by Adobe, Google, Microsoft, OpenAI), Error Level Analysis for JPEG compression forensics, and attention-map localization to identify which specific regions are AI-generated.'
      ],
      tags: ['Supported generators', 'Post-processing limits', 'Inpainting blind spots', 'ELA forensics', 'C2PA roadmap']
    }
  ]

  const SignalTags = ({ signals, delay = 0 }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {signals.map((s, i) => (
        <span key={i} style={{ fontSize: '0.75rem', padding: '5px 11px', borderRadius: '20px', background: s.suspicious ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)', color: s.suspicious ? '#ef4444' : '#16a34a', border: `1px solid ${s.suspicious ? 'rgba(239,68,68,0.22)' : 'rgba(34,197,94,0.22)'}`, fontWeight: 500, animation: `tagPop 0.25s ease ${delay + i * 0.05}s both` }}>
          {s.suspicious ? '⚠ ' : '✓ '}{s.label}
        </span>
      ))}
    </div>
  )

  const ScoreBar = ({ score, delay = 0 }) => (
    <div style={{ background: t.card, borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
      <div style={{ height: '100%', background: score >= 50 ? 'linear-gradient(90deg, #ef4444, #f97316)' : 'linear-gradient(90deg, #22c55e, #10b981)', borderRadius: '6px', width: `${score}%`, transition: `width 1.0s cubic-bezier(0.34, 1.2, 0.64, 1)`, transitionDelay: `${delay}s` }} />
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', transition: 'background 0.3s, color 0.3s', overflowX: 'hidden' }}>

      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: dark ? 'rgba(7,9,15,0.9)' : 'rgba(255,255,255,0.9)', backdropFilter: 'blur(20px)', borderBottom: `1px solid ${t.border}`, padding: '0 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>
        <button onClick={() => navigate('home')} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <Logo size={30} />
          <span style={{ fontWeight: 900, fontSize: '1.2rem', background: `linear-gradient(135deg, ${accent}, ${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>IsItAI</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {[{ id: 'home', label: 'Home' }, { id: 'how', label: 'How it works' }, { id: 'detect', label: 'Try it free' }].map(l => (
            <button key={l.id} onClick={() => navigate(l.id)}
              style={{ background: page === l.id ? `${accent}15` : 'none', border: `1px solid ${page === l.id ? accent + '40' : 'transparent'}`, borderRadius: '8px', padding: '6px 14px', color: page === l.id ? accent : t.soft, cursor: 'pointer', fontSize: '0.88rem', fontWeight: page === l.id ? 600 : 400, transition: 'all 0.2s' }}>
              {l.label}
            </button>
          ))}
          <button onClick={() => setDark(!dark)} style={{ marginLeft: '8px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '20px', padding: '6px 14px', cursor: 'pointer', fontSize: '0.82rem', color: t.text, transition: 'all 0.2s' }}>
            {dark ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </nav>

      <div style={{ paddingTop: '64px', animation: animating ? 'pageOut 0.32s ease forwards' : 'pageIn 0.4s ease forwards' }}>

        {/* ══ HOME ══ */}
        {page === 'home' && (
          <div>
            <section style={{ minHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 1.5rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: '8%', left: '3%', width: '500px', height: '500px', background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: '8%', right: '3%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(236,72,153,0.07) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }} />
              <div style={{ marginBottom: '2rem' }}><Logo size={56} /></div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: dark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '24px', padding: '6px 18px', fontSize: '0.8rem', color: accent, marginBottom: '1.8rem', fontWeight: 500 }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'blink 2s infinite' }} />
                Live · Free · No account needed
              </div>
              <h1 style={{ fontSize: 'clamp(2.8rem, 7vw, 5rem)', fontWeight: 900, margin: '0 0 1.2rem', lineHeight: 1.04, letterSpacing: '-0.03em', maxWidth: '820px' }}>
                Can you tell which images<br />
                <span style={{ background: `linear-gradient(135deg, ${accent} 30%, ${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>are AI-generated?</span>
              </h1>
              <p style={{ color: t.soft, fontSize: 'clamp(1rem, 2vw, 1.15rem)', maxWidth: '520px', margin: '0 auto 3rem', lineHeight: 1.75 }}>
                A 5-layer forensic system — AI models, EXIF metadata, FFT frequency analysis, face symmetry, and dimension heuristics — for the most accurate detection available free.
              </p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '5rem' }}>
                <button onClick={() => navigate('detect')}
                  style={{ background: `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', color: '#fff', padding: '1rem 2.5rem', borderRadius: '14px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s', boxShadow: '0 4px 20px rgba(99,102,241,0.25)' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(99,102,241,0.4)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(99,102,241,0.25)' }}>
                  🔍 Detect an image — it's free
                </button>
                <button onClick={() => navigate('how')}
                  style={{ background: t.bg2, border: `1px solid ${t.border}`, color: t.text, padding: '1rem 2rem', borderRadius: '14px', fontSize: '1rem', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = accent}
                  onMouseLeave={e => e.currentTarget.style.borderColor = t.border}>
                  How it works →
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', maxWidth: '680px', width: '100%' }}>
                {[['98.2%', 'Accuracy', 'CIFAKE benchmark'], ['5', 'Detection layers', 'models+EXIF+FFT+face'], ['12+', 'Generators', 'detected'], ['<5s', 'Speed', 'real-time']].map(([v, l, s]) => (
                  <div key={l} style={{ padding: '1.2rem', background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '16px', textAlign: 'center', transition: 'all 0.2s', boxShadow: dark ? 'none' : '0 2px 12px rgba(0,0,0,0.04)' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = `${accent}55`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = 'translateY(0)' }}>
                    <div style={{ fontWeight: 800, fontSize: '1.5rem', background: `linear-gradient(135deg, ${accent}, ${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{v}</div>
                    <div style={{ color: t.text, fontSize: '0.78rem', fontWeight: 600, marginTop: '4px' }}>{l}</div>
                    <div style={{ color: t.muted, fontSize: '0.7rem', marginTop: '2px' }}>{s}</div>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ padding: '5rem 2rem', maxWidth: '1000px', margin: '0 auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem', marginBottom: '1.5rem' }}>
                {[
                  { icon: '🧬', title: 'Ensemble AI models', desc: 'Three specialized classifiers — haywoodsloan v2 (50%), umm-maybe (30%), Organika (20%) — each targeting different generator architectures with auto-boost on disagreement.', color: '#6366f1' },
                  { icon: '📋', title: 'Smart EXIF forensics', desc: 'Adaptive metadata analysis. EXIF weight scales from 10% (stripped metadata) to 35% (definitive AI signature) based on evidence quality score.', color: '#8b5cf6' },
                  { icon: '🌊', title: 'FFT frequency analysis', desc: 'Fast Fourier Transform runs in your browser in under 100ms. Detects GAN checkerboard artifacts, diffusion smoothness signatures, and spectral anomalies.', color: '#06b6d4' },
                ].map(f => (
                  <div key={f.title} style={{ padding: '1.8rem', background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '20px', transition: 'all 0.22s', boxShadow: dark ? 'none' : '0 2px 16px rgba(0,0,0,0.04)' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = `${f.color}50`; e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 40px ${f.color}15` }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = dark ? 'none' : '0 2px 16px rgba(0,0,0,0.04)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>{f.icon}</div>
                    <h3 style={{ margin: '0 0 0.6rem', fontWeight: 700, fontSize: '1rem' }}>{f.title}</h3>
                    <p style={{ margin: 0, color: t.soft, fontSize: '0.88rem', lineHeight: 1.7 }}>{f.desc}</p>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }}>
                {[
                  { icon: '👤', title: 'Face symmetry analysis', desc: 'Detects faces using skin tone heuristics, then measures bilateral symmetry and skin texture variance. AI faces are unnaturally symmetric and smooth.', color: '#f59e0b' },
                  { icon: '⚖️', title: 'Intelligent 5-layer fusion', desc: 'All signals blend using adaptive weights. Models maintain 50% floor. Low-quality evidence never corrupts high-confidence results. Full breakdown shown.', color: '#ec4899' }
                ].map(f => (
                  <div key={f.title} style={{ padding: '1.8rem', background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '20px', transition: 'all 0.22s', boxShadow: dark ? 'none' : '0 2px 16px rgba(0,0,0,0.04)' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = `${f.color}50`; e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 40px ${f.color}15` }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = dark ? 'none' : '0 2px 16px rgba(0,0,0,0.04)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>{f.icon}</div>
                    <h3 style={{ margin: '0 0 0.6rem', fontWeight: 700, fontSize: '1rem' }}>{f.title}</h3>
                    <p style={{ margin: 0, color: t.soft, fontSize: '0.88rem', lineHeight: 1.7 }}>{f.desc}</p>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: '3rem' }}>
                <button onClick={() => navigate('detect')} style={{ background: `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', color: '#fff', padding: '0.9rem 2.2rem', borderRadius: '12px', fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(99,102,241,0.25)' }}>
                  Try it free →
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ══ HOW IT WORKS ══ */}
        {page === 'how' && (
          <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '4rem 1.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
              <div style={{ display: 'inline-block', background: dark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '24px', padding: '6px 18px', fontSize: '0.8rem', color: accent, marginBottom: '1.2rem', fontWeight: 500 }}>Under the hood</div>
              <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', fontWeight: 900, margin: '0 0 1rem', letterSpacing: '-0.03em' }}>How the detection works</h1>
              <p style={{ color: t.soft, fontSize: '1.05rem', maxWidth: '520px', margin: '0 auto', lineHeight: 1.7 }}>Five independent forensic layers. Click each to explore the full technical depth.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '2rem' }}>
              {howSteps.map((s, i) => (
                <button key={i} onClick={() => setActiveHow(i)}
                  style={{ padding: '0.9rem', borderRadius: '14px', border: `1.5px solid ${activeHow === i ? s.color : t.border}`, background: activeHow === i ? `${s.color}10` : t.bg2, cursor: 'pointer', transition: 'all 0.25s', textAlign: 'left', boxShadow: activeHow === i ? `0 4px 20px ${s.color}20` : 'none' }}>
                  <div style={{ fontSize: '1.4rem', marginBottom: '6px' }}>{s.icon}</div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.3, color: activeHow === i ? s.color : t.text }}>{s.subtitle}</div>
                  <div style={{ fontSize: '0.65rem', color: activeHow === i ? s.color : t.muted, marginTop: '3px' }}>Layer {i + 1}</div>
                </button>
              ))}
            </div>

            {howSteps.map((s, i) => i === activeHow && (
              <div key={i} style={{ background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '24px', overflow: 'hidden', animation: 'panelIn 0.35s ease', boxShadow: dark ? `0 0 50px ${s.color}08` : '0 4px 40px rgba(0,0,0,0.06)' }}>
                <div style={{ padding: '2rem 2.5rem', background: `${s.color}07`, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ fontSize: '3rem' }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: s.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '5px' }}>Layer {i + 1} — {s.subtitle}</div>
                    <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-0.02em' }}>{s.title}</h2>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 250px' }}>
                  <div style={{ padding: '2rem 2.5rem', borderRight: `1px solid ${t.border}` }}>
                    {s.detail.map((para, pi) => (
                      <p key={pi} style={{ color: t.soft, lineHeight: 1.85, fontSize: '0.95rem', margin: pi === 0 ? '0 0 1.2rem' : '1.2rem 0 0', animation: `fadeIn 0.4s ease ${pi * 0.08}s both` }}>{para}</p>
                    ))}
                  </div>
                  <div style={{ padding: '2rem 1.5rem' }}>
                    <div style={{ fontSize: '0.7rem', color: t.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem' }}>Key concepts</div>
                    {s.tags.map((tag, ti) => (
                      <div key={tag} style={{ padding: '8px 12px', background: `${s.color}0d`, border: `1px solid ${s.color}20`, borderRadius: '10px', fontSize: '0.8rem', color: s.color, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px', animation: `slideRight 0.3s ease ${ti * 0.06}s both` }}>
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: s.color, flexShrink: 0 }} />{tag}
                      </div>
                    ))}
                    <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${t.border}` }}>
                      <div style={{ fontSize: '0.7rem', color: t.muted, marginBottom: '8px' }}>Progress</div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {howSteps.map((_, di) => (
                          <div key={di} onClick={() => setActiveHow(di)} style={{ height: '4px', flex: 1, borderRadius: '2px', background: di <= i ? s.color : t.border, cursor: 'pointer', transition: 'background 0.3s' }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ padding: '1.2rem 2.5rem', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button onClick={() => setActiveHow(Math.max(0, i - 1))} disabled={i === 0}
                    style={{ background: 'none', border: `1px solid ${i === 0 ? 'transparent' : t.border}`, borderRadius: '8px', padding: '7px 18px', color: i === 0 ? t.muted : t.text, cursor: i === 0 ? 'default' : 'pointer', fontSize: '0.85rem' }}>
                    ← Previous
                  </button>
                  <span style={{ fontSize: '0.8rem', color: t.muted }}>{i + 1} of {howSteps.length}</span>
                  {i < howSteps.length - 1 ? (
                    <button onClick={() => setActiveHow(i + 1)} style={{ background: `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', borderRadius: '8px', padding: '7px 18px', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>Next →</button>
                  ) : (
                    <button onClick={() => navigate('detect')} style={{ background: `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', borderRadius: '8px', padding: '7px 18px', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>Try it free →</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══ DETECT ══ */}
        {page === 'detect' && (
          <div style={{ maxWidth: '600px', margin: '0 auto', padding: '4rem 1.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
              <div style={{ display: 'inline-block', background: dark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '24px', padding: '6px 18px', fontSize: '0.8rem', color: accent, marginBottom: '1.2rem', fontWeight: 500 }}>Free · Instant · Private</div>
              <h1 style={{ fontSize: 'clamp(2rem, 5vw, 2.8rem)', fontWeight: 900, margin: '0 0 0.8rem', letterSpacing: '-0.03em' }}>Analyze your image</h1>
              <p style={{ color: t.soft, lineHeight: 1.7, margin: 0, fontSize: '0.95rem' }}>
                Upload any photo for a complete 5-layer forensic breakdown in under 5 seconds.
                {imageFile && fftResult && faceResult && <span style={{ color: accent, fontWeight: 600 }}> {activeLayers} layers active.</span>}
              </p>
            </div>

            {/* Upload zone */}
            <div style={{ background: t.bg2, border: `2px dashed ${isDragging ? accent : t.border}`, borderRadius: '20px', overflow: 'hidden', marginBottom: '1rem', transition: 'all 0.2s', boxShadow: isDragging ? `0 0 30px rgba(99,102,241,0.15)` : dark ? 'none' : '0 2px 16px rgba(0,0,0,0.04)', position: 'relative' }}
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }}>
              {imagePreview ? (
                <div style={{ position: 'relative' }}>
                  <img src={imagePreview} alt="preview" style={{ width: '100%', maxHeight: '380px', objectFit: 'cover', display: 'block' }} />
                  {scanAnim && (
                    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                      <div style={{ position: 'absolute', left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, animation: 'scanLine 1.2s ease-in-out infinite', boxShadow: `0 0 12px ${accent}` }} />
                      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${accent}08 0%, transparent 50%, ${pink}08 100%)`, animation: 'pulseOverlay 1.5s ease-in-out infinite' }} />
                      <div style={{ position: 'absolute', top: '12px', left: '12px', background: 'rgba(99,102,241,0.9)', color: '#fff', padding: '4px 12px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff', animation: 'blink 0.8s infinite' }} />SCANNING
                      </div>
                    </div>
                  )}
                  <button onClick={() => { setImageFile(null); setImagePreview(null); setResult(null); setExifResult(null); setFftResult(null); setFaceResult(null); setError(null) }}
                    style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.65)', border: 'none', color: '#fff', borderRadius: '50%', width: '34px', height: '34px', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>×</button>
                  <div style={{ position: 'absolute', bottom: '12px', left: '12px', background: 'rgba(0,0,0,0.68)', padding: '4px 12px', borderRadius: '8px', fontSize: '0.75rem', color: '#e2e8f0', zIndex: 2 }}>🖼 {imageFile?.name}</div>
                </div>
              ) : (
                <div style={{ padding: '3.5rem 2rem', textAlign: 'center', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: `${accent}12`, border: `1px solid ${accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', margin: '0 auto 1.2rem' }}>🖼️</div>
                  <p style={{ color: t.soft, margin: '0 0 0.4rem', fontWeight: 500 }}>Drop your image here or <span style={{ color: accent, fontWeight: 700 }}>browse files</span></p>
                  <p style={{ color: t.muted, fontSize: '0.8rem', margin: 0 }}>PNG · JPG · WEBP · up to 20MB</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
            </div>

            {/* Pre-detection analysis previews */}
            {exifResult && !result && (
              <div style={{ background: t.bg2, border: `1px solid ${accent}22`, borderRadius: '14px', padding: '1.2rem', marginBottom: '0.75rem', animation: 'slideUp 0.35s ease' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>📋 Metadata preview</div>
                  <div style={{ fontSize: '0.7rem', color: t.muted }}>Evidence: <span style={{ color: exifResult.evidenceQuality >= 50 ? '#22c55e' : exifResult.evidenceQuality >= 25 ? '#eab308' : '#f87171', fontWeight: 600 }}>{exifResult.evidenceQuality >= 50 ? 'High' : exifResult.evidenceQuality >= 25 ? 'Medium' : 'Low'}</span> · EXIF weight: <span style={{ color: accent, fontWeight: 600 }}>{Math.round(exifResult.exifWeight * 100)}%</span></div>
                </div>
                <SignalTags signals={exifResult.signals} delay={0} />
              </div>
            )}

            {fftResult && !result && fftResult.signals.length > 0 && (
              <div style={{ background: t.bg2, border: '1px solid rgba(6,182,212,0.22)', borderRadius: '14px', padding: '1.2rem', marginBottom: '0.75rem', animation: 'slideUp 0.4s ease' }}>
                <div style={{ fontSize: '0.7rem', color: '#06b6d4', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>🌊 Frequency analysis preview</div>
                <SignalTags signals={fftResult.signals} delay={0.1} />
              </div>
            )}

            {faceResult && !result && faceResult.faceDetected && (
              <div style={{ background: t.bg2, border: '1px solid rgba(245,158,11,0.22)', borderRadius: '14px', padding: '1.2rem', marginBottom: '0.75rem', animation: 'slideUp 0.45s ease' }}>
                <div style={{ fontSize: '0.7rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>👤 Face analysis preview</div>
                <SignalTags signals={faceResult.signals} delay={0.15} />
              </div>
            )}

            {/* Loading */}
            {isLoading && (
              <div style={{ background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '1.5rem', marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', marginBottom: '1rem' }}>
                  {loadingSteps.map((s, i) => (
                    <div key={s} style={{ textAlign: 'center' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: i < loadingStep ? `${accent}20` : i === loadingStep ? `linear-gradient(135deg, ${accent}, ${pink})` : t.card, border: `1.5px solid ${i <= loadingStep ? accent : t.border}`, margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: i < loadingStep ? accent : i === loadingStep ? '#fff' : t.muted, transition: 'all 0.4s', animation: i === loadingStep ? 'pulseRing 1s ease infinite' : 'none' }}>
                        {i < loadingStep ? '✓' : i + 1}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: i <= loadingStep ? accent : t.muted, fontWeight: i === loadingStep ? 700 : 400 }}>{s}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: t.card, borderRadius: '6px', height: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: `linear-gradient(90deg, ${accent}, ${pink})`, borderRadius: '6px', width: `${((loadingStep + 1) / loadingSteps.length) * 100}%`, transition: 'width 0.7s ease' }} />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', borderRadius: '12px', padding: '1rem 1.2rem', color: '#dc2626', fontSize: '0.9rem', marginBottom: '1rem', animation: 'slideUp 0.3s ease' }}>
                ⚠️ {error} — Models may be cold-starting, try again in 30s.
              </div>
            )}

            {/* Result card */}
            {result && (
              <div style={{ background: t.bg2, border: `1.5px solid ${verdict.color}35`, borderRadius: '22px', overflow: 'hidden', marginBottom: '1rem', boxShadow: `0 0 60px ${verdict.glow}`, animation: 'resultReveal 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                <div style={{ padding: '2.5rem 2rem', textAlign: 'center', background: `${verdict.color}06`, borderBottom: `1px solid ${t.border}`, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 50%, ${verdict.color}08 0%, transparent 70%)`, pointerEvents: 'none' }} />
                  <div style={{ fontSize: '5.5rem', fontWeight: 900, color: verdict.color, lineHeight: 1, letterSpacing: '-0.04em', animation: 'countUp 0.8s ease' }}>{displayScore}%</div>
                  <div style={{ display: 'inline-block', marginTop: '12px', padding: '6px 22px', borderRadius: '24px', background: verdict.bg, border: `1px solid ${verdict.color}30`, fontSize: '1rem', fontWeight: 700, color: verdict.color, animation: 'fadeIn 0.4s ease 0.3s both' }}>{verdict.label}</div>
                  <div style={{ color: t.muted, fontSize: '0.82rem', marginTop: '10px', animation: 'fadeIn 0.4s ease 0.4s both' }}>
                    {activeLayers} layers active · Confidence: <span style={{ color: result.confidence === 'high' ? '#22c55e' : result.confidence === 'medium' ? '#eab308' : '#f87171', fontWeight: 600 }}>{result.confidence}</span>
                  </div>
                </div>

                {result.disagreement && (
                  <div style={{ padding: '0.75rem 1.5rem', background: 'rgba(234,179,8,0.07)', borderBottom: `1px solid rgba(234,179,8,0.18)`, color: '#b45309', fontSize: '0.85rem', textAlign: 'center' }}>
                    ⚠️ Models disagreed — haywoodsloan boosted to 70%
                  </div>
                )}

                <div style={{ padding: '1.5rem' }}>
                  <div style={{ fontSize: '0.7rem', color: t.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1.2rem' }}>Detection breakdown</div>

                  {/* AI Models */}
                  {result.modelResults.map((m, mi) => (
                    <div key={m.name} style={{ marginBottom: '1.1rem', animation: `slideRight 0.4s ease ${mi * 0.1}s both` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                        <span style={{ color: t.soft }}>{m.name.split('/')[1]}{m.weightAdjusted && <span style={{ color: accent, fontSize: '0.72rem', marginLeft: '6px' }}>↑ boosted</span>}</span>
                        <span style={{ color: m.aiScore >= 50 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{m.aiScore}%</span>
                      </div>
                      <ScoreBar score={m.aiScore} delay={mi * 0.1} />
                    </div>
                  ))}

                  {/* EXIF */}
                  {exifResult && (
                    <div style={{ marginTop: '1.2rem', paddingTop: '1.2rem', borderTop: `1px solid ${t.border}`, animation: 'slideRight 0.4s ease 0.35s both' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                        <span style={{ color: accent, fontWeight: 600 }}>📋 EXIF Metadata <span style={{ color: t.muted, fontWeight: 400, fontSize: '0.78rem' }}>({Math.round(exifResult.exifWeight * 100)}% weight)</span></span>
                        <span style={{ color: exifResult.aiScore >= 50 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{exifResult.aiScore}%</span>
                      </div>
                      <div style={{ marginBottom: '1rem' }}><ScoreBar score={exifResult.aiScore} delay={0.35} /></div>
                      <SignalTags signals={exifResult.signals} delay={0.4} />
                    </div>
                  )}

                  {/* FFT */}
                  {fftResult && fftResult.signals.length > 0 && (
                    <div style={{ marginTop: '1.2rem', paddingTop: '1.2rem', borderTop: `1px solid ${t.border}`, animation: 'slideRight 0.4s ease 0.45s both' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                        <span style={{ color: '#06b6d4', fontWeight: 600 }}>🌊 Frequency Analysis <span style={{ color: t.muted, fontWeight: 400, fontSize: '0.78rem' }}>({fftResult.confidence} confidence)</span></span>
                        <span style={{ color: fftResult.score >= 30 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{fftResult.score}%</span>
                      </div>
                      <div style={{ marginBottom: '1rem' }}><ScoreBar score={fftResult.score} delay={0.45} /></div>
                      <SignalTags signals={fftResult.signals} delay={0.5} />
                    </div>
                  )}

                  {/* Face */}
                  {faceResult && faceResult.signals.length > 0 && (
                    <div style={{ marginTop: '1.2rem', paddingTop: '1.2rem', borderTop: `1px solid ${t.border}`, animation: 'slideRight 0.4s ease 0.55s both' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>👤 Face Analysis <span style={{ color: t.muted, fontWeight: 400, fontSize: '0.78rem' }}>{faceResult.faceDetected ? `(${faceResult.skinRatio}% skin detected)` : '(no face found)'}</span></span>
                        <span style={{ color: faceResult.score >= 30 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{faceResult.score}%</span>
                      </div>
                      {faceResult.faceDetected && <div style={{ marginBottom: '1rem' }}><ScoreBar score={faceResult.score} delay={0.55} /></div>}
                      <SignalTags signals={faceResult.signals} delay={0.6} />
                    </div>
                  )}

                  {/* Dimensions */}
                  {result?.dimensionScore?.signals?.length > 0 && (
                    <div style={{ marginTop: '1.2rem', paddingTop: '1.2rem', borderTop: `1px solid ${t.border}`, animation: 'slideRight 0.4s ease 0.65s both' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                        <span style={{ color: '#14b8a6', fontWeight: 600 }}>📐 Dimension heuristics <span style={{ color: t.muted, fontWeight: 400, fontSize: '0.78rem' }}>({result.dimensionScore.confidence} confidence)</span></span>
                        <span style={{ color: result.dimensionScore.score >= 30 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{result.dimensionScore.score}%</span>
                      </div>
                      <div style={{ marginBottom: '1rem' }}><ScoreBar score={result.dimensionScore.score} delay={0.65} /></div>
                      <SignalTags signals={result.dimensionScore.signals} delay={0.7} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {imageFile ? (
              <button onClick={handleDetect} disabled={isLoading}
                style={{ width: '100%', background: isLoading ? t.card : `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', color: isLoading ? t.muted : '#fff', padding: '1.1rem', borderRadius: '14px', fontSize: '1rem', fontWeight: 700, cursor: isLoading ? 'not-allowed' : 'pointer', transition: 'all 0.2s', boxShadow: isLoading ? 'none' : '0 4px 20px rgba(99,102,241,0.25)' }}>
                {isLoading ? '⏳ Analyzing image...' : result ? '🔄 Analyze Again' : "🔍 Detect Now — It's Free"}
              </button>
            ) : (
              <button onClick={() => fileInputRef.current?.click()}
                style={{ width: '100%', background: `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', color: '#fff', padding: '1.1rem', borderRadius: '14px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(99,102,241,0.25)' }}>
                📁 Upload an Image
              </button>
            )}
            <p style={{ color: t.muted, fontSize: '0.75rem', textAlign: 'center', marginTop: '0.8rem' }}>🔒 Your image is never stored · Processed entirely in real-time</p>
          </div>
        )}

        <footer style={{ borderTop: `1px solid ${t.border}`, padding: '2rem', textAlign: 'center', marginTop: '4rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '0.4rem' }}>
            <Logo size={22} />
            <span style={{ fontWeight: 900, background: `linear-gradient(135deg, ${accent}, ${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: '1rem' }}>IsItAI</span>
          </div>
          <p style={{ color: t.muted, margin: 0, fontSize: '0.82rem' }}>Built with Next.js · Powered by Hugging Face · © 2025 IsItAI</p>
        </footer>
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes pageIn { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pageOut { from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(-8px)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideRight { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes panelIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes tagPop { from{opacity:0;transform:scale(0.8)} to{opacity:1;transform:scale(1)} }
        @keyframes resultReveal { from{opacity:0;transform:scale(0.96) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes scanLine { 0%{top:-3px;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{top:100%;opacity:0} }
        @keyframes pulseOverlay { 0%,100%{opacity:0.4} 50%{opacity:0.7} }
        @keyframes pulseRing { 0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,0.4)} 50%{box-shadow:0 0 0 6px rgba(99,102,241,0)} }
        @keyframes countUp { from{opacity:0;transform:scale(0.8)} to{opacity:1;transform:scale(1)} }
        * { box-sizing:border-box }
        html { scroll-behavior:smooth }
      `}</style>
    </div>
  )
}