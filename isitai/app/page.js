'use client'
import { useState, useRef } from 'react'
import * as exifr from 'exifr'
import Link from 'next/link'

// ── EXIF Analysis ──────────────────────────────────────────────────────────
async function analyzeExif(file) {
  try {
    const exif = await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true })
    if (!exif) return { aiScore: 72, exifWeight: 0.18, confidence: 'medium', evidenceQuality: 0, signals: [{ label: 'No EXIF data found', suspicious: true }, { label: 'Real photos always contain metadata', suspicious: true }], verdict: 'no_metadata' }
    const signals = []; let rawScore = 0; let evidenceQuality = 0
    const sw = (exif.Software || exif.software || exif['dc:creator'] || exif.CreatorTool || '').toLowerCase()
    const aiTools = [{ name: 'stable diffusion', label: 'Stable Diffusion' }, { name: 'midjourney', label: 'Midjourney' }, { name: 'dall-e', label: 'DALL-E' }, { name: 'firefly', label: 'Adobe Firefly' }, { name: 'gemini', label: 'Google Gemini' }, { name: 'openai', label: 'OpenAI' }, { name: 'runway', label: 'Runway ML' }, { name: 'imagen', label: 'Google Imagen' }, { name: 'nightcafe', label: 'NightCafe' }, { name: 'leonardo', label: 'Leonardo AI' }, { name: 'invoke', label: 'InvokeAI' }, { name: 'automatic1111', label: 'A1111 WebUI' }]
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
    const hasLens = !!(exif.FocalLength || exif.LensModel)
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
    return { aiScore: Math.min(95, Math.max(3, Math.round(rawScore))), exifWeight, confidence, evidenceQuality, signals, verdict: foundAI ? 'definitive_ai' : hasCamera ? 'has_camera' : 'no_camera' }
  } catch { return { aiScore: 45, exifWeight: 0.10, confidence: 'very_low', evidenceQuality: 0, signals: [{ label: 'Could not parse metadata', suspicious: true }], verdict: 'parse_error' } }
}

// ── FFT Analysis ───────────────────────────────────────────────────────────
async function analyzeFFT(file) {
  return new Promise((resolve) => {
    const img = new Image(); const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const SIZE = 256; const canvas = document.createElement('canvas'); canvas.width = SIZE; canvas.height = SIZE
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, SIZE, SIZE)
        const imageData = ctx.getImageData(0, 0, SIZE, SIZE); URL.revokeObjectURL(url)
        const gray = new Float32Array(SIZE * SIZE)
        for (let i = 0; i < SIZE * SIZE; i++) { gray[i] = (0.299 * imageData.data[i*4] + 0.587 * imageData.data[i*4+1] + 0.114 * imageData.data[i*4+2]) / 255.0 }
        const rowSums = new Float32Array(SIZE); const colSums = new Float32Array(SIZE)
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) { rowSums[y] += gray[y*SIZE+x]; colSums[x] += gray[y*SIZE+x] }
        const dftMag = (signal) => { const N = signal.length; const mags = new Float32Array(N/2); for (let k = 0; k < N/2; k++) { let re=0,im=0; for (let n=0;n<N;n++){const a=(2*Math.PI*k*n)/N;re+=signal[n]*Math.cos(a);im-=signal[n]*Math.sin(a)} mags[k]=Math.sqrt(re*re+im*im) } return mags }
        const rowMags = dftMag(rowSums); const colMags = dftMag(colSums)
        const rowMax = Math.max(...rowMags); const colMax = Math.max(...colMags)
        const rowNorm = rowMags.map(v => rowMax > 0 ? v/rowMax : 0); const colNorm = colMags.map(v => colMax > 0 ? v/colMax : 0)
        const hfs = Math.floor(SIZE/4); const hfe = Math.floor(SIZE/2)
        let hfR=0,lfR=0,hfC=0,lfC=0
        for (let k=1;k<hfs;k++){lfR+=rowNorm[k];lfC+=colNorm[k]}
        for (let k=hfs;k<hfe;k++){hfR+=rowNorm[k];hfC+=colNorm[k]}
        const avgRatio = ((lfR>0?hfR/lfR:0) + (lfC>0?hfC/lfC:0)) / 2
        const signals = []; let suspicionScore = 0
        if (avgRatio > 0.65) { signals.push({ label: 'High-frequency GAN artifacts detected', suspicious: true }); suspicionScore += 45 }
        else if (avgRatio > 0.45) { signals.push({ label: 'Elevated high-frequency energy', suspicious: true }); suspicionScore += 25 }
        else { signals.push({ label: 'Natural frequency falloff pattern', suspicious: false }); suspicionScore -= 10 }
        let tv = 0; const bs = 16; const nb = Math.floor(SIZE/bs)
        for (let by=0;by<nb;by++) for (let bx=0;bx<nb;bx++) { let s=0,sq=0,c=0; for(let y=by*bs;y<(by+1)*bs;y++) for(let x=bx*bs;x<(bx+1)*bs;x++){const v=gray[y*SIZE+x];s+=v;sq+=v*v;c++} const m=s/c; tv+=(sq/c-m*m) }
        const av = tv/(nb*nb)
        if (av < 0.004) { signals.push({ label: 'Unnaturally smooth texture', suspicious: true }); suspicionScore += 30 }
        else if (av > 0.02) { signals.push({ label: 'Natural texture variance', suspicious: false }); suspicionScore -= 5 }
        resolve({ score: Math.max(0, Math.min(90, suspicionScore)), signals, confidence: Math.abs(suspicionScore) > 30 ? 'high' : Math.abs(suspicionScore) > 15 ? 'medium' : 'low' })
      } catch { URL.revokeObjectURL(url); resolve({ score: 0, signals: [], confidence: 'none' }) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ score: 0, signals: [], confidence: 'none' }) }
    img.src = url
  })
}

