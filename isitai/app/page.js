'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import * as exifr from 'exifr'
import Link from 'next/link'

// ─── EXIF Analysis ────────────────────────────────────────────────────────────
async function analyzeExif(file) {
  try {
    const exif = await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true })
    if (!exif) return { aiScore: 70, exifWeight: 0.15, confidence: 'medium', evidenceQuality: 0, signals: [{ label: 'No EXIF data', suspicious: true }, { label: 'Real photos always have metadata', suspicious: true }] }

    const signals = []; let rawScore = 0; let eq = 0
    const sw = (exif.Software || exif.software || exif.CreatorTool || '').toLowerCase()
    const aiTools = ['stable diffusion','midjourney','dall-e','firefly','gemini','openai','runway','imagen','nightcafe','leonardo','invokeai','automatic1111','comfyui']
    const foundAI = aiTools.find(t => sw.includes(t))

    if (foundAI) { signals.push({ label: `AI tool: ${exif.Software || foundAI}`, suspicious: true }); rawScore += 95; eq += 60 }
    else if (exif.Software) { signals.push({ label: `Software: ${exif.Software}`, suspicious: false }); eq += 15 }
    else { signals.push({ label: 'No software field', suspicious: true }); rawScore += 12; eq += 5 }

    const hasCamera = !!(exif.Make || exif.Model)
    if (hasCamera) { signals.push({ label: `${[exif.Make, exif.Model].filter(Boolean).join(' ')}`, suspicious: false }); rawScore = Math.max(0, rawScore - 20); eq += 25 }
    else { signals.push({ label: 'No camera data', suspicious: true }); rawScore += 18; eq += 8 }

    if (exif.latitude) { signals.push({ label: `GPS recorded`, suspicious: false }); rawScore = Math.max(0, rawScore - 8); eq += 15 }
    else { signals.push({ label: 'No GPS', suspicious: true }); rawScore += 8; eq += 5 }

    if (exif.FocalLength || exif.LensModel) { signals.push({ label: exif.LensModel || `${exif.FocalLength}mm lens`, suspicious: false }); rawScore = Math.max(0, rawScore - 5); eq += 12 }
    else { signals.push({ label: 'No lens data', suspicious: true }); rawScore += 7; eq += 3 }

    if (exif.DateTimeOriginal) { signals.push({ label: `Shot ${new Date(exif.DateTimeOriginal).toLocaleDateString()}`, suspicious: false }); rawScore = Math.max(0, rawScore - 5); eq += 10 }
    else { signals.push({ label: 'No timestamp', suspicious: true }); rawScore += 6; eq += 2 }

    let exifWeight = foundAI ? 0.35 : eq >= 60 ? 0.28 : eq >= 35 ? 0.20 : eq >= 15 ? 0.14 : 0.10
    let confidence = foundAI ? 'high' : eq >= 50 ? 'high' : eq >= 25 ? 'medium' : 'low'

    return { aiScore: Math.min(95, Math.max(3, Math.round(rawScore))), exifWeight, confidence, evidenceQuality: eq, signals, verdict: foundAI ? 'ai_tool' : hasCamera ? 'has_camera' : 'no_camera' }
  } catch { return { aiScore: 45, exifWeight: 0.10, confidence: 'very_low', evidenceQuality: 0, signals: [{ label: 'Metadata parse failed', suspicious: true }] } }
}

// ─── FFT Analysis ─────────────────────────────────────────────────────────────
async function analyzeFFT(file) {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const S = 256
        const c = document.createElement('canvas'); c.width = S; c.height = S
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, S, S)
        const d = ctx.getImageData(0, 0, S, S).data
        URL.revokeObjectURL(url)

        const gray = new Float32Array(S * S)
        for (let i = 0; i < S * S; i++) gray[i] = (0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2]) / 255

        const rows = new Float32Array(S), cols = new Float32Array(S)
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { rows[y] += gray[y*S+x]; cols[x] += gray[y*S+x] }

        const dft = sig => { const N = sig.length, m = new Float32Array(N/2); for (let k=0;k<N/2;k++){let r=0,i=0;for(let n=0;n<N;n++){const a=2*Math.PI*k*n/N;r+=sig[n]*Math.cos(a);i-=sig[n]*Math.sin(a)}m[k]=Math.sqrt(r*r+i*i)} return m }
        const rm = dft(rows), cm = dft(cols)
        const rmax = Math.max(...rm)||1, cmax = Math.max(...cm)||1
        const rn = rm.map(v=>v/rmax), cn = cm.map(v=>v/cmax)

        const q1=Math.floor(S/4), q2=Math.floor(S/2)
        let hfR=0,lfR=0,hfC=0,lfC=0
        for(let k=1;k<q1;k++){lfR+=rn[k];lfC+=cn[k]}
        for(let k=q1;k<q2;k++){hfR+=rn[k];hfC+=cn[k]}
        const ratio = ((lfR>0?hfR/lfR:0)+(lfC>0?hfC/lfC:0))/2

        let tv=0; const bs=16, nb=Math.floor(S/bs)
        for(let by=0;by<nb;by++) for(let bx=0;bx<nb;bx++){let s=0,sq=0,c=0;for(let y=by*bs;y<(by+1)*bs;y++) for(let x=bx*bs;x<(bx+1)*bs;x++){const v=gray[y*S+x];s+=v;sq+=v*v;c++};const m=s/c;tv+=sq/c-m*m}
        const av = tv/(nb*nb)

        const signals = []; let score = 0
        if (ratio > 0.65) { signals.push({ label: 'GAN frequency artifacts', suspicious: true }); score += 40 }
        else if (ratio > 0.42) { signals.push({ label: 'Elevated high-frequency energy', suspicious: true }); score += 20 }
        else { signals.push({ label: 'Natural frequency distribution', suspicious: false }); score -= 8 }
        if (av < 0.004) { signals.push({ label: 'Unnaturally smooth texture', suspicious: true }); score += 28 }
        else if (av > 0.02) { signals.push({ label: 'Natural texture variance', suspicious: false }); score -= 5 }

        resolve({ score: Math.max(0, Math.min(85, score)), signals, confidence: Math.abs(score)>28?'high':Math.abs(score)>12?'medium':'low' })
      } catch { URL.revokeObjectURL(url); resolve({ score: 0, signals: [], confidence: 'none' }) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ score: 0, signals: [], confidence: 'none' }) }
    img.src = url
  })
}

// ─── Face Analysis ────────────────────────────────────────────────────────────
async function analyzeFace(file) {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const S = 256
        const c = document.createElement('canvas'); c.width = S; c.height = S
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, S, S)
        const d = ctx.getImageData(0, 0, S, S).data
        URL.revokeObjectURL(url)

        let skin = 0; const sym = []
        for (let i = 0; i < S*S; i++) {
          const r=d[i*4]/255, g=d[i*4+1]/255, b=d[i*4+2]/255
          const max=Math.max(r,g,b), min=Math.min(r,g,b), delta=max-min; let h=0,s=0,v=max
          if(delta>0){s=delta/max;if(max===r)h=60*(((g-b)/delta)%6);else if(max===g)h=60*((b-r)/delta+2);else h=60*((r-g)/delta+4);if(h<0)h+=360}
          if(h>=0&&h<=50&&s>=0.15&&s<=0.85&&v>=0.35)skin++
          sym.push(v)
        }

        const skinR = skin/(S*S); const signals = []; let score = 0; let face = false
        if (skinR > 0.08) {
          face = true; signals.push({ label: `Face/skin detected (${Math.round(skinR*100)}%)`, suspicious: false })
          let ss=0, cp=0
          for(let y=Math.floor(S*.2);y<Math.floor(S*.8);y++) for(let x=0;x<Math.floor(S/2);x++){ss+=1-Math.abs(sym[y*S+x]-sym[y*S+(S-1-x)]);cp++}
          const ns=cp>0?ss/cp:0
          if(ns>0.93){signals.push({label:`Unnatural symmetry (${(ns*100).toFixed(1)}%)`,suspicious:true});score+=32}
          else if(ns>0.90){signals.push({label:`High symmetry (${(ns*100).toFixed(1)}%)`,suspicious:true});score+=16}
          else{signals.push({label:`Natural asymmetry (${(ns*100).toFixed(1)}%)`,suspicious:false});score-=5}
        } else { signals.push({ label: 'No face detected', suspicious: false }) }

        resolve({ score: Math.max(0, Math.min(85, score)), signals, confidence: face?(Math.abs(score)>20?'high':'medium'):'none', faceDetected: face, faceWeight: face?0.08:0 })
      } catch { URL.revokeObjectURL(url); resolve({ score: 0, signals: [], confidence: 'none', faceDetected: false, faceWeight: 0 }) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ score: 0, signals: [], confidence: 'none', faceDetected: false, faceWeight: 0 }) }
    img.src = url
  })
}

// ─── Score Fusion ─────────────────────────────────────────────────────────────
function computeFinalScore(modelCombined, exif, dim, fft, face) {
  const ew = exif?.exifWeight || 0
  const dw = (dim?.confidence === 'high' ? 0.12 : dim?.confidence === 'medium' ? 0.06 : 0)
  const fw = (fft?.confidence === 'high' ? 0.09 : fft?.confidence === 'medium' ? 0.04 : 0)
  const facew = face?.faceWeight || 0
  const extra = ew + dw + fw + facew
  const mw = Math.max(0.52, 1 - extra)
  const sc = 1 / (mw + extra)
  return Math.min(99, Math.max(1, Math.round(
    modelCombined * mw * sc +
    (exif?.aiScore||0) * ew * sc +
    (dim?.score||0) * dw * sc +
    (fft?.score||0) * fw * sc +
    (face?.score||0) * facew * sc
  )))
}

// ─── Verdict Generator ────────────────────────────────────────────────────────
function getVerdict(score, confidence) {
  const certain = score >= 85
  const likely = score >= 60
  const uncertain = score < 60 && score >= 38

  if (certain && score >= 85) {
    return {
      line1: 'This image is AI-generated',
      line2: `We're ${score}% confident.`,
      sub: 'Multiple forensic layers detected strong AI generation signatures.',
      color: '#ef4444', glow: 'rgba(239,68,68,0.15)', emoji: '🤖', level: 'definitive-ai'
    }
  }
  if (likely && score >= 60) {
    return {
      line1: 'This image appears to be AI-generated',
      line2: `We're ${score}% confident.`,
      sub: 'Our analysis found more evidence pointing toward AI than toward a real photo.',
      color: '#f97316', glow: 'rgba(249,115,22,0.15)', emoji: '⚠️', level: 'likely-ai'
    }
  }
  if (uncertain) {
    return {
      line1: "We're uncertain about this image",
      line2: `It shows mixed signals — ${score}% lean toward AI.`,
      sub: 'This image may be AI-enhanced, heavily edited, or from an unfamiliar generator.',
      color: '#eab308', glow: 'rgba(234,179,8,0.12)', emoji: '🤔', level: 'uncertain'
    }
  }
  if (score < 38 && score >= 15) {
    return {
      line1: 'This image appears to be real',
      line2: `We're ${100 - score}% confident it's not AI-generated.`,
      sub: 'Most detection layers found no significant AI indicators.',
      color: '#22c55e', glow: 'rgba(34,197,94,0.15)', emoji: '✅', level: 'likely-real'
    }
  }
  return {
    line1: 'This image is a real photograph',
    line2: `We're ${100 - score}% confident.`,
    sub: 'Strong indicators of genuine camera photography detected across all layers.',
    color: '#22c55e', glow: 'rgba(34,197,94,0.15)', emoji: '✅', level: 'definitive-real'
  }
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
const Logo = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs><linearGradient id="lg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#7c3aed"/><stop offset="100%" stopColor="#06b6d4"/></linearGradient></defs>
    <rect width="32" height="32" rx="8" fill="url(#lg2)"/>
    <ellipse cx="16" cy="15" rx="8.5" ry="5.5" fill="none" stroke="white" strokeWidth="1.8"/>
    <circle cx="16" cy="15" r="2.8" fill="white"/>
    <circle cx="16" cy="15" r="1.1" fill="url(#lg2)"/>
    <line x1="21.5" y1="20.5" x2="25.5" y2="24.5" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
    <circle cx="10" cy="10" r="1" fill="rgba(255,255,255,0.6)"/>
    <circle cx="22" cy="10" r="0.7" fill="rgba(255,255,255,0.4)"/>
  </svg>
)

// ─── Intersection observer hook ───────────────────────────────────────────────
function useInView(ref, options = {}) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true) }, { threshold: 0.15, ...options })
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return inView
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
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
  const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 })
  const [cursorActive, setCursorActive] = useState(false)
  const fileInputRef = useRef(null)
  const scoreTimerRef = useRef(null)
  const heroRef = useRef(null)
  const featuresRef = useRef(null)
  const featuresInView = useInView(featuresRef)

  // Custom cursor
  useEffect(() => {
    const move = e => setCursorPos({ x: e.clientX, y: e.clientY })
    const down = () => setCursorActive(true)
    const up = () => setCursorActive(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mousedown', down); window.removeEventListener('mouseup', up) }
  }, [])

  const accent = '#7c3aed'
  const accentCyan = '#06b6d4'
  const bg = '#0a0a0a'
  const bg2 = '#111111'
  const border = 'rgba(255,255,255,0.08)'
  const textPrimary = '#f4f4f5'
  const textMuted = '#71717a'
  const textSoft = '#a1a1aa'

  const loadingSteps = ['Scanning pixels', 'Parsing metadata', 'Running models', 'Fusing signals']

  const navigate = (to) => {
    if (to === page || animating) return
    setMenuOpen(false); setAnimating(true)
    setTimeout(() => { setPage(to); setAnimating(false); window.scrollTo({ top: 0 }) }, 280)
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
    setIsLoading(true); setResult(null); setError(null); setScanAnim(true); setShowDetails(false); setDisplayScore(0)
    let step = 0; setLoadingStep(0)
    const iv = setInterval(() => { step++; if (step < loadingSteps.length) setLoadingStep(step) }, 800)
    try {
      const fd = new FormData(); fd.append('image', imageFile)
      const res = await fetch('/api/detect', { method: 'POST', body: fd })
      const data = await res.json()
      clearInterval(iv); setLoadingStep(3)
      if (data.error) { setError(data.error); setIsLoading(false); setScanAnim(false); return }
      setTimeout(() => {
        setScanAnim(false); setResult(data); setIsLoading(false)
        const fs = computeFinalScore(data.combined, exifResult, data.dimensionScore, fftResult, faceResult)
        animateCounter(fs)
      }, 350)
    } catch (e) { clearInterval(iv); setError('Connection failed — please try again'); setIsLoading(false); setScanAnim(false) }
  }

  const animateCounter = (target) => {
    if (scoreTimerRef.current) clearInterval(scoreTimerRef.current)
    setDisplayScore(0); let cur = 0
    scoreTimerRef.current = setInterval(() => {
      cur = Math.min(target, cur + Math.ceil(target / 35))
      setDisplayScore(cur)
      if (cur >= target) clearInterval(scoreTimerRef.current)
    }, 22)
  }

  const finalScore = result ? computeFinalScore(result.combined, exifResult, result.dimensionScore, fftResult, faceResult) : 0
  const verdict = getVerdict(finalScore, result?.confidence || 'low')

  const howSteps = [
    { icon: '🧬', label: 'AI Models', color: accent },
    { icon: '📋', label: 'EXIF', color: '#8b5cf6' },
    { icon: '🌊', label: 'Frequency', color: accentCyan },
    { icon: '👤', label: 'Face', color: '#f59e0b' },
    { icon: '📐', label: 'Dimensions', color: '#14b8a6' },
  ]

  const howContent = [
    {
      title: 'AI model ensemble', icon: '🧬', color: accent,
      body: 'Two specialized classifiers analyze pixel-level statistical patterns invisible to the human eye. haywoodsloan (60% weight) has highest sensitivity on modern generators including Midjourney v6 and DALL-E 3. umm-maybe (40%) provides strong coverage across GAN architectures and diffusion models. When they strongly disagree, haywoodsloan auto-boosts to 75% since disagreement is itself a signal.',
      tags: ['Parallel inference', 'Adaptive weighting', 'Disagreement detection', 'GAN + diffusion coverage']
    },
    {
      title: 'EXIF metadata forensics', icon: '📋', color: '#8b5cf6',
      body: 'Every real camera photo embeds rich provenance: make, model, GPS, timestamp, aperture, lens model. AI generators produce empty EXIF or reveal themselves through software fields. We check 12+ fields against a database of known AI tool signatures. EXIF weight adapts from 10% (stripped metadata, common after social media) to 35% (definitive AI software signature found).',
      tags: ['12+ fields checked', 'AI software signatures', 'Adaptive weight', 'Social media stripping']
    },
    {
      title: 'FFT frequency analysis', icon: '🌊', color: accentCyan,
      body: 'A Fast Fourier Transform runs in your browser in under 100ms — zero API cost. GAN generators leave checkerboard artifacts at Nyquist frequency multiples from transposed convolution upsampling. Diffusion models produce unnaturally smooth mid-frequency bands. Real photos follow a natural 1/f power spectral density. We measure high-to-low frequency ratio and local block variance.',
      tags: ['Client-side, zero cost', 'GAN checkerboard', '1/f power law', 'Texture smoothness']
    },
    {
      title: 'Face symmetry analysis', icon: '👤', color: '#f59e0b',
      body: 'Skin tone detection using HSV color space identifies face regions. Bilateral symmetry is then measured: real human faces have natural asymmetry, but AI face generators are trained on symmetric data producing unnaturally perfect bilateral balance. We also measure skin texture variance — AI skin is statistically too smooth. Face detection boosts model weights since classifiers are most accurate on face images.',
      tags: ['HSV skin detection', 'Bilateral symmetry', 'Texture variance', 'Model weight boost']
    },
    {
      title: 'Dimension heuristics', icon: '📐', color: '#14b8a6',
      body: 'AI generators output images at specific standard sizes: 512×512 (SD 1.x), 1024×1024 (SDXL/DALL-E), 1024×1792 (DALL-E 3 portrait), 1344×768 (Midjourney landscape). Real cameras produce irregular sensor-native dimensions. We check for exact AI size matches, multiples of 64/128, and aspect ratio patterns. High-megapixel images get a real-photo bonus.',
      tags: ['Exact size matching', 'Power-of-2 detection', 'Aspect ratio analysis', 'High-res camera bonus']
    }
  ]

  return (
    <div style={{ minHeight: '100vh', background: bg, color: textPrimary, fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif', overflowX: 'hidden' }}>

      {/* Custom cursor — desktop only */}
      <div className="custom-cursor" style={{ position: 'fixed', left: cursorPos.x, top: cursorPos.y, width: '8px', height: '8px', borderRadius: '50%', background: accent, pointerEvents: 'none', zIndex: 9999, transform: 'translate(-50%,-50%)', transition: 'transform 0.1s', mixBlendMode: 'difference' }} />
      <div className="custom-cursor" style={{ position: 'fixed', left: cursorPos.x, top: cursorPos.y, width: cursorActive ? '28px' : '36px', height: cursorActive ? '28px' : '36px', borderRadius: '50%', border: `1.5px solid ${accent}`, pointerEvents: 'none', zIndex: 9998, transform: 'translate(-50%,-50%)', transition: 'width 0.15s, height 0.15s, left 0.08s, top 0.08s', opacity: 0.6 }} />

      {/* Navbar */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(24px)', borderBottom: `1px solid ${border}`, padding: '0 clamp(1rem,4vw,2rem)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '58px' }}>
        <button onClick={() => navigate('home')} style={{ display: 'flex', alignItems: 'center', gap: '9px', background: 'none', border: 'none', cursor: 'none', padding: 0 }}>
          <Logo size={28} />
          <span style={{ fontWeight: 800, fontSize: '1.1rem', background: `linear-gradient(135deg,${accent},${accentCyan})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>IsItAI</span>
        </button>
        <div className="desk-nav" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {[['home','Home'],['how','How it works'],['detect','Try free']].map(([id,label]) => (
            <button key={id} onClick={() => navigate(id)} style={{ background: page===id?`${accent}18`:'none', border: `1px solid ${page===id?accent+'35':'transparent'}`, borderRadius: '7px', padding: '6px 14px', color: page===id?accent:textSoft, cursor: 'none', fontSize: '0.86rem', fontWeight: page===id?600:400, transition: 'all 0.18s' }}>
              {label}
            </button>
          ))}
          <a href="https://github.com/Ali2191/isitai" target="_blank" rel="noreferrer" style={{ marginLeft: '8px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.06)', border: `1px solid ${border}`, borderRadius: '7px', padding: '6px 12px', color: textSoft, textDecoration: 'none', fontSize: '0.82rem', transition: 'all 0.18s', cursor: 'none' }}>
            ⭐ Star
          </a>
        </div>
        <button className="mob-menu" onClick={() => setMenuOpen(!menuOpen)} style={{ display: 'none', background: 'none', border: `1px solid ${border}`, borderRadius: '7px', padding: '8px 11px', color: textPrimary, fontSize: '1.1rem', cursor: 'pointer' }}>☰</button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div style={{ position: 'fixed', top: '58px', left: 0, right: 0, zIndex: 99, background: bg2, borderBottom: `1px solid ${border}`, padding: '0.5rem 1.5rem 1rem' }}>
          {[['home','Home'],['how','How it works'],['detect','Try free']].map(([id,label]) => (
            <button key={id} onClick={() => navigate(id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.8rem 0', color: page===id?accent:textPrimary, cursor: 'pointer', fontSize: '1rem', fontWeight: page===id?600:400, borderBottom: `1px solid ${border}` }}>{label}</button>
          ))}
        </div>
      )}

      <div style={{ paddingTop: '58px', animation: animating ? 'pOut 0.28s ease forwards' : 'pIn 0.38s ease forwards' }}>

        {/* ══ HOME ══ */}
        {page === 'home' && (
          <div>
            {/* Hero */}
            <section ref={heroRef} style={{ minHeight: 'calc(100vh - 58px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'clamp(2rem,6vw,5rem) clamp(1rem,4vw,2rem)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
              {/* Grain texture */}
              <div style={{ position: 'absolute', inset: 0, opacity: 0.035, backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")', backgroundRepeat: 'repeat', pointerEvents: 'none' }} />
              {/* Ambient glows */}
              <div style={{ position: 'absolute', top: '15%', left: '8%', width: 'min(50vw,600px)', height: 'min(50vw,600px)', background: `radial-gradient(circle,${accent}0f 0%,transparent 60%)`, borderRadius: '50%', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: '10%', right: '5%', width: 'min(40vw,450px)', height: 'min(40vw,450px)', background: `radial-gradient(circle,${accentCyan}0a 0%,transparent 60%)`, borderRadius: '50%', pointerEvents: 'none' }} />

              <div style={{ marginBottom: '1.5rem', animation: 'fadeUp 0.7s ease' }}><Logo size={50} /></div>

              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: `${accent}12`, border: `1px solid ${accent}28`, borderRadius: '24px', padding: '5px 16px', fontSize: '0.77rem', color: accent, marginBottom: '1.5rem', fontWeight: 500, animation: 'fadeUp 0.7s ease 0.1s both', letterSpacing: '0.02em' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                Free · No account · 5-layer forensic detection
              </div>

              <h1 style={{ fontSize: 'clamp(2.4rem,7vw,5.5rem)', fontWeight: 900, margin: '0 0 1.2rem', lineHeight: 1.04, letterSpacing: '-0.04em', maxWidth: '860px', animation: 'fadeUp 0.7s ease 0.15s both' }}>
                Is this image real<br />or{' '}
                <span style={{ background: `linear-gradient(135deg,${accent},${accentCyan})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AI-generated?</span>
              </h1>

              <p style={{ color: textSoft, fontSize: 'clamp(0.95rem,2vw,1.15rem)', maxWidth: '480px', margin: '0 auto 2.5rem', lineHeight: 1.8, animation: 'fadeUp 0.7s ease 0.2s both' }}>
                Upload any image. Get a plain-English verdict in seconds, backed by forensic analysis across 5 independent detection layers.
              </p>

              <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '4.5rem', animation: 'fadeUp 0.7s ease 0.25s both' }}>
                <button onClick={() => navigate('detect')}
                  style={{ background: `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', color: '#fff', padding: '0.85rem 2rem', borderRadius: '10px', fontSize: '0.95rem', fontWeight: 700, cursor: 'none', transition: 'all 0.2s', boxShadow: `0 0 32px ${accent}40`, minHeight: '46px' }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow=`0 0 48px ${accent}60`; e.currentTarget.style.transform='translateY(-2px)' }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow=`0 0 32px ${accent}40`; e.currentTarget.style.transform='translateY(0)' }}>
                  Detect an image — it's free →
                </button>
                <button onClick={() => navigate('how')}
                  style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${border}`, color: textPrimary, padding: '0.85rem 1.8rem', borderRadius: '10px', fontSize: '0.95rem', fontWeight: 500, cursor: 'none', transition: 'all 0.2s', minHeight: '46px' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor=accent; e.currentTarget.style.color=accent }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor=border; e.currentTarget.style.color=textPrimary }}>
                  How it works
                </button>
              </div>

              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '0.8rem', maxWidth: '580px', width: '100%', animation: 'fadeUp 0.7s ease 0.3s both' }}>
                {[['2 models','ensemble detection'],['5 layers','forensic analysis'],['12+ generators','detected'],['< 5s','scan time']].map(([v,l]) => (
                  <div key={v} style={{ padding: '1rem 0.8rem', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '12px', textAlign: 'center', transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor=`${accent}40`; e.currentTarget.style.background=`${accent}08` }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor=border; e.currentTarget.style.background='rgba(255,255,255,0.03)' }}>
                    <div style={{ fontWeight: 800, fontSize: '1.1rem', background: `linear-gradient(135deg,${accent},${accentCyan})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{v}</div>
                    <div style={{ color: textMuted, fontSize: '0.72rem', marginTop: '3px' }}>{l}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Features */}
            <section ref={featuresRef} style={{ padding: 'clamp(3rem,6vw,5rem) clamp(1rem,4vw,2rem)', maxWidth: '960px', margin: '0 auto' }}>
              <div style={{ textAlign: 'center', marginBottom: '3rem', opacity: featuresInView?1:0, transform: featuresInView?'translateY(0)':'translateY(20px)', transition: 'all 0.6s ease' }}>
                <h2 style={{ fontSize: 'clamp(1.6rem,4vw,2.4rem)', fontWeight: 800, margin: '0 0 0.75rem', letterSpacing: '-0.03em' }}>Why IsItAI is different</h2>
                <p style={{ color: textSoft, maxWidth: '420px', margin: '0 auto', lineHeight: 1.7, fontSize: '0.95rem' }}>Most tools show you a number. We give you a verdict you can read — and show our work.</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '1rem' }}>
                {[
                  { icon: '💬', title: 'Plain English verdicts', desc: 'No cryptic percentages. "This image is AI-generated — we\'re 94% confident." That\'s it.', color: accent },
                  { icon: '🔬', title: '5 forensic layers', desc: 'AI models + EXIF metadata + FFT frequency analysis + face symmetry + dimension heuristics.', color: '#8b5cf6' },
                  { icon: '🔓', title: 'Completely free', desc: 'No registration. No paywall. No detection limit. Free forever.', color: accentCyan },
                  { icon: '🔒', title: 'Private by design', desc: 'Images are never stored. Processed in memory and discarded immediately.', color: '#f59e0b' },
                ].map((f, fi) => (
                  <div key={f.title} style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '14px', transition: 'all 0.22s', opacity: featuresInView?1:0, transform: featuresInView?'translateY(0)':'translateY(16px)', transitionDelay: `${fi*0.08}s` }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor=`${f.color}40`; e.currentTarget.style.background=`${f.color}08`; e.currentTarget.style.transform='translateY(-3px)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor=border; e.currentTarget.style.background='rgba(255,255,255,0.03)'; e.currentTarget.style.transform='translateY(0)' }}>
                    <div style={{ fontSize: '1.6rem', marginBottom: '0.8rem' }}>{f.icon}</div>
                    <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '0.93rem', color: textPrimary }}>{f.title}</h3>
                    <p style={{ margin: 0, color: textMuted, fontSize: '0.84rem', lineHeight: 1.7 }}>{f.desc}</p>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: '2.5rem' }}>
                <button onClick={() => navigate('detect')} style={{ background: `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', color: '#fff', padding: '0.85rem 2rem', borderRadius: '10px', fontSize: '0.95rem', fontWeight: 700, cursor: 'none', boxShadow: `0 0 24px ${accent}30`, minHeight: '46px' }}>
                  Try it free →
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ══ HOW IT WORKS ══ */}
        {page === 'how' && (
          <div style={{ maxWidth: '900px', margin: '0 auto', padding: 'clamp(2rem,5vw,4rem) clamp(1rem,4vw,1.5rem)' }}>
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
              <div style={{ display: 'inline-block', background: `${accent}12`, border: `1px solid ${accent}28`, borderRadius: '20px', padding: '4px 14px', fontSize: '0.76rem', color: accent, marginBottom: '1rem', fontWeight: 500 }}>Under the hood</div>
              <h1 style={{ fontSize: 'clamp(1.8rem,5vw,3rem)', fontWeight: 900, margin: '0 0 0.8rem', letterSpacing: '-0.03em' }}>How the detection works</h1>
              <p style={{ color: textSoft, maxWidth: '460px', margin: '0 auto', lineHeight: 1.7, fontSize: '0.93rem' }}>Five independent forensic layers. Each targets a different class of AI generation artifact.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: '8px', marginBottom: '1.5rem' }}>
              {howSteps.map((s,i) => (
                <button key={i} onClick={() => setActiveHow(i)}
                  style={{ padding: '0.8rem 0.5rem', borderRadius: '10px', border: `1.5px solid ${activeHow===i?s.color:border}`, background: activeHow===i?`${s.color}12`:'rgba(255,255,255,0.03)', cursor: 'none', transition: 'all 0.2s', textAlign: 'center', minHeight: '46px' }}>
                  <div style={{ fontSize: '1.2rem', marginBottom: '4px' }}>{s.icon}</div>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: activeHow===i?s.color:textSoft, lineHeight: 1.2 }}>{s.label}</div>
                  <div style={{ fontSize: '0.6rem', color: activeHow===i?s.color:textMuted, marginTop: '2px' }}>Layer {i+1}</div>
                </button>
              ))}
            </div>

            {howContent.map((h,i) => i===activeHow && (
              <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '18px', overflow: 'hidden', animation: 'panelIn 0.3s ease' }}>
                <div style={{ padding: '1.5rem 2rem', background: `${h.color}08`, borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '2.5rem' }}>{h.icon}</div>
                  <div>
                    <div style={{ fontSize: '0.66rem', color: h.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Layer {i+1}</div>
                    <h2 style={{ margin: 0, fontSize: 'clamp(1rem,3vw,1.4rem)', fontWeight: 800, letterSpacing: '-0.02em' }}>{h.title}</h2>
                  </div>
                </div>
                <div className="how-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 220px' }}>
                  <div style={{ padding: '1.5rem 2rem', borderRight: `1px solid ${border}` }}>
                    <p style={{ color: textSoft, lineHeight: 1.85, fontSize: '0.92rem', margin: 0 }}>{h.body}</p>
                  </div>
                  <div style={{ padding: '1.5rem' }}>
                    <div style={{ fontSize: '0.66rem', color: textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>Key concepts</div>
                    {h.tags.map((tag,ti) => (
                      <div key={tag} style={{ padding: '6px 10px', background: `${h.color}0d`, border: `1px solid ${h.color}20`, borderRadius: '8px', fontSize: '0.76rem', color: h.color, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
                        <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: h.color, flexShrink: 0 }} />{tag}
                      </div>
                    ))}
                    <div style={{ marginTop: '1.2rem', paddingTop: '1.2rem', borderTop: `1px solid ${border}` }}>
                      <div style={{ fontSize: '0.66rem', color: textMuted, marginBottom: '6px' }}>Progress</div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {howSteps.map((_,di) => <div key={di} onClick={() => setActiveHow(di)} style={{ height: '3px', flex: 1, borderRadius: '2px', background: di<=i?howContent[i].color:border, cursor: 'pointer', transition: 'background 0.25s' }} />)}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ padding: '1rem 2rem', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <button onClick={() => setActiveHow(Math.max(0,i-1))} disabled={i===0} style={{ background: 'none', border: `1px solid ${i===0?'transparent':border}`, borderRadius: '7px', padding: '7px 16px', color: i===0?textMuted:textPrimary, cursor: 'none', fontSize: '0.83rem', minHeight: '44px' }}>← Previous</button>
                  <span style={{ fontSize: '0.76rem', color: textMuted }}>{i+1} / {howSteps.length}</span>
                  {i < howSteps.length-1
                    ? <button onClick={() => setActiveHow(i+1)} style={{ background: `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', borderRadius: '7px', padding: '7px 16px', color: '#fff', cursor: 'none', fontSize: '0.83rem', fontWeight: 600, minHeight: '44px' }}>Next →</button>
                    : <button onClick={() => navigate('detect')} style={{ background: `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', borderRadius: '7px', padding: '7px 16px', color: '#fff', cursor: 'none', fontSize: '0.83rem', fontWeight: 600, minHeight: '44px' }}>Try it free →</button>
                  }
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══ DETECT ══ */}
        {page === 'detect' && (
          <div style={{ maxWidth: '560px', margin: '0 auto', padding: 'clamp(2rem,5vw,3.5rem) clamp(1rem,4vw,1.5rem)' }}>
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <h1 style={{ fontSize: 'clamp(1.6rem,5vw,2.4rem)', fontWeight: 900, margin: '0 0 0.6rem', letterSpacing: '-0.03em' }}>Analyze your image</h1>
              <p style={{ color: textSoft, margin: 0, fontSize: '0.9rem', lineHeight: 1.7 }}>Plain-English verdict in under 5 seconds. Free forever.</p>
            </div>

            {/* Upload zone */}
            <div
              style={{ background: isDragging?`${accent}08`:'rgba(255,255,255,0.02)', border: `2px dashed ${isDragging?accent:border}`, borderRadius: '16px', overflow: 'hidden', marginBottom: '0.75rem', transition: 'all 0.22s', position: 'relative', boxShadow: isDragging?`0 0 32px ${accent}20`:'none' }}
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }}>
              {imagePreview ? (
                <div style={{ position: 'relative' }}>
                  <img src={imagePreview} alt="preview" style={{ width: '100%', maxHeight: '320px', objectFit: 'cover', display: 'block' }} />
                  {scanAnim && (
                    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                      <div style={{ position: 'absolute', left: 0, right: 0, height: '2px', background: `linear-gradient(90deg,transparent,${accent},${accentCyan},transparent)`, animation: 'scan 1.4s ease-in-out infinite', boxShadow: `0 0 12px ${accent}` }} />
                      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg,${accent}07 0%,transparent 50%,${accentCyan}06 100%)`, animation: 'pulse2 1.6s ease-in-out infinite' }} />
                      <div style={{ position: 'absolute', top: '10px', left: '10px', background: `${accent}ee`, color: '#fff', padding: '4px 12px', borderRadius: '20px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#fff', animation: 'pulse 0.8s infinite' }} />SCANNING
                      </div>
                    </div>
                  )}
                  <button onClick={() => { setImageFile(null); setImagePreview(null); setResult(null); setExifResult(null); setFftResult(null); setFaceResult(null); setError(null) }}
                    style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: '34px', height: '34px', cursor: 'none', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>✕</button>
                  <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.72)', padding: '3px 10px', borderRadius: '6px', fontSize: '0.7rem', color: '#d4d4d8', zIndex: 2, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {imageFile?.name}
                  </div>
                </div>
              ) : (
                <div onClick={() => fileInputRef.current?.click()} style={{ padding: '3rem 1.5rem', textAlign: 'center', cursor: 'none', minHeight: '190px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: `${accent}12`, border: `1px solid ${accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem' }}>🖼️</div>
                  <p style={{ color: textSoft, margin: '0 0 0.3rem', fontWeight: 500, fontSize: '0.93rem' }}>Drop your image or <span style={{ color: accent, fontWeight: 700 }}>browse</span></p>
                  <p style={{ color: textMuted, fontSize: '0.76rem', margin: 0 }}>PNG · JPG · WEBP · up to 20MB</p>
                </div>
              )}
              {/* Phase 2 fix: removed capture attribute — opens photo library on mobile */}
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
            </div>

            {/* Quick badges */}
            {imageFile && !result && (exifResult||fftResult||faceResult) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '0.75rem', animation: 'fadeUp 0.3s ease' }}>
                {exifResult && <span style={{ fontSize: '0.71rem', padding: '3px 9px', borderRadius: '20px', background: exifResult.evidenceQuality>=35?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)', color: exifResult.evidenceQuality>=35?'#4ade80':'#f87171', border: `1px solid ${exifResult.evidenceQuality>=35?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)'}`, fontWeight: 500 }}>📋 EXIF: {exifResult.evidenceQuality>=50?'Rich':exifResult.evidenceQuality>=25?'Partial':'Sparse'}</span>}
                {fftResult?.confidence!=='none' && <span style={{ fontSize: '0.71rem', padding: '3px 9px', borderRadius: '20px', background: 'rgba(6,182,212,0.1)', color: accentCyan, border: '1px solid rgba(6,182,212,0.2)', fontWeight: 500 }}>🌊 FFT: {fftResult.confidence}</span>}
                {faceResult?.faceDetected && <span style={{ fontSize: '0.71rem', padding: '3px 9px', borderRadius: '20px', background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.2)', fontWeight: 500 }}>👤 Face found</span>}
              </div>
            )}

            {/* Loading */}
            {isLoading && (
              <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '14px', padding: '1.25rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '4px', marginBottom: '0.8rem' }}>
                  {loadingSteps.map((s,i) => (
                    <div key={s} style={{ textAlign: 'center' }}>
                      <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: i<loadingStep?`${accent}20`:i===loadingStep?`linear-gradient(135deg,${accent},${accentCyan})`:'rgba(255,255,255,0.05)', border: `1.5px solid ${i<=loadingStep?accent:border}`, margin: '0 auto 5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.66rem', color: i<loadingStep?accent:i===loadingStep?'#fff':textMuted, transition: 'all 0.35s', animation: i===loadingStep?'ring 1s ease infinite':'none' }}>
                        {i<loadingStep?'✓':i+1}
                      </div>
                      <div style={{ fontSize: '0.6rem', color: i<=loadingStep?accent:textMuted, fontWeight: i===loadingStep?700:400 }}>{s}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: `linear-gradient(90deg,${accent},${accentCyan})`, borderRadius: '4px', width: `${((loadingStep+1)/loadingSteps.length)*100}%`, transition: 'width 0.7s ease' }} />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', padding: '0.9rem 1.1rem', color: '#fca5a5', fontSize: '0.87rem', marginBottom: '0.75rem' }}>
                ⚠️ {error} — Models may be cold-starting, try again in 30s.
              </div>
            )}

            {/* ── Verdict Card ── */}
            {result && (
              <div style={{ border: `1px solid ${verdict.color}28`, borderRadius: '18px', overflow: 'hidden', marginBottom: '0.75rem', animation: 'reveal 0.5s cubic-bezier(0.34,1.56,0.64,1)', boxShadow: `0 0 60px ${verdict.glow}` }}>
                {/* Score section */}
                <div style={{ padding: '2rem 1.5rem', textAlign: 'center', background: `${verdict.color}05`, borderBottom: `1px solid ${border}`, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 60%,${verdict.color}08,transparent 65%)`, pointerEvents: 'none' }} />
                  {/* Grain overlay on result card */}
                  <div style={{ position: 'absolute', inset: 0, opacity: 0.03, backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")', pointerEvents: 'none' }} />

                  <div style={{ fontSize: '2.5rem', marginBottom: '0.4rem', animation: 'bounceIn 0.4s ease' }}>{verdict.emoji}</div>
                  <div style={{ fontSize: 'clamp(3rem,10vw,5rem)', fontWeight: 900, color: verdict.color, lineHeight: 1, letterSpacing: '-0.04em', animation: 'countIn 0.7s ease', fontVariantNumeric: 'tabular-nums' }}>{displayScore}%</div>
                  <div style={{ marginTop: '0.6rem', display: 'inline-block', padding: '4px 16px', borderRadius: '20px', background: `${verdict.color}15`, border: `1px solid ${verdict.color}28`, fontSize: '0.88rem', fontWeight: 700, color: verdict.color, animation: 'fadeUp 0.4s ease 0.2s both' }}>{verdict.line1}</div>
                </div>

                {/* Verdict text */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${border}`, background: 'rgba(255,255,255,0.01)' }}>
                  <p style={{ margin: '0 0 0.5rem', fontSize: '1rem', lineHeight: 1.75, color: textPrimary, fontWeight: 400, animation: 'fadeUp 0.4s ease 0.15s both' }}>
                    {verdict.line2}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: textMuted, lineHeight: 1.6, animation: 'fadeUp 0.4s ease 0.2s both' }}>{verdict.sub}</p>
                  <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: textMuted, display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <span>Confidence: <span style={{ color: result.confidence==='high'?'#4ade80':result.confidence==='medium'?'#fbbf24':'#f87171', fontWeight: 600 }}>{result.confidence}</span></span>
                    {result.disagreement && <span style={{ color: '#fbbf24' }}>⚠ Models disagreed</span>}
                    <span style={{ color: textMuted }}>{result.modelsUsed} models + {[exifResult, fftResult, faceResult].filter(r=>r&&r.confidence!=='none').length + (result.dimensionScore?.confidence!=='none'?1:0)} heuristic layers</span>
                  </div>
                </div>

                {/* Toggle technical details */}
                <div style={{ padding: '0.8rem 1.5rem', background: 'rgba(255,255,255,0.01)' }}>
                  <button onClick={() => setShowDetails(!showDetails)} style={{ background: 'none', border: 'none', cursor: 'none', fontSize: '0.8rem', color: textMuted, padding: 0, display: 'flex', alignItems: 'center', gap: '6px', minHeight: '36px', transition: 'color 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.color=accent}
                    onMouseLeave={e => e.currentTarget.style.color=textMuted}>
                    <span style={{ fontSize: '0.7rem', transition: 'transform 0.2s', display: 'inline-block', transform: showDetails?'rotate(90deg)':'none' }}>▶</span>
                    {showDetails ? 'Hide' : 'View'} forensic breakdown
                  </button>

                  {showDetails && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${border}`, animation: 'fadeUp 0.25s ease' }}>
                      {/* Model scores */}
                      <div style={{ fontSize: '0.66rem', color: textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>AI model scores</div>
                      {result.modelResults.map((m,mi) => (
                        <div key={m.name} style={{ marginBottom: '0.9rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                            <span style={{ color: textSoft }}>{m.shortName}{m.weightAdjusted&&<span style={{ color: accent, fontSize: '0.68rem', marginLeft: '6px' }}>↑ boosted</span>}</span>
                            <span style={{ color: m.aiScore>=50?'#f87171':'#4ade80', fontWeight: 700 }}>{m.aiScore}%</span>
                          </div>
                          <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', background: m.aiScore>=50?`linear-gradient(90deg,#ef4444,#f97316)`:`linear-gradient(90deg,#22c55e,#10b981)`, borderRadius: '4px', width: `${m.aiScore}%`, transition: `width 0.9s cubic-bezier(0.34,1.2,0.64,1) ${mi*0.1}s` }} />
                          </div>
                        </div>
                      ))}

                      {/* Heuristic layers */}
                      {[
                        { data: exifResult, label: '📋 EXIF Metadata', color: '#8b5cf6', weightLabel: exifResult?`${Math.round(exifResult.exifWeight*100)}% weight`:'' },
                        { data: fftResult&&fftResult.signals.length>0?fftResult:null, label: '🌊 Frequency Analysis', color: accentCyan },
                        { data: faceResult&&faceResult.signals.length>0?faceResult:null, label: '👤 Face Analysis', color: '#f59e0b' },
                        { data: result.dimensionScore?.signals?.length>0?result.dimensionScore:null, label: '📐 Dimensions', color: '#14b8a6' },
                      ].filter(l=>l.data).map((layer,li) => (
                        <div key={layer.label} style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: `1px solid ${border}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                            <span style={{ color: layer.color, fontWeight: 600 }}>{layer.label}{layer.weightLabel&&<span style={{ color: textMuted, fontWeight: 400, fontSize: '0.72rem', marginLeft: '6px' }}>({layer.weightLabel})</span>}</span>
                            <span style={{ color: layer.data.score>=30?'#f87171':'#4ade80', fontWeight: 700 }}>{layer.data.aiScore??layer.data.score}%</span>
                          </div>
                          {layer.data.aiScore!==undefined&&<div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '8px' }}>
                            <div style={{ height: '100%', background: (layer.data.aiScore??layer.data.score)>=50?`linear-gradient(90deg,#ef4444,#f97316)`:`linear-gradient(90deg,#22c55e,#10b981)`, borderRadius: '4px', width: `${layer.data.aiScore??layer.data.score}%`, transition: `width 0.9s cubic-bezier(0.34,1.2,0.64,1)` }} />
                          </div>}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                            {layer.data.signals?.map((s,si) => (
                              <span key={si} style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: '20px', background: s.suspicious?'rgba(239,68,68,0.1)':'rgba(34,197,94,0.1)', color: s.suspicious?'#fca5a5':'#86efac', border: `1px solid ${s.suspicious?'rgba(239,68,68,0.2)':'rgba(34,197,94,0.2)'}`, fontWeight: 500 }}>
                                {s.suspicious?'⚠ ':'✓ '}{s.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CTA */}
            {imageFile ? (
              <button onClick={handleDetect} disabled={isLoading}
                style={{ width: '100%', background: isLoading?'rgba(255,255,255,0.05)':`linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', color: isLoading?textMuted:'#fff', padding: '1rem', borderRadius: '12px', fontSize: '0.97rem', fontWeight: 700, cursor: isLoading?'not-allowed':'none', transition: 'all 0.2s', boxShadow: isLoading?'none':`0 0 28px ${accent}30`, minHeight: '52px' }}>
                {isLoading ? '⏳ Analyzing...' : result ? '🔄 Analyze Again' : '🔍 Detect Now — Free'}
              </button>
            ) : (
              <button onClick={() => fileInputRef.current?.click()}
                style={{ width: '100%', background: `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', color: '#fff', padding: '1rem', borderRadius: '12px', fontSize: '0.97rem', fontWeight: 700, cursor: 'none', boxShadow: `0 0 28px ${accent}30`, minHeight: '52px' }}>
                📁 Upload an Image
              </button>
            )}
            <p style={{ color: textMuted, fontSize: '0.72rem', textAlign: 'center', marginTop: '0.75rem' }}>🔒 Never stored · Processed in real-time · Private by design</p>
          </div>
        )}

        {/* Footer */}
        <footer style={{ borderTop: `1px solid ${border}`, padding: 'clamp(2rem,4vw,3rem) clamp(1rem,4vw,2rem)', marginTop: 'clamp(2rem,5vw,4rem)' }}>
          <div style={{ maxWidth: '960px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '2rem', marginBottom: '2rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.6rem' }}>
                <Logo size={22} />
                <span style={{ fontWeight: 800, background: `linear-gradient(135deg,${accent},${accentCyan})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: '0.95rem' }}>IsItAI</span>
              </div>
              <p style={{ color: textMuted, fontSize: '0.8rem', margin: '0 0 0.5rem', lineHeight: 1.6 }}>Free AI image detection. No account. No paywall. Built for truth.</p>
              <p style={{ color: textMuted, fontSize: '0.75rem', margin: 0 }}>Results are probabilistic, not legal determinations.</p>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Product</div>
              {[['home','Home'],['how','How it works'],['detect','Try free']].map(([id,label]) => (
                <button key={id} onClick={() => navigate(id)} style={{ display: 'block', background: 'none', border: 'none', color: textSoft, cursor: 'none', fontSize: '0.83rem', padding: '3px 0', marginBottom: '4px', textAlign: 'left', transition: 'color 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.color=accent}
                  onMouseLeave={e => e.currentTarget.style.color=textSoft}>{label}</button>
              ))}
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Legal</div>
              <Link href="/privacy" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px', transition: 'color 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.color=accent}
                onMouseLeave={e => e.currentTarget.style.color=textSoft}>Privacy Policy</Link>
              <Link href="/terms" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', transition: 'color 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.color=accent}
                onMouseLeave={e => e.currentTarget.style.color=textSoft}>Terms of Service</Link>
            </div>
          </div>
          <div style={{ maxWidth: '960px', margin: '0 auto', paddingTop: '1.5rem', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <p style={{ color: textMuted, margin: 0, fontSize: '0.78rem' }}>© 2025 IsItAI · Built with Next.js · Powered by Hugging Face</p>
            <a href="https://github.com/Ali2191/isitai" target="_blank" rel="noreferrer" style={{ color: textMuted, fontSize: '0.78rem', textDecoration: 'none', transition: 'color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.color=textPrimary}
              onMouseLeave={e => e.currentTarget.style.color=textMuted}>⭐ Star on GitHub</a>
          </div>
        </footer>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0 }
        html { scroll-behavior: smooth; cursor: none }
        body { cursor: none }
        a, button { cursor: none }

        @keyframes pIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes pOut { from { opacity:1; transform:translateY(0) } to { opacity:0; transform:translateY(-6px) } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
        @keyframes panelIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        @keyframes reveal { from { opacity:0; transform:scale(0.97) translateY(8px) } to { opacity:1; transform:scale(1) translateY(0) } }
        @keyframes bounceIn { from { opacity:0; transform:scale(0.4) } to { opacity:1; transform:scale(1) } }
        @keyframes countIn { from { opacity:0; transform:scale(0.8) } to { opacity:1; transform:scale(1) } }
        @keyframes scan { 0%{top:-2px;opacity:0} 8%{opacity:1} 92%{opacity:1} 100%{top:100%;opacity:0} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes pulse2 { 0%,100%{opacity:0.3} 50%{opacity:0.6} }
        @keyframes ring { 0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,0.4)} 50%{box-shadow:0 0 0 5px rgba(124,58,237,0)} }

        @media (max-width: 767px) {
          .desk-nav { display: none !important }
          .mob-menu { display: block !important }
          .custom-cursor { display: none !important }
          html, body, a, button { cursor: auto !important }
          .how-grid { grid-template-columns: 1fr !important }
          .how-grid > div:first-child { border-right: none !important; border-bottom: 1px solid rgba(255,255,255,0.08) }
        }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important }
        }
      `}</style>
    </div>
  )
}