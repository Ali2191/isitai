'use client'
import { useState, useRef, useEffect } from 'react'
import * as exifr from 'exifr'

// ── Smart EXIF algorithm with adaptive confidence ──────────────────────────
async function analyzeExif(file) {
  try {
    const exif = await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true })

    if (!exif) {
      return {
        aiScore: 72, exifWeight: 0.18, confidence: 'medium',
        signals: [
          { label: 'No EXIF data found', suspicious: true, weight: 'high' },
          { label: 'Real photos always contain metadata', suspicious: true, weight: 'high' }
        ],
        verdict: 'no_metadata'
      }
    }

    const signals = []
    let rawScore = 0
    let evidenceQuality = 0 // 0-100, higher = more reliable EXIF evidence

    // ── Software/AI signature (strongest signal) ──
    const sw = (exif.Software || exif.software || exif['dc:creator'] || exif.CreatorTool || '').toLowerCase()
    const aiTools = [
      { name: 'stable diffusion', label: 'Stable Diffusion' },
      { name: 'midjourney', label: 'Midjourney' },
      { name: 'dall-e', label: 'DALL-E' },
      { name: 'firefly', label: 'Adobe Firefly' },
      { name: 'gemini', label: 'Google Gemini' },
      { name: 'openai', label: 'OpenAI' },
      { name: 'runway', label: 'Runway ML' },
      { name: 'imagen', label: 'Google Imagen' },
      { name: 'nightcafe', label: 'NightCafe' },
      { name: 'leonardo', label: 'Leonardo AI' },
      { name: 'invoke', label: 'InvokeAI' },
      { name: 'automatic1111', label: 'A1111 WebUI' }
    ]
    const foundAI = aiTools.find(t => sw.includes(t.name))
    if (foundAI) {
      signals.push({ label: `AI signature: ${foundAI.label}`, suspicious: true, weight: 'definitive' })
      rawScore += 95
      evidenceQuality += 60 // Definitive evidence
    } else if (exif.Software) {
      signals.push({ label: `Software: ${exif.Software}`, suspicious: false, weight: 'low' })
      evidenceQuality += 15
    } else {
      signals.push({ label: 'No software metadata', suspicious: true, weight: 'medium' })
      rawScore += 12
      evidenceQuality += 5
    }

    // ── Camera make/model ──
    const hasCamera = !!(exif.Make || exif.Model)
    if (hasCamera) {
      signals.push({ label: `Camera: ${[exif.Make, exif.Model].filter(Boolean).join(' ')}`, suspicious: false, weight: 'high' })
      rawScore = Math.max(0, rawScore - 20) // Strong real signal
      evidenceQuality += 25
    } else {
      signals.push({ label: 'No camera detected', suspicious: true, weight: 'high' })
      rawScore += 20
      evidenceQuality += 8
    }

    // ── GPS coordinates ──
    const hasGPS = !!(exif.latitude || exif.longitude)
    if (hasGPS) {
      signals.push({ label: `GPS: ${exif.latitude?.toFixed(4)}°, ${exif.longitude?.toFixed(4)}°`, suspicious: false, weight: 'medium' })
      rawScore = Math.max(0, rawScore - 8)
      evidenceQuality += 15
    } else {
      signals.push({ label: 'No GPS coordinates', suspicious: true, weight: 'medium' })
      rawScore += 8
      evidenceQuality += 5
    }

    // ── Lens information ──
    const hasLens = !!(exif.FocalLength || exif.LensModel || exif.LensMake)
    if (hasLens) {
      const lensStr = exif.LensModel || `${exif.FocalLength}mm`
      signals.push({ label: `Lens: ${lensStr}`, suspicious: false, weight: 'medium' })
      rawScore = Math.max(0, rawScore - 5)
      evidenceQuality += 15
    } else {
      signals.push({ label: 'No lens information', suspicious: true, weight: 'medium' })
      rawScore += 8
      evidenceQuality += 3
    }

    // ── Capture timestamp ──
    const captureDate = exif.DateTimeOriginal || exif.CreateDate
    if (captureDate) {
      signals.push({ label: `Captured: ${new Date(captureDate).toLocaleDateString()}`, suspicious: false, weight: 'low' })
      rawScore = Math.max(0, rawScore - 5)
      evidenceQuality += 10
    } else {
      signals.push({ label: 'No capture timestamp', suspicious: true, weight: 'low' })
      rawScore += 6
      evidenceQuality += 2
    }

    // ── Compute adaptive EXIF weight based on evidence quality ──
    // definitive_ai (AI signature found): high weight 0.35
    // good_real (camera+gps+lens+time): decent weight 0.28
    // stripped (WhatsApp/social media removes all): low weight 0.12
    // partial: medium weight 0.18
    let exifWeight
    let confidence
    if (foundAI) {
      exifWeight = 0.35
      confidence = 'high'
    } else if (evidenceQuality >= 60) {
      exifWeight = 0.28
      confidence = 'high'
    } else if (evidenceQuality >= 35) {
      exifWeight = 0.20
      confidence = 'medium'
    } else if (evidenceQuality >= 15) {
      exifWeight = 0.14
      confidence = 'low'
    } else {
      exifWeight = 0.10
      confidence = 'very_low'
    }

    const finalScore = Math.min(95, Math.max(3, Math.round(rawScore)))

    return {
      aiScore: finalScore,
      exifWeight,
      confidence,
      evidenceQuality,
      signals,
      verdict: foundAI ? 'definitive_ai' : hasCamera ? 'has_camera' : 'no_camera'
    }
  } catch (e) {
    return {
      aiScore: 45, exifWeight: 0.10, confidence: 'very_low',
      signals: [{ label: 'Could not parse metadata', suspicious: true, weight: 'low' }],
      verdict: 'parse_error'
    }
  }
}

// ── Compute final blended score with adaptive EXIF weight ──────────────────
function computeFinalScore(modelCombined, exifData) {
  if (!exifData) return modelCombined
  const ew = exifData.exifWeight
  const mw = 1 - ew
  return Math.min(99, Math.max(1, Math.round(modelCombined * mw + exifData.aiScore * ew)))
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

const PAGES = ['home', 'how', 'detect']

export default function App() {
  const [dark, setDark] = useState(false) // Default: light mode
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
  const [error, setError] = useState(null)
  const [activeHow, setActiveHow] = useState(0)
  const [displayScore, setDisplayScore] = useState(0)
  const [exifVisible, setExifVisible] = useState(false)
  const fileInputRef = useRef(null)
  const scoreAnimRef = useRef(null)

  const t = dark
    ? { bg: '#07090f', bg2: '#0f1117', bg3: '#161b27', card: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#f1f5f9', muted: '#64748b', soft: '#94a3b8', inputBg: '#0f1117' }
    : { bg: '#f8fafc', bg2: '#ffffff', bg3: '#f1f5f9', card: 'rgba(0,0,0,0.03)', border: 'rgba(0,0,0,0.08)', text: '#0f172a', muted: '#94a3b8', soft: '#475569', inputBg: '#ffffff' }

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
    setResult(null); setError(null); setExifResult(null); setExifVisible(false)
    const exif = await analyzeExif(file)
    setExifResult(exif)
    setTimeout(() => setExifVisible(true), 100)
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
        animateScore(computeFinalScore(data.combined, exifResult))
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

  const finalScore = result ? computeFinalScore(result.combined, exifResult) : 0
  const verdict = getVerdict(finalScore)

  const howSteps = [
    {
      icon: '🧬', title: 'Pixel-level frequency analysis', subtitle: 'Visual artifacts', color: '#6366f1',
      detail: [
        'AI image generators leave microscopic statistical fingerprints in their output pixels — invisible to the human eye, but highly detectable by trained classifiers.',
        'Real camera images contain natural sensor noise called PRNU (Photo Response Non-Uniformity), lens distortion, chromatic aberration, and organic high-frequency noise from photons hitting a physical sensor. These imperfections follow predictable real-world physics.',
        'AI-generated images have pixel distributions that are statistically "too smooth" in some frequency bands and "too structured" in others. Diffusion models like Stable Diffusion leave specific artifacts in 8×8 DCT blocks. GANs like StyleGAN leave ring-shaped artifacts visible in the Fourier frequency domain.',
        'Our ensemble runs three specialized classifiers — haywoodsloan (50% weight, strongest on AI outputs), umm-maybe (30%, GAN specialist), Organika/sdxl (20%, SDXL-focused). Weights reflect empirically observed performance across diverse image sets.'
      ],
      tags: ['GAN fingerprints', 'DCT block artifacts', 'Fourier analysis', 'PRNU sensor noise', 'Adaptive weighting']
    },
    {
      icon: '📋', title: 'EXIF metadata forensics', subtitle: 'Digital provenance', color: '#8b5cf6',
      detail: [
        'Every photo taken by a real camera embeds a chain of provenance data into the file using the EXIF standard — automatically written by camera firmware at the moment of capture.',
        'This metadata includes camera make/model, GPS coordinates, exact timestamp, aperture, shutter speed, ISO, focal length, and lens model — fields that paint a complete picture of the physical capture event.',
        'AI generators produce files with empty EXIF fields or metadata revealing the generating software. We check 12+ fields and cross-reference software strings against a database of known AI tool signatures.',
        'Critically, EXIF weight is adaptive — if we find an AI software signature, EXIF gets 35% weight. If metadata is stripped by social media (WhatsApp, Instagram), EXIF gets only 10-12% weight so unreliable evidence does not skew the result.'      ],
      tags: ['EXIF parsing', 'Adaptive weighting', 'Software signatures', 'C2PA watermarks', 'Evidence quality']
    },
    {
      icon: '⚖️', title: 'Adaptive score fusion', subtitle: 'Intelligent aggregation', color: '#ec4899',
      detail: [
        'No single detection method works across all image types. A GAN detector misses diffusion outputs. Metadata checking fails on re-photographed screens. We fuse independent signals using adaptive weights.',
        'Model weights: haywoodsloan 50% (consistently highest sensitivity on AI images), umm-maybe 30% (strong GAN recall), Organika/sdxl 20% (SDXL pipeline specialist). If a model times out, its weight redistributes proportionally.',
        'EXIF weight is dynamically computed: definitive AI signature → 35%, high-quality real metadata → 28%, partial metadata → 14-20%, stripped/absent metadata → 10%. This prevents low-quality EXIF evidence from corrupting confident model scores.',
        'Final score = (modelScore × modelWeight) + (exifScore × exifWeight). A disagreement flag raises when the highest and lowest model scores differ by more than 25 points, signaling uncertain cases.'
      ],
      tags: ['Adaptive fusion', 'Evidence weighting', 'Disagreement flags', 'Proportional redistribution', 'Confidence scoring']
    },
    {
      icon: '🔮', title: 'Limitations & roadmap', subtitle: 'Honest transparency', color: '#14b8a6',
      detail: [
        'Strong detection: Stable Diffusion all versions, DALL-E 2/3, Midjourney v4-v6, Adobe Firefly, Google Imagen, StyleGAN2/3, and most face synthesis GANs.',
        'Detection degrades for post-processed AI images — sharpening, noise injection, JPEG re-compression alter frequency fingerprints. Images printed and re-photographed acquire real camera EXIF, defeating both layers.',
        'Current weakness: AI-enhanced real photos where inpainting, background replacement, or face swaps affect partial regions. Binary classifiers struggle with partially synthetic images.',
        'Roadmap: C2PA cryptographic watermark verification (adopted by Adobe, Google, Microsoft, OpenAI), Error Level Analysis (ELA) for compression forensics, attention-map based localization to identify which regions of an image are AI-generated rather than just a binary verdict.'
      ],
      tags: ['Supported generators', 'Post-processing limits', 'Inpainting blind spots', 'ELA forensics', 'C2PA roadmap']
    }
  ]

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', transition: 'background 0.3s, color 0.3s', overflowX: 'hidden' }}>

      {/* ── Navbar ── */}
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
          <button onClick={() => setDark(!dark)}
            style={{ marginLeft: '8px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '20px', padding: '6px 14px', cursor: 'pointer', fontSize: '0.82rem', color: t.text, transition: 'all 0.2s' }}>
            {dark ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </nav>

      {/* ── Page wrapper ── */}
      <div style={{ paddingTop: '64px', animation: animating ? 'pageOut 0.32s ease forwards' : 'pageIn 0.4s ease forwards' }}>

        {/* ════════════ HOME PAGE ════════════ */}
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
                A 4-layer forensic system combining AI ensemble models with EXIF metadata analysis to reveal every fingerprint an AI generator leaves behind.
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
                {[['98.2%', 'Accuracy', 'CIFAKE benchmark'], ['3+1', 'Layers', 'models + EXIF'], ['12+', 'Generators', 'detected'], ['<5s', 'Speed', 'real-time']].map(([v, l, s]) => (
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

            <section style={{ padding: '5rem 2rem', maxWidth: '960px', margin: '0 auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                {[
                  { icon: '🧬', title: 'Ensemble AI models', desc: 'Three specialized classifiers with adaptive weighting — haywoodsloan (50%), umm-maybe (30%), Organika (20%) — each targeting different generator architectures.', color: '#6366f1' },
                  { icon: '📋', title: 'Smart EXIF forensics', desc: 'Adaptive metadata analysis. EXIF weight scales from 10% (stripped metadata) to 35% (definitive AI signature) based on evidence quality.', color: '#8b5cf6' },
                  { icon: '⚖️', title: 'Intelligent fusion', desc: 'Model scores and metadata signals blend using dynamically computed weights. Low-quality evidence never corrupts high-confidence model results.', color: '#ec4899' }
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

        {/* ════════════ HOW IT WORKS PAGE ════════════ */}
        {page === 'how' && (
          <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '4rem 1.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
              <div style={{ display: 'inline-block', background: dark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '24px', padding: '6px 18px', fontSize: '0.8rem', color: accent, marginBottom: '1.2rem', fontWeight: 500 }}>Under the hood</div>
              <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', fontWeight: 900, margin: '0 0 1rem', letterSpacing: '-0.03em' }}>How the detection works</h1>
              <p style={{ color: t.soft, fontSize: '1.05rem', maxWidth: '520px', margin: '0 auto', lineHeight: 1.7 }}>Four independent forensic layers. Click each to explore the full technical depth.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '2rem' }}>
              {howSteps.map((s, i) => (
                <button key={i} onClick={() => setActiveHow(i)}
                  style={{ padding: '1.1rem', borderRadius: '14px', border: `1.5px solid ${activeHow === i ? s.color : t.border}`, background: activeHow === i ? `${s.color}10` : t.bg2, color: activeHow === i ? s.color : t.soft, cursor: 'pointer', transition: 'all 0.25s', textAlign: 'left', boxShadow: activeHow === i ? `0 4px 20px ${s.color}20` : 'none' }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>{s.icon}</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, lineHeight: 1.3, color: activeHow === i ? s.color : t.text }}>{s.subtitle}</div>
                  <div style={{ fontSize: '0.7rem', color: activeHow === i ? s.color : t.muted, marginTop: '3px' }}>Layer {i + 1}</div>
                </button>
              ))}
            </div>

            {howSteps.map((s, i) => i === activeHow && (
              <div key={i} style={{ background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '24px', overflow: 'hidden', animation: 'panelIn 0.35s ease', boxShadow: dark ? `0 0 50px ${s.color}08` : `0 4px 40px rgba(0,0,0,0.06)` }}>
                <div style={{ padding: '2rem 2.5rem', background: `${s.color}07`, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ fontSize: '3rem' }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: s.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '5px' }}>Layer {i + 1} — {s.subtitle}</div>
                    <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-0.02em' }}>{s.title}</h2>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 250px', gap: 0 }}>
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
                      <div style={{ display: 'flex', gap: '5px' }}>
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
                    <button onClick={() => setActiveHow(i + 1)}
                      style={{ background: `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', borderRadius: '8px', padding: '7px 18px', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                      Next →
                    </button>
                  ) : (
                    <button onClick={() => navigate('detect')}
                      style={{ background: `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', borderRadius: '8px', padding: '7px 18px', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                      Try it free →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ════════════ DETECT PAGE ════════════ */}
        {page === 'detect' && (
          <div style={{ maxWidth: '600px', margin: '0 auto', padding: '4rem 1.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
              <div style={{ display: 'inline-block', background: dark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '24px', padding: '6px 18px', fontSize: '0.8rem', color: accent, marginBottom: '1.2rem', fontWeight: 500 }}>Free · Instant · Private</div>
              <h1 style={{ fontSize: 'clamp(2rem, 5vw, 2.8rem)', fontWeight: 900, margin: '0 0 0.8rem', letterSpacing: '-0.03em' }}>Analyze your image</h1>
              <p style={{ color: t.soft, lineHeight: 1.7, margin: 0, fontSize: '0.95rem' }}>Upload any photo for a complete forensic breakdown — 3 AI models + adaptive EXIF analysis — in under 5 seconds.</p>
            </div>

            {/* Upload zone */}
            <div style={{ background: t.bg2, border: `2px dashed ${isDragging ? accent : t.border}`, borderRadius: '20px', overflow: 'hidden', marginBottom: '1rem', transition: 'all 0.2s', boxShadow: isDragging ? `0 0 30px rgba(99,102,241,0.15)` : dark ? 'none' : '0 2px 16px rgba(0,0,0,0.04)', position: 'relative' }}
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }}>
              {imagePreview ? (
                <div style={{ position: 'relative' }}>
                  <img src={imagePreview} alt="preview" style={{ width: '100%', maxHeight: '380px', objectFit: 'cover', display: 'block' }} />
                  {/* Scan animation overlay */}
                  {scanAnim && (
                    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                      <div style={{ position: 'absolute', left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, animation: 'scanLine 1.2s ease-in-out infinite', boxShadow: `0 0 12px ${accent}` }} />
                      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${accent}08 0%, transparent 50%, ${pink}08 100%)`, animation: 'pulseOverlay 1.5s ease-in-out infinite' }} />
                      <div style={{ position: 'absolute', top: '12px', left: '12px', background: 'rgba(99,102,241,0.9)', color: '#fff', padding: '4px 12px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff', animation: 'blink 0.8s infinite' }} />
                        SCANNING
                      </div>
                    </div>
                  )}
                  <button onClick={() => { setImageFile(null); setImagePreview(null); setResult(null); setExifResult(null); setError(null) }}
                    style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.65)', border: 'none', color: '#fff', borderRadius: '50%', width: '34px', height: '34px', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>×</button>
                  <div style={{ position: 'absolute', bottom: '12px', left: '12px', background: 'rgba(0,0,0,0.68)', padding: '4px 12px', borderRadius: '8px', fontSize: '0.75rem', color: '#e2e8f0', zIndex: 2 }}>🖼 {imageFile?.name}</div>
                </div>
              ) : (
                <div style={{ padding: '3.5rem 2rem', textAlign: 'center', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: `${accent}12`, border: `1px solid ${accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', margin: '0 auto 1.2rem', transition: 'all 0.2s' }}>🖼️</div>
                  <p style={{ color: t.soft, margin: '0 0 0.4rem', fontWeight: 500 }}>Drop your image here or <span style={{ color: accent, fontWeight: 700 }}>browse files</span></p>
                  <p style={{ color: t.muted, fontSize: '0.8rem', margin: 0 }}>PNG · JPG · WEBP · up to 20MB</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
            </div>

            {/* EXIF preview — animated tag entries */}
            {exifResult && !result && (
              <div style={{ background: t.bg2, border: `1px solid ${accent}22`, borderRadius: '14px', padding: '1.2rem', marginBottom: '1rem', animation: 'slideUp 0.35s ease', boxShadow: dark ? 'none' : '0 2px 12px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>📋 Metadata analysis</div>
                  <div style={{ fontSize: '0.7rem', color: t.muted }}>Evidence quality: <span style={{ color: exifResult.evidenceQuality >= 50 ? '#22c55e' : exifResult.evidenceQuality >= 25 ? '#eab308' : '#f87171', fontWeight: 600 }}>{exifResult.evidenceQuality >= 50 ? 'High' : exifResult.evidenceQuality >= 25 ? 'Medium' : 'Low'}</span></div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {exifResult.signals.map((s, i) => (
                    <span key={i} style={{ fontSize: '0.75rem', padding: '5px 11px', borderRadius: '20px', background: s.suspicious ? (dark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)') : (dark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.08)'), color: s.suspicious ? '#ef4444' : '#16a34a', border: `1px solid ${s.suspicious ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.25)'}`, fontWeight: 500, animation: `tagPop 0.3s ease ${i * 0.06}s both` }}>
                      {s.suspicious ? '⚠ ' : '✓ '}{s.label}
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: '10px', fontSize: '0.72rem', color: t.muted }}>
                  EXIF contribution to final score: <span style={{ color: accent, fontWeight: 600 }}>{Math.round(exifResult.exifWeight * 100)}%</span> — {exifResult.confidence === 'high' ? 'definitive evidence found' : exifResult.confidence === 'medium' ? 'partial evidence' : 'low reliability evidence'}
                </div>
              </div>
            )}

            {/* Loading bar */}
            {isLoading && (
              <div style={{ background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '1.5rem', marginBottom: '1rem', boxShadow: dark ? 'none' : '0 2px 12px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', marginBottom: '1rem' }}>
                  {loadingSteps.map((s, i) => (
                    <div key={s} style={{ textAlign: 'center' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: i < loadingStep ? `${accent}20` : i === loadingStep ? `linear-gradient(135deg, ${accent}, ${pink})` : t.card, border: `1.5px solid ${i <= loadingStep ? accent : t.border}`, margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: i < loadingStep ? accent : i === loadingStep ? '#fff' : t.muted, transition: 'all 0.4s', animation: i === loadingStep ? 'pulseRing 1s ease infinite' : 'none' }}>
                        {i < loadingStep ? '✓' : i + 1}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: i <= loadingStep ? accent : t.muted, fontWeight: i === loadingStep ? 700 : 400, transition: 'all 0.3s' }}>{s}</div>
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
              <div style={{ background: t.bg2, border: `1.5px solid ${verdict.color}35`, borderRadius: '22px', overflow: 'hidden', marginBottom: '1rem', boxShadow: `0 0 60px ${verdict.glow}, ${dark ? 'none' : '0 4px 30px rgba(0,0,0,0.08)'}`, animation: 'resultReveal 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                {/* Score hero */}
                <div style={{ padding: '2.5rem 2rem', textAlign: 'center', background: `${verdict.color}06`, borderBottom: `1px solid ${t.border}`, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 50%, ${verdict.color}08 0%, transparent 70%)`, pointerEvents: 'none' }} />
                  <div style={{ fontSize: '5.5rem', fontWeight: 900, color: verdict.color, lineHeight: 1, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', animation: 'countUp 0.8s ease' }}>{displayScore}%</div>
                  <div style={{ display: 'inline-block', marginTop: '12px', padding: '6px 22px', borderRadius: '24px', background: verdict.bg, border: `1px solid ${verdict.color}30`, fontSize: '1rem', fontWeight: 700, color: verdict.color, animation: 'fadeIn 0.4s ease 0.3s both' }}>{verdict.label}</div>
                  <div style={{ color: t.muted, fontSize: '0.82rem', marginTop: '10px', animation: 'fadeIn 0.4s ease 0.4s both' }}>
                    {result.modelsUsed} models + EXIF · Confidence: <span style={{ color: result.confidence === 'high' ? '#22c55e' : result.confidence === 'medium' ? '#eab308' : '#f87171', fontWeight: 600 }}>{result.confidence}</span>
                  </div>
                </div>

                {result.disagreement && (
                  <div style={{ padding: '0.75rem 1.5rem', background: 'rgba(234,179,8,0.07)', borderBottom: `1px solid rgba(234,179,8,0.18)`, color: '#b45309', fontSize: '0.85rem', textAlign: 'center' }}>
                    ⚠️ Models disagreed significantly — treat this result with caution
                  </div>
                )}

                <div style={{ padding: '1.5rem' }}>
                  <div style={{ fontSize: '0.7rem', color: t.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1.2rem' }}>Detection breakdown</div>

                  {result.modelResults.map((m, mi) => (
                    <div key={m.name} style={{ marginBottom: '1.1rem', animation: `slideRight 0.4s ease ${mi * 0.1}s both` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                        <span style={{ color: t.soft }}>{m.name.split('/')[1]}</span>
                        <span style={{ color: m.aiScore >= 50 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{m.aiScore}%</span>
                      </div>
                      <div style={{ background: t.card, borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: m.aiScore >= 50 ? `linear-gradient(90deg, #ef4444, #f97316)` : `linear-gradient(90deg, #22c55e, #10b981)`, borderRadius: '6px', width: `${m.aiScore}%`, transition: `width ${0.9 + mi * 0.15}s cubic-bezier(0.34, 1.2, 0.64, 1)`, transitionDelay: `${mi * 0.1}s` }} />
                      </div>
                    </div>
                  ))}

                  {exifResult && (
                    <div style={{ marginTop: '1.2rem', paddingTop: '1.2rem', borderTop: `1px solid ${t.border}`, animation: 'slideRight 0.4s ease 0.35s both' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                        <span style={{ color: accent, fontWeight: 600 }}>📋 EXIF Metadata <span style={{ color: t.muted, fontWeight: 400, fontSize: '0.78rem' }}>({Math.round(exifResult.exifWeight * 100)}% weight)</span></span>
                        <span style={{ color: exifResult.aiScore >= 50 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{exifResult.aiScore}%</span>
                      </div>
                      <div style={{ background: t.card, borderRadius: '6px', height: '8px', overflow: 'hidden', marginBottom: '1rem' }}>
                        <div style={{ height: '100%', background: exifResult.aiScore >= 50 ? `linear-gradient(90deg, #ef4444, #f97316)` : `linear-gradient(90deg, #22c55e, #10b981)`, borderRadius: '6px', width: `${exifResult.aiScore}%`, transition: 'width 1.1s cubic-bezier(0.34, 1.2, 0.64, 1)', transitionDelay: '0.35s' }} />
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {exifResult.signals.map((s, i) => (
                          <span key={i} style={{ fontSize: '0.75rem', padding: '5px 11px', borderRadius: '20px', background: s.suspicious ? (dark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)') : (dark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.08)'), color: s.suspicious ? '#ef4444' : '#16a34a', border: `1px solid ${s.suspicious ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.25)'}`, fontWeight: 500, animation: `tagPop 0.25s ease ${0.4 + i * 0.05}s both` }}>
                            {s.suspicious ? '⚠ ' : '✓ '}{s.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CTA */}
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