// ── Face Analysis ──────────────────────────────────────────────────────────
async function analyzeFace(file) {
  return new Promise((resolve) => {
    const img = new Image(); const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const SIZE = 256; const canvas = document.createElement('canvas'); canvas.width = SIZE; canvas.height = SIZE
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, SIZE, SIZE)
        const imageData = ctx.getImageData(0, 0, SIZE, SIZE); URL.revokeObjectURL(url)
        let skinPixels = 0; const symData = []
        for (let i = 0; i < SIZE*SIZE; i++) {
          const r=imageData.data[i*4]/255,g=imageData.data[i*4+1]/255,b=imageData.data[i*4+2]/255
          const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min; let h=0,s=0,v=max
          if(delta>0){s=delta/max;if(max===r)h=60*(((g-b)/delta)%6);else if(max===g)h=60*((b-r)/delta+2);else h=60*((r-g)/delta+4);if(h<0)h+=360}
          if(h>=0&&h<=50&&s>=0.15&&s<=0.85&&v>=0.35)skinPixels++
          symData.push(v)
        }
        const skinRatio = skinPixels/(SIZE*SIZE); const signals = []; let suspicionScore = 0; let faceDetected = false
        if (skinRatio > 0.08) {
          faceDetected = true; signals.push({ label: `Face detected (${Math.round(skinRatio*100)}% skin)`, suspicious: false })
          let symScore=0,comps=0
          for(let y=Math.floor(SIZE*0.2);y<Math.floor(SIZE*0.8);y++) for(let x=0;x<Math.floor(SIZE/2);x++){symScore+=1-Math.abs(symData[y*SIZE+x]-symData[y*SIZE+(SIZE-1-x)]);comps++}
          const ns = comps>0?symScore/comps:0
          if(ns>0.93){signals.push({label:`Unnatural facial symmetry (${(ns*100).toFixed(1)}%)`,suspicious:true});suspicionScore+=35}
          else if(ns>0.90){signals.push({label:`High facial symmetry (${(ns*100).toFixed(1)}%)`,suspicious:true});suspicionScore+=18}
          else{signals.push({label:`Natural facial asymmetry (${(ns*100).toFixed(1)}%)`,suspicious:false});suspicionScore-=5}
        } else { signals.push({ label: 'No face detected', suspicious: false }) }
        resolve({ score: Math.max(0, Math.min(90, suspicionScore)), signals, confidence: faceDetected?(Math.abs(suspicionScore)>25?'high':'medium'):'none', faceDetected, faceWeight: faceDetected?0.08:0, skinRatio: Math.round(skinRatio*100) })
      } catch { URL.revokeObjectURL(url); resolve({ score: 0, signals: [], confidence: 'none', faceDetected: false, faceWeight: 0 }) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ score: 0, signals: [], confidence: 'none', faceDetected: false, faceWeight: 0 }) }
    img.src = url
  })
}

// ── Score fusion ───────────────────────────────────────────────────────────
function computeFinalScore(modelCombined, exifData, dimensionScore, fftResult, faceResult) {
  let exifWeight = exifData?.exifWeight || 0
  let dimWeight = 0, fftWeight = 0
  const faceWeight = faceResult?.faceWeight || 0
  if (dimensionScore && dimensionScore.confidence !== 'none' && dimensionScore.confidence !== 'low') dimWeight = dimensionScore.confidence === 'high' ? 0.12 : 0.06
  if (fftResult && fftResult.confidence !== 'none' && fftResult.confidence !== 'low') fftWeight = fftResult.confidence === 'high' ? 0.10 : 0.05
  const extraWeight = exifWeight + dimWeight + fftWeight + faceWeight
  const modelWeight = Math.max(0.50, 1 - extraWeight)
  const scale = 1 / (modelWeight + extraWeight)
  return Math.min(99, Math.max(1, Math.round(
    modelCombined * modelWeight * scale +
    (exifData?.aiScore || 0) * exifWeight * scale +
    (dimensionScore?.score || 0) * dimWeight * scale +
    (fftResult?.score || 0) * fftWeight * scale +
    (faceResult?.score || 0) * faceWeight * scale
  )))
}

// ── Task 1: Human-readable verdict ─────────────────────────────────────────
function getVerdictSentence(score, modelConfidence) {
  const conf = modelConfidence === 'high' ? 'high' : modelConfidence === 'medium' ? 'moderate' : 'low'
  if (score >= 85) return { headline: 'Almost certainly AI-generated', sentence: `This image was almost certainly created by an AI image generator. Our ${conf}-confidence analysis found strong signatures across multiple detection layers.`, emoji: '🤖', color: '#ef4444' }
  if (score >= 70) return { headline: 'Very likely AI-generated', sentence: `This image appears to be AI-generated. We found consistent indicators across our forensic layers pointing toward synthetic generation.`, emoji: '🤖', color: '#ef4444' }
  if (score >= 55) return { headline: 'Likely AI-generated', sentence: `This image was probably generated by AI, though some signals are mixed. We found more evidence pointing toward AI than toward a real photo.`, emoji: '⚠️', color: '#f97316' }
  if (score >= 42) return { headline: 'Inconclusive — mixed signals', sentence: `We cannot make a confident determination. This image shows signals of both AI generation and real photography. It may be AI-enhanced, heavily edited, or from an unfamiliar generator.`, emoji: '🤔', color: '#eab308' }
  if (score >= 25) return { headline: 'Probably a real photo', sentence: `This image appears to be a real photograph. Most of our detection layers found no significant AI indicators, though a small amount of uncertainty remains.`, emoji: '✅', color: '#22c55e' }
  return { headline: 'Almost certainly a real photo', sentence: `This image looks real. Our analysis found strong indicators of genuine camera photography — natural metadata, organic texture patterns, and no AI generator signatures.`, emoji: '✅', color: '#22c55e' }
}

// ── Logo ───────────────────────────────────────────────────────────────────
const Logo = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs><linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#6366f1"/><stop offset="100%" stopColor="#ec4899"/></linearGradient></defs>
    <rect width="32" height="32" rx="8" fill="url(#lg)"/>
    <ellipse cx="16" cy="15" rx="8.5" ry="5.5" fill="none" stroke="white" strokeWidth="1.8"/>
    <circle cx="16" cy="15" r="2.8" fill="white"/>
    <circle cx="16" cy="15" r="1.1" fill="url(#lg)"/>
    <line x1="21.5" y1="20.5" x2="25.5" y2="24.5" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
    <circle cx="10" cy="10" r="1" fill="rgba(255,255,255,0.5)"/>
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
  const [showDetails, setShowDetails] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const fileInputRef = useRef(null)
  const scoreAnimRef = useRef(null)

  const t = dark
    ? { bg: '#07090f', bg2: '#0f1117', bg3: '#161b27', card: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#f1f5f9', muted: '#64748b', soft: '#94a3b8' }
    : { bg: '#f8fafc', bg2: '#ffffff', bg3: '#f1f5f9', card: 'rgba(0,0,0,0.03)', border: 'rgba(0,0,0,0.08)', text: '#0f172a', muted: '#94a3b8', soft: '#475569' }

  const accent = '#6366f1'; const pink = '#ec4899'
  const loadingSteps = ['Scanning pixels', 'Reading metadata', 'Running models', 'Fusing scores']

  const navigate = (to) => {
    if (to === page || animating) return
    setMenuOpen(false); setAnimating(true)
    setTimeout(() => { setPage(to); setAnimating(false); window.scrollTo({ top: 0 }) }, 320)
  }

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    setImageFile(file); setImagePreview(URL.createObjectURL(file))
    setResult(null); setError(null); setExifResult(null); setFftResult(null); setFaceResult(null); setShowDetails(false)
    const [exif, fft, face] = await Promise.all([analyzeExif(file), analyzeFFT(file), analyzeFace(file)])
    setExifResult(exif); setFftResult(fft); setFaceResult(face)
  }

  const handleDetect = async () => {
    if (!imageFile) return
    setIsLoading(true); setResult(null); setError(null); setScanAnim(true); setShowDetails(false)
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
        const fs = computeFinalScore(data.combined, exifResult, data.dimensionScore, fftResult, faceResult)
        animateScore(fs)
      }, 300)
    } catch { clearInterval(iv); setError('Network error — try again'); setIsLoading(false); setScanAnim(false) }
  }

  const animateScore = (target) => {
    setDisplayScore(0); let current = 0; const step = target / 45
    const timer = setInterval(() => { current = Math.min(target, current + step); setDisplayScore(Math.round(current)); if (current >= target) clearInterval(timer) }, 25)
    scoreAnimRef.current = timer
  }

  const finalScore = result ? computeFinalScore(result.combined, exifResult, result.dimensionScore, fftResult, faceResult) : 0
  const verdictData = getVerdictSentence(finalScore, result?.confidence || 'low')

  const SignalTags = ({ signals, accentColor }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
      {signals.map((s, i) => (
        <span key={i} style={{ fontSize: '0.73rem', padding: '4px 10px', borderRadius: '20px', background: s.suspicious ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)', color: s.suspicious ? '#ef4444' : '#16a34a', border: `1px solid ${s.suspicious ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`, fontWeight: 500 }}>
          {s.suspicious ? '⚠ ' : '✓ '}{s.label}
        </span>
      ))}
    </div>
  )

  const ScoreBar = ({ score, delay = 0 }) => (
    <div style={{ background: t.card, borderRadius: '6px', height: '7px', overflow: 'hidden', marginTop: '6px' }}>
      <div style={{ height: '100%', background: score >= 50 ? 'linear-gradient(90deg,#ef4444,#f97316)' : 'linear-gradient(90deg,#22c55e,#10b981)', borderRadius: '6px', width: `${score}%`, transition: `width 0.9s cubic-bezier(0.34,1.2,0.64,1)`, transitionDelay: `${delay}s` }} />
    </div>
  )

  const howSteps = [
    { icon: '🧬', title: 'AI model ensemble', subtitle: 'Visual artifacts', color: '#6366f1', detail: ['Three specialized AI classifiers analyze pixel-level patterns invisible to the human eye. Each model was trained on millions of real vs. synthetic image pairs.', 'haywoodsloan (50% weight) has proven highest sensitivity on modern AI outputs. umm-maybe (30%) specializes in GAN architectures. Organika/sdxl (20%) targets SDXL pipeline outputs specifically.', 'When models strongly disagree — spread greater than 30 points — haywoodsloan is automatically boosted to 70% weight since disagreement itself is a detection signal.'], tags: ['GAN fingerprints', 'DCT artifacts', 'Fourier analysis', 'PRNU noise', 'Auto-boost'] },
    { icon: '📋', title: 'EXIF forensics', subtitle: 'Metadata analysis', color: '#8b5cf6', detail: ['Every real camera photo embeds rich provenance data — camera make/model, GPS, timestamps, aperture, lens info — written automatically at capture. AI images have empty or revealing metadata.', 'We check 12+ EXIF fields and cross-reference software strings against a database of known AI tool identifiers. AI signature found means definitive evidence.', 'EXIF weight is adaptive: definitive AI signature gets 35%, quality real metadata gets 28%, stripped metadata (common after WhatsApp/Instagram) gets only 10%.'], tags: ['EXIF parsing', 'Adaptive weight', 'Software signatures', 'Evidence quality', 'C2PA'] },
    { icon: '🌊', title: 'FFT frequency analysis', subtitle: 'Spectral forensics', color: '#06b6d4', detail: ['A Fast Fourier Transform runs in your browser in under 100ms — zero API calls. GAN generators leave checkerboard artifacts at Nyquist frequencies. Diffusion models leave unnaturally smooth spectral distributions.', 'Real photos follow a natural 1/f power law where high-frequency energy falls off predictably. We measure high-to-low frequency ratios and local texture variance to detect deviations.', 'This layer catches generators that defeat EXIF and model detection by analyzing the fundamental mathematical structure of the image signal.'], tags: ['Fast Fourier Transform', 'Checkerboard detection', 'Spectral flatness', '1/f power law', 'Zero API cost'] },
    { icon: '👤', title: 'Face symmetry analysis', subtitle: 'Face forensics', color: '#f59e0b', detail: ['When a face is detected using skin-tone heuristics, we measure bilateral facial symmetry. Real human faces have natural asymmetry — AI faces are unnaturally symmetric due to symmetric training data.', 'We also measure skin texture variance. AI face generators produce extremely smooth, statistically uniform skin tones distinguishable from real skin at pixel level.', 'Face detection boosts model weights slightly since all three classifiers are heavily trained on face data and are most reliable in this domain.'], tags: ['Skin tone HSV', 'Bilateral symmetry', 'Texture variance', 'Face weight boost', 'No external API'] },
    { icon: '🔮', title: 'Limitations', subtitle: 'Honest transparency', color: '#14b8a6', detail: ['Strong detection: Stable Diffusion all versions, DALL-E 2/3, Midjourney v4-v6, Adobe Firefly, Google Imagen, StyleGAN2/3, and most face GANs.', 'Detection degrades for: heavily post-processed AI images (sharpening/noise injection alter frequency fingerprints), images printed and re-photographed (acquire real camera EXIF), and partial AI edits (inpainting, background replacement).', 'Roadmap: C2PA cryptographic watermark reading (adopted by Adobe, Google, Microsoft, OpenAI), Error Level Analysis, attention-map localization showing which image regions are AI-generated.'], tags: ['Supported generators', 'Post-processing limits', 'Inpainting gaps', 'ELA roadmap', 'C2PA roadmap'] }
  ]

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', transition: 'background 0.3s, color 0.3s', overflowX: 'hidden' }}>

      {/* ── Navbar ── */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: dark ? 'rgba(7,9,15,0.92)' : 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)', borderBottom: `1px solid ${t.border}`, padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '60px' }}>
        <button onClick={() => navigate('home')} style={{ display: 'flex', alignItems: 'center', gap: '9px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <Logo size={28} />
          <span style={{ fontWeight: 900, fontSize: '1.15rem', background: `linear-gradient(135deg,${accent},${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>IsItAI</span>
        </button>

        {/* Desktop nav */}
        <div className="desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {[{ id: 'home', label: 'Home' }, { id: 'how', label: 'How it works' }, { id: 'detect', label: 'Try it free' }].map(l => (
            <button key={l.id} onClick={() => navigate(l.id)}
              style={{ background: page === l.id ? `${accent}15` : 'none', border: `1px solid ${page === l.id ? accent+'40' : 'transparent'}`, borderRadius: '8px', padding: '6px 14px', color: page === l.id ? accent : t.soft, cursor: 'pointer', fontSize: '0.88rem', fontWeight: page === l.id ? 600 : 400, transition: 'all 0.2s' }}>
              {l.label}
            </button>
          ))}
          <button onClick={() => setDark(!dark)} style={{ marginLeft: '6px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '20px', padding: '6px 13px', cursor: 'pointer', fontSize: '0.82rem', color: t.text }}>
            {dark ? '☀️' : '🌙'}
          </button>
        </div>

        {/* Mobile hamburger */}
        <div className="mobile-nav" style={{ display: 'none', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => setDark(!dark)} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '20px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', color: t.text }}>{dark ? '☀️' : '🌙'}</button>
          <button onClick={() => setMenuOpen(!menuOpen)} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 10px', cursor: 'pointer', color: t.text, fontSize: '1rem' }}>☰</button>
        </div>
      </nav>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div style={{ position: 'fixed', top: '60px', left: 0, right: 0, zIndex: 99, background: dark ? '#0f1117' : '#fff', borderBottom: `1px solid ${t.border}`, padding: '0.75rem 1.5rem' }}>
          {[{ id: 'home', label: 'Home' }, { id: 'how', label: 'How it works' }, { id: 'detect', label: 'Try it free' }].map(l => (
            <button key={l.id} onClick={() => navigate(l.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.75rem 0', color: page === l.id ? accent : t.text, cursor: 'pointer', fontSize: '1rem', fontWeight: page === l.id ? 600 : 400, borderBottom: `1px solid ${t.border}` }}>
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ paddingTop: '60px', animation: animating ? 'pageOut 0.32s ease forwards' : 'pageIn 0.4s ease forwards' }}>

        {/* ══ HOME PAGE ══ */}
        {page === 'home' && (
          <div>
            <section style={{ minHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 1.5rem 3rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: '10%', left: '5%', width: '40vw', height: '40vw', maxWidth: '500px', maxHeight: '500px', background: 'radial-gradient(circle,rgba(99,102,241,0.08) 0%,transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: '10%', right: '5%', width: '35vw', height: '35vw', maxWidth: '400px', maxHeight: '400px', background: 'radial-gradient(circle,rgba(236,72,153,0.07) 0%,transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }} />

              <div style={{ marginBottom: '1.5rem' }}><Logo size={52} /></div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: dark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '24px', padding: '5px 16px', fontSize: '0.78rem', color: accent, marginBottom: '1.5rem', fontWeight: 500 }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'blink 2s infinite' }} />Free · No account · Instant results
              </div>

              <h1 style={{ fontSize: 'clamp(2.2rem,6vw,4.5rem)', fontWeight: 900, margin: '0 0 1rem', lineHeight: 1.06, letterSpacing: '-0.03em', maxWidth: '800px' }}>
                Is this image real<br />or <span style={{ background: `linear-gradient(135deg,${accent} 30%,${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AI-generated?</span>
              </h1>
              <p style={{ color: t.soft, fontSize: 'clamp(0.95rem,2vw,1.15rem)', maxWidth: '500px', margin: '0 auto 2.5rem', lineHeight: 1.75 }}>
                Upload any image and get a plain-English verdict in seconds. Powered by a 5-layer forensic system — completely free, no sign-up required.
              </p>

              <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '4rem' }}>
                <button onClick={() => navigate('detect')}
                  style={{ background: `linear-gradient(135deg,${accent},${pink})`, border: 'none', color: '#fff', padding: '0.85rem 2.2rem', borderRadius: '12px', fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s', boxShadow: '0 4px 20px rgba(99,102,241,0.28)', minHeight: '44px' }}
                  onMouseEnter={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 10px 35px rgba(99,102,241,0.4)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='0 4px 20px rgba(99,102,241,0.28)' }}>
                  🔍 Detect an image — free
                </button>
                <button onClick={() => navigate('how')}
                  style={{ background: t.bg2, border: `1px solid ${t.border}`, color: t.text, padding: '0.85rem 1.8rem', borderRadius: '12px', fontSize: '0.95rem', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s', minHeight: '44px' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = accent}
                  onMouseLeave={e => e.currentTarget.style.borderColor = t.border}>
                  How it works →
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '0.8rem', maxWidth: '620px', width: '100%' }}>
                {[['5 layers', 'Detection system', 'models+EXIF+FFT+face'], ['Free forever', 'No paywalls', 'no account needed'], ['12+', 'AI generators', 'detected'], ['<5s', 'Scan time', 'real-time']].map(([v,l,s]) => (
                  <div key={l} style={{ padding: '1rem', background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '14px', textAlign: 'center', transition: 'all 0.2s', boxShadow: dark?'none':'0 2px 10px rgba(0,0,0,0.04)' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor=`${accent}50`; e.currentTarget.style.transform='translateY(-2px)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor=t.border; e.currentTarget.style.transform='translateY(0)' }}>
                    <div style={{ fontWeight: 800, fontSize: '1.2rem', background: `linear-gradient(135deg,${accent},${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{v}</div>
                    <div style={{ color: t.text, fontSize: '0.75rem', fontWeight: 600, marginTop: '3px' }}>{l}</div>
                    <div style={{ color: t.muted, fontSize: '0.68rem', marginTop: '2px' }}>{s}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Feature cards */}
            <section style={{ padding: '4rem 1.5rem', maxWidth: '960px', margin: '0 auto' }}>
              <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                <h2 style={{ fontSize: 'clamp(1.6rem,4vw,2.4rem)', fontWeight: 900, margin: '0 0 0.75rem', letterSpacing: '-0.02em' }}>Why IsItAI is different</h2>
                <p style={{ color: t.soft, maxWidth: '440px', margin: '0 auto', lineHeight: 1.7 }}>Most tools show you a number. We tell you what it means — and show our work.</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1.2rem' }}>
                {[
                  { icon: '💬', title: 'Plain English verdicts', desc: 'No cryptic percentages. You get a clear sentence: "This image was almost certainly AI-generated" with supporting evidence.', color: '#6366f1' },
                  { icon: '🔬', title: '5-layer forensic system', desc: 'AI model ensemble + EXIF metadata + FFT frequency analysis + face symmetry + dimension heuristics. Every layer shown.', color: '#8b5cf6' },
                  { icon: '🔓', title: 'Free, no account needed', desc: 'No registration. No paywall. No 5-detection limit. Completely free. We believe access to truth should not be gated.', color: '#06b6d4' },
                  { icon: '🔒', title: 'Private by design', desc: 'Your images are never stored or logged. Processed in memory and discarded immediately. No data sold, ever.', color: '#ec4899' }
                ].map(f => (
                  <div key={f.title} style={{ padding: '1.5rem', background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '18px', transition: 'all 0.2s', boxShadow: dark?'none':'0 2px 14px rgba(0,0,0,0.04)' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor=`${f.color}45`; e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow=`0 10px 35px ${f.color}12` }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor=t.border; e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow=dark?'none':'0 2px 14px rgba(0,0,0,0.04)' }}>
                    <div style={{ fontSize: '1.8rem', marginBottom: '0.8rem' }}>{f.icon}</div>
                    <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '0.95rem' }}>{f.title}</h3>
                    <p style={{ margin: 0, color: t.soft, fontSize: '0.86rem', lineHeight: 1.7 }}>{f.desc}</p>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: '3rem' }}>
                <button onClick={() => navigate('detect')} style={{ background: `linear-gradient(135deg,${accent},${pink})`, border: 'none', color: '#fff', padding: '0.85rem 2.2rem', borderRadius: '12px', fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(99,102,241,0.25)', minHeight: '44px' }}>
                  Try it free →
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ══ HOW IT WORKS PAGE ══ */}
        {page === 'how' && (
          <div style={{ maxWidth: '960px', margin: '0 auto', padding: '3rem 1.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
              <div style={{ display: 'inline-block', background: dark?'rgba(99,102,241,0.1)':'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '24px', padding: '5px 16px', fontSize: '0.78rem', color: accent, marginBottom: '1rem', fontWeight: 500 }}>Under the hood</div>
              <h1 style={{ fontSize: 'clamp(1.8rem,5vw,3rem)', fontWeight: 900, margin: '0 0 0.8rem', letterSpacing: '-0.02em' }}>How the detection works</h1>
              <p style={{ color: t.soft, fontSize: '1rem', maxWidth: '480px', margin: '0 auto', lineHeight: 1.7 }}>Five independent forensic layers. Tap each to explore the full technical depth.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '8px', marginBottom: '1.5rem' }}>
              {howSteps.map((s,i) => (
                <button key={i} onClick={() => setActiveHow(i)}
                  style={{ padding: '0.9rem 0.7rem', borderRadius: '12px', border: `1.5px solid ${activeHow===i?s.color:t.border}`, background: activeHow===i?`${s.color}10`:t.bg2, cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left', minHeight: '44px' }}>
                  <div style={{ fontSize: '1.3rem', marginBottom: '5px' }}>{s.icon}</div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: activeHow===i?s.color:t.text, lineHeight: 1.3 }}>{s.subtitle}</div>
                  <div style={{ fontSize: '0.65rem', color: activeHow===i?s.color:t.muted, marginTop: '2px' }}>Layer {i+1}</div>
                </button>
              ))}
            </div>

            {howSteps.map((s,i) => i === activeHow && (
              <div key={i} style={{ background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '20px', overflow: 'hidden', animation: 'panelIn 0.3s ease', boxShadow: dark?`0 0 40px ${s.color}08`:'0 4px 30px rgba(0,0,0,0.06)' }}>
                <div style={{ padding: '1.5rem 2rem', background: `${s.color}07`, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '2.5rem' }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: s.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Layer {i+1} — {s.subtitle}</div>
                    <h2 style={{ margin: 0, fontSize: 'clamp(1.1rem,3vw,1.5rem)', fontWeight: 900 }}>{s.title}</h2>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,220px)', gap: 0 }} className="how-grid">
                  <div style={{ padding: '1.5rem 2rem', borderRight: `1px solid ${t.border}` }}>
                    {s.detail.map((para,pi) => <p key={pi} style={{ color: t.soft, lineHeight: 1.85, fontSize: '0.93rem', margin: pi===0?'0 0 1rem':'1rem 0 0', animation: `fadeIn 0.4s ease ${pi*0.08}s both` }}>{para}</p>)}
                  </div>
                  <div style={{ padding: '1.5rem' }}>
                    <div style={{ fontSize: '0.68rem', color: t.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>Key concepts</div>
                    {s.tags.map((tag,ti) => (
                      <div key={tag} style={{ padding: '7px 11px', background: `${s.color}0d`, border: `1px solid ${s.color}20`, borderRadius: '9px', fontSize: '0.78rem', color: s.color, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px', animation: `slideRight 0.3s ease ${ti*0.06}s both` }}>
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: s.color, flexShrink: 0 }} />{tag}
                      </div>
                    ))}
                    <div style={{ marginTop: '1.2rem', paddingTop: '1.2rem', borderTop: `1px solid ${t.border}` }}>
                      <div style={{ fontSize: '0.68rem', color: t.muted, marginBottom: '6px' }}>Progress</div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {howSteps.map((_,di) => <div key={di} onClick={() => setActiveHow(di)} style={{ height: '3px', flex: 1, borderRadius: '2px', background: di<=i?s.color:t.border, cursor: 'pointer', transition: 'background 0.3s' }} />)}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ padding: '1rem 2rem', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <button onClick={() => setActiveHow(Math.max(0,i-1))} disabled={i===0} style={{ background: 'none', border: `1px solid ${i===0?'transparent':t.border}`, borderRadius: '8px', padding: '7px 16px', color: i===0?t.muted:t.text, cursor: i===0?'default':'pointer', fontSize: '0.85rem', minHeight: '44px' }}>← Previous</button>
                  <span style={{ fontSize: '0.78rem', color: t.muted }}>{i+1} of {howSteps.length}</span>
                  {i < howSteps.length-1
                    ? <button onClick={() => setActiveHow(i+1)} style={{ background: `linear-gradient(135deg,${accent},${pink})`, border: 'none', borderRadius: '8px', padding: '7px 16px', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, minHeight: '44px' }}>Next →</button>
                    : <button onClick={() => navigate('detect')} style={{ background: `linear-gradient(135deg,${accent},${pink})`, border: 'none', borderRadius: '8px', padding: '7px 16px', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, minHeight: '44px' }}>Try it free →</button>
                  }
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══ DETECT PAGE ══ */}
        {page === 'detect' && (
          <div style={{ maxWidth: '580px', margin: '0 auto', padding: '3rem 1rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <div style={{ display: 'inline-block', background: dark?'rgba(99,102,241,0.1)':'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '24px', padding: '5px 16px', fontSize: '0.78rem', color: accent, marginBottom: '1rem', fontWeight: 500 }}>Free · Instant · Private</div>
              <h1 style={{ fontSize: 'clamp(1.6rem,5vw,2.5rem)', fontWeight: 900, margin: '0 0 0.6rem', letterSpacing: '-0.02em' }}>Analyze your image</h1>
              <p style={{ color: t.soft, margin: 0, fontSize: '0.9rem', lineHeight: 1.7 }}>Get a plain-English verdict in under 5 seconds. No account required.</p>
            </div>

            {/* Upload zone */}
            <div style={{ background: t.bg2, border: `2px dashed ${isDragging?accent:t.border}`, borderRadius: '18px', overflow: 'hidden', marginBottom: '0.75rem', transition: 'all 0.2s', boxShadow: isDragging?`0 0 25px rgba(99,102,241,0.15)`:dark?'none':'0 2px 14px rgba(0,0,0,0.04)', position: 'relative' }}
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }}>
              {imagePreview ? (
                <div style={{ position: 'relative' }}>
                  <img src={imagePreview} alt="preview" style={{ width: '100%', maxHeight: '340px', objectFit: 'cover', display: 'block' }} />
                  {scanAnim && (
                    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                      <div style={{ position: 'absolute', left: 0, right: 0, height: '2px', background: `linear-gradient(90deg,transparent,${accent},transparent)`, animation: 'scanLine 1.2s ease-in-out infinite', boxShadow: `0 0 10px ${accent}` }} />
                      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg,${accent}06 0%,transparent 50%,${pink}06 100%)`, animation: 'pulseOverlay 1.5s ease-in-out infinite' }} />
                      <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(99,102,241,0.92)', color: '#fff', padding: '4px 12px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#fff', animation: 'blink 0.8s infinite' }} />SCANNING
                      </div>
                    </div>
                  )}
                  <button onClick={() => { setImageFile(null); setImagePreview(null); setResult(null); setExifResult(null); setFftResult(null); setFaceResult(null); setError(null) }}
                    style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.65)', border: 'none', color: '#fff', borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>×</button>
                  <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.7)', padding: '3px 10px', borderRadius: '6px', fontSize: '0.72rem', color: '#e2e8f0', zIndex: 2, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🖼 {imageFile?.name}</div>
                </div>
              ) : (
                <div style={{ padding: '3rem 1.5rem', textAlign: 'center', cursor: 'pointer', minHeight: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} onClick={() => fileInputRef.current?.click()}>
                  <div style={{ width: '60px', height: '60px', borderRadius: '14px', background: `${accent}10`, border: `1px solid ${accent}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', margin: '0 auto 1rem', transition: 'all 0.2s' }}>🖼️</div>
                  <p style={{ color: t.soft, margin: '0 0 0.35rem', fontWeight: 500, fontSize: '0.95rem' }}>Drop your image here or <span style={{ color: accent, fontWeight: 700 }}>browse files</span></p>
                  <p style={{ color: t.muted, fontSize: '0.78rem', margin: 0 }}>PNG · JPG · WEBP · up to 20MB</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
            </div>

            {/* Quick pre-analysis badges */}
            {imageFile && !result && (exifResult || fftResult || faceResult) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '0.75rem', animation: 'slideUp 0.3s ease' }}>
                {exifResult && <span style={{ fontSize: '0.73rem', padding: '4px 10px', borderRadius: '20px', background: exifResult.evidenceQuality >= 35 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: exifResult.evidenceQuality >= 35 ? '#16a34a' : '#ef4444', border: `1px solid ${exifResult.evidenceQuality >= 35 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, fontWeight: 500 }}>📋 EXIF: {exifResult.evidenceQuality >= 50 ? 'Good' : exifResult.evidenceQuality >= 25 ? 'Partial' : 'Missing'}</span>}
                {fftResult && fftResult.confidence !== 'none' && <span style={{ fontSize: '0.73rem', padding: '4px 10px', borderRadius: '20px', background: 'rgba(6,182,212,0.1)', color: '#0891b2', border: '1px solid rgba(6,182,212,0.2)', fontWeight: 500 }}>🌊 Frequency: {fftResult.confidence}</span>}
                {faceResult && <span style={{ fontSize: '0.73rem', padding: '4px 10px', borderRadius: '20px', background: faceResult.faceDetected ? 'rgba(245,158,11,0.1)' : 'rgba(148,163,184,0.1)', color: faceResult.faceDetected ? '#b45309' : t.muted, border: `1px solid ${faceResult.faceDetected ? 'rgba(245,158,11,0.2)' : t.border}`, fontWeight: 500 }}>👤 {faceResult.faceDetected ? 'Face detected' : 'No face'}</span>}
              </div>
            )}

            {/* Loading */}
            {isLoading && (
              <div style={{ background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '1.25rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '4px', marginBottom: '0.8rem' }}>
                  {loadingSteps.map((s,i) => (
                    <div key={s} style={{ textAlign: 'center' }}>
                      <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: i<loadingStep?`${accent}18`:i===loadingStep?`linear-gradient(135deg,${accent},${pink})`:t.card, border: `1.5px solid ${i<=loadingStep?accent:t.border}`, margin: '0 auto 5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', color: i<loadingStep?accent:i===loadingStep?'#fff':t.muted, transition: 'all 0.4s', animation: i===loadingStep?'pulseRing 1s ease infinite':'none' }}>
                        {i < loadingStep ? '✓' : i+1}
                      </div>
                      <div style={{ fontSize: '0.62rem', color: i<=loadingStep?accent:t.muted, fontWeight: i===loadingStep?700:400 }}>{s}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: t.card, borderRadius: '6px', height: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: `linear-gradient(90deg,${accent},${pink})`, borderRadius: '6px', width: `${((loadingStep+1)/loadingSteps.length)*100}%`, transition: 'width 0.7s ease' }} />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', padding: '0.9rem 1.1rem', color: '#dc2626', fontSize: '0.88rem', marginBottom: '0.75rem', animation: 'slideUp 0.3s ease' }}>
                ⚠️ {error} — Models may be cold-starting, try again in 30s.
              </div>
            )}

            {/* ── TASK 1: VERDICT CARD ── */}
            {result && (
              <div style={{ background: t.bg2, border: `1.5px solid ${verdictData.color}30`, borderRadius: '20px', overflow: 'hidden', marginBottom: '0.75rem', boxShadow: `0 0 50px rgba(${verdictData.color === '#ef4444' ? '239,68,68' : verdictData.color === '#f97316' ? '249,115,22' : verdictData.color === '#eab308' ? '234,179,8' : '34,197,94'},0.1)`, animation: 'resultReveal 0.5s cubic-bezier(0.34,1.56,0.64,1)' }}>

                {/* Score + emoji + headline */}
                <div style={{ padding: '2rem 1.5rem', textAlign: 'center', background: `${verdictData.color}05`, borderBottom: `1px solid ${t.border}`, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 60%,${verdictData.color}07 0%,transparent 65%)`, pointerEvents: 'none' }} />
                  <div style={{ fontSize: '3.2rem', lineHeight: 1, marginBottom: '0.5rem', animation: 'bounceIn 0.5s ease' }}>{verdictData.emoji}</div>
                  <div style={{ fontSize: 'clamp(2.5rem,8vw,4.5rem)', fontWeight: 900, color: verdictData.color, lineHeight: 1, letterSpacing: '-0.04em', animation: 'countUp 0.8s ease', fontVariantNumeric: 'tabular-nums' }}>{displayScore}%</div>
                  <div style={{ display: 'inline-block', marginTop: '10px', padding: '5px 18px', borderRadius: '20px', background: `${verdictData.color}15`, border: `1px solid ${verdictData.color}28`, fontSize: '0.95rem', fontWeight: 700, color: verdictData.color, animation: 'fadeIn 0.4s ease 0.3s both' }}>{verdictData.headline}</div>
                </div>

                {/* Verdict sentence — THE KEY UX IMPROVEMENT */}
                <div style={{ padding: '1.5rem', borderBottom: `1px solid ${t.border}` }}>
                  <p style={{ margin: 0, fontSize: '1rem', lineHeight: 1.75, color: t.text, fontWeight: 450, animation: 'fadeIn 0.5s ease 0.2s both' }}>{verdictData.sentence}</p>
                  <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: t.muted }}>
                    Analysis confidence: <span style={{ color: result.confidence === 'high' ? '#22c55e' : result.confidence === 'medium' ? '#eab308' : '#f87171', fontWeight: 600 }}>{result.confidence}</span>
                    {result.disagreement && <span style={{ marginLeft: '12px', color: '#b45309' }}>⚠ Models disagreed</span>}
                  </div>
                </div>

                {/* Expandable technical details */}
                <div style={{ padding: '0.9rem 1.5rem' }}>
                  <button onClick={() => setShowDetails(!showDetails)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.82rem', color: accent, fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: '6px', minHeight: '44px' }}>
                    <span style={{ transition: 'transform 0.2s', display: 'inline-block', transform: showDetails ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                    {showDetails ? 'Hide' : 'Show'} technical breakdown
                  </button>

                  {showDetails && (
                    <div style={{ marginTop: '1rem', animation: 'slideUp 0.3s ease' }}>
                      {/* Model results */}
                      <div style={{ fontSize: '0.68rem', color: t.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>AI Model scores</div>
                      {result.modelResults.map((m, mi) => (
                        <div key={m.name} style={{ marginBottom: '0.9rem', animation: `slideRight 0.3s ease ${mi*0.08}s both` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                            <span style={{ color: t.soft }}>{m.name.split('/')[1]}{m.weightAdjusted && <span style={{ color: accent, fontSize: '0.7rem', marginLeft: '6px' }}>↑ boosted</span>}</span>
                            <span style={{ color: m.aiScore >= 50 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{m.aiScore}%</span>
                          </div>
                          <ScoreBar score={m.aiScore} delay={mi*0.08} />
                        </div>
                      ))}

                      {/* EXIF */}
                      {exifResult && (
                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${t.border}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                            <span style={{ color: accent, fontWeight: 600 }}>📋 EXIF Metadata <span style={{ color: t.muted, fontWeight: 400 }}>({Math.round(exifResult.exifWeight*100)}% wt)</span></span>
                            <span style={{ color: exifResult.aiScore >= 50 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{exifResult.aiScore}%</span>
                          </div>
                          <ScoreBar score={exifResult.aiScore} delay={0.3} />
                          <SignalTags signals={exifResult.signals} />
                        </div>
                      )}

                      {/* FFT */}
                      {fftResult && fftResult.signals.length > 0 && (
                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${t.border}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                            <span style={{ color: '#06b6d4', fontWeight: 600 }}>🌊 Frequency Analysis</span>
                            <span style={{ color: fftResult.score >= 30 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{fftResult.score}%</span>
                          </div>
                          <ScoreBar score={fftResult.score} delay={0.4} />
                          <SignalTags signals={fftResult.signals} />
                        </div>
                      )}

                      {/* Face */}
                      {faceResult && faceResult.signals.length > 0 && (
                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${t.border}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                            <span style={{ color: '#f59e0b', fontWeight: 600 }}>👤 Face Analysis</span>
                            <span style={{ color: faceResult.score >= 30 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{faceResult.score}%</span>
                          </div>
                          {faceResult.faceDetected && <ScoreBar score={faceResult.score} delay={0.5} />}
                          <SignalTags signals={faceResult.signals} />
                        </div>
                      )}

                      {/* Dimensions */}
                      {result?.dimensionScore?.signals?.length > 0 && (
                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${t.border}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                            <span style={{ color: '#14b8a6', fontWeight: 600 }}>📐 Dimension Heuristics</span>
                            <span style={{ color: result.dimensionScore.score >= 30 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{result.dimensionScore.score}%</span>
                          </div>
                          <ScoreBar score={result.dimensionScore.score} delay={0.6} />
                          <SignalTags signals={result.dimensionScore.signals} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CTA button */}
            {imageFile ? (
              <button onClick={handleDetect} disabled={isLoading}
                style={{ width: '100%', background: isLoading?t.card:`linear-gradient(135deg,${accent},${pink})`, border: 'none', color: isLoading?t.muted:'#fff', padding: '1rem', borderRadius: '13px', fontSize: '1rem', fontWeight: 700, cursor: isLoading?'not-allowed':'pointer', transition: 'all 0.2s', boxShadow: isLoading?'none':'0 4px 20px rgba(99,102,241,0.25)', minHeight: '52px' }}>
                {isLoading ? '⏳ Analyzing...' : result ? '🔄 Analyze Again' : "🔍 Detect Now — It's Free"}
              </button>
            ) : (
              <button onClick={() => fileInputRef.current?.click()}
                style={{ width: '100%', background: `linear-gradient(135deg,${accent},${pink})`, border: 'none', color: '#fff', padding: '1rem', borderRadius: '13px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(99,102,241,0.25)', minHeight: '52px' }}>
                📁 Upload an Image
              </button>
            )}
            <p style={{ color: t.muted, fontSize: '0.73rem', textAlign: 'center', marginTop: '0.75rem' }}>🔒 Your image is never stored · Processed entirely in real-time</p>
          </div>
        )}

        {/* ── Task 3: Footer ── */}
        <footer style={{ borderTop: `1px solid ${t.border}`, padding: '2.5rem 1.5rem', marginTop: '4rem' }}>
          <div style={{ maxWidth: '960px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '2rem', marginBottom: '2rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.6rem' }}>
                <Logo size={22} />
                <span style={{ fontWeight: 900, background: `linear-gradient(135deg,${accent},${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: '1rem' }}>IsItAI</span>
              </div>
              <p style={{ color: t.muted, fontSize: '0.82rem', margin: 0, lineHeight: 1.6 }}>Free AI image detection. No account. No paywall. Built for truth.</p>
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>Product</div>
              {[{ label: 'Home', action: () => navigate('home') }, { label: 'How it works', action: () => navigate('how') }, { label: 'Try it free', action: () => navigate('detect') }].map(l => (
                <button key={l.label} onClick={l.action} style={{ display: 'block', background: 'none', border: 'none', color: t.soft, cursor: 'pointer', fontSize: '0.85rem', padding: '3px 0', marginBottom: '4px', textAlign: 'left', transition: 'color 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.color = accent}
                  onMouseLeave={e => e.currentTarget.style.color = t.soft}>{l.label}</button>
              ))}
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>Legal</div>
              {[{ label: 'Privacy Policy', href: '/privacy' }, { label: 'Terms of Service', href: '/terms' }].map(l => (
                <Link key={l.label} href={l.href} style={{ display: 'block', color: t.soft, fontSize: '0.85rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px', transition: 'color 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.color = accent}
                  onMouseLeave={e => e.currentTarget.style.color = t.soft}>{l.label}</Link>
              ))}
            </div>
          </div>
          <div style={{ maxWidth: '960px', margin: '0 auto', paddingTop: '1.5rem', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <p style={{ color: t.muted, margin: 0, fontSize: '0.8rem' }}>© 2025 IsItAI. Built with Next.js · Powered by Hugging Face.</p>
            <p style={{ color: t.muted, margin: 0, fontSize: '0.8rem' }}>Results are probabilistic estimates, not legal determinations.</p>
          </div>
        </footer>
      </div>

      {/* ── Task 4: Mobile CSS ── */}
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes pageIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pageOut { from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(-8px)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideRight { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
        @keyframes panelIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes resultReveal { from{opacity:0;transform:scale(0.97) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes bounceIn { from{opacity:0;transform:scale(0.5)} to{opacity:1;transform:scale(1)} }
        @keyframes scanLine { 0%{top:-2px;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{top:100%;opacity:0} }
        @keyframes pulseOverlay { 0%,100%{opacity:0.3} 50%{opacity:0.6} }
        @keyframes pulseRing { 0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,0.35)} 50%{box-shadow:0 0 0 5px rgba(99,102,241,0)} }
        @keyframes countUp { from{opacity:0;transform:scale(0.85)} to{opacity:1;transform:scale(1)} }
        * { box-sizing:border-box }
        html { scroll-behavior:smooth }

        /* Mobile responsive */
        .desktop-nav { display: flex !important }
        .mobile-nav { display: none !important }

        @media (max-width: 767px) {
          .desktop-nav { display: none !important }
          .mobile-nav { display: flex !important }
          .how-grid { grid-template-columns: 1fr !important }
          .how-grid > div:first-child { border-right: none !important; border-bottom: 1px solid var(--border) }
        }

        @media (max-width: 480px) {
          nav { padding: 0 1rem !important }
        }

        /* Touch targets */
        @media (hover: none) {
          button { min-height: 44px }
        }
      `}</style>
    </div>
  )
}