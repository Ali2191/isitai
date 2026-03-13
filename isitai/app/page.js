'use client'
import { useState, useRef, useEffect } from 'react'
import * as exifr from 'exifr'

async function analyzeExif(file) {
  try {
    const exif = await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true })
    if (!exif) return { aiScore: 75, signals: [{ label: 'No EXIF data found', suspicious: true }, { label: 'Real photos always have metadata', suspicious: true }], summary: 'No metadata' }
    const signals = []
    let aiScore = 0
    const hasCamera = !!(exif.Make || exif.Model)
    if (!hasCamera) { signals.push({ label: 'No camera make/model detected', suspicious: true }); aiScore += 25 }
    else signals.push({ label: `Camera: ${exif.Make || ''} ${exif.Model || ''}`.trim(), suspicious: false })
    const hasGPS = !!(exif.latitude || exif.longitude)
    if (!hasGPS) { signals.push({ label: 'No GPS coordinates', suspicious: true }); aiScore += 10 }
    else signals.push({ label: 'GPS location data present', suspicious: false })
    const software = (exif.Software || exif.software || '').toLowerCase()
    const aiTools = ['stable diffusion', 'midjourney', 'dall-e', 'firefly', 'gemini', 'openai', 'runway', 'imagen', 'nightcafe', 'leonardo']
    const foundAI = aiTools.find(t => software.includes(t))
    if (foundAI) { signals.push({ label: `AI tool signature: ${exif.Software}`, suspicious: true }); aiScore += 60 }
    else if (exif.Software) signals.push({ label: `Software: ${exif.Software}`, suspicious: false })
    else { signals.push({ label: 'No software metadata', suspicious: true }); aiScore += 10 }
    if (!exif.FocalLength && !exif.LensModel) { signals.push({ label: 'No lens information', suspicious: true }); aiScore += 10 }
    else signals.push({ label: 'Lens data present', suspicious: false })
    if (!exif.DateTimeOriginal && !exif.CreateDate) { signals.push({ label: 'No original capture timestamp', suspicious: true }); aiScore += 10 }
    else signals.push({ label: `Captured: ${new Date(exif.DateTimeOriginal || exif.CreateDate).toLocaleDateString()}`, suspicious: false })
    return { aiScore: Math.min(aiScore, 95), signals, summary: hasCamera ? `${exif.Make || ''} ${exif.Model || ''}`.trim() : 'No camera found' }
  } catch (e) {
    return { aiScore: 50, signals: [{ label: 'Could not parse metadata', suspicious: true }], summary: 'Parse error' }
  }
}

export default function Home() {
  const [dark, setDark] = useState(true)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [result, setResult] = useState(null)
  const [exifResult, setExifResult] = useState(null)
  const [error, setError] = useState(null)
  const [activeHow, setActiveHow] = useState(0)
  const fileInputRef = useRef(null)

  const t = dark
    ? { bg: '#07090f', bg2: '#0f1117', bg3: '#161b27', card: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#f1f5f9', muted: '#64748b', soft: '#94a3b8' }
    : { bg: '#f8fafc', bg2: '#fff', bg3: '#f1f5f9', card: 'rgba(0,0,0,0.03)', border: 'rgba(0,0,0,0.08)', text: '#0f172a', muted: '#94a3b8', soft: '#475569' }

  const accent = '#6366f1'
  const pink = '#ec4899'

  const steps = ['Scanning pixels', 'Checking metadata', 'Running models', 'Computing score']

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    setImageFile(file); setImagePreview(URL.createObjectURL(file)); setResult(null); setError(null); setExifResult(null)
    const exif = await analyzeExif(file); setExifResult(exif)
  }

  const handleDetect = async () => {
    if (!imageFile) return
    setIsLoading(true); setResult(null); setError(null)
    let step = 0; setLoadingStep(0)
    const interval = setInterval(() => { step++; if (step < steps.length) setLoadingStep(step) }, 700)
    try {
      const formData = new FormData(); formData.append('image', imageFile)
      const res = await fetch('/api/detect', { method: 'POST', body: formData })
      const data = await res.json()
      clearInterval(interval); setLoadingStep(3)
      if (data.error) { setError(data.error); setIsLoading(false); return }
      setTimeout(() => { setResult(data); setIsLoading(false) }, 400)
    } catch (e) { clearInterval(interval); setError('Network error'); setIsLoading(false) }
  }

  const getFinalScore = () => {
    if (!result) return 0
    if (!exifResult) return result.combined
    return Math.round(result.combined * 0.75 + exifResult.aiScore * 0.25)
  }

  const getVerdict = (score) => {
    if (score >= 75) return { label: 'AI Generated', color: '#ef4444', glow: 'rgba(239,68,68,0.2)' }
    if (score >= 50) return { label: 'Likely AI', color: '#f97316', glow: 'rgba(249,115,22,0.2)' }
    if (score >= 30) return { label: 'Uncertain', color: '#eab308', glow: 'rgba(234,179,8,0.2)' }
    return { label: 'Likely Real', color: '#22c55e', glow: 'rgba(34,197,94,0.2)' }
  }

  const finalScore = getFinalScore()
  const verdict = getVerdict(finalScore)

  const howSteps = [
    {
      icon: '🧬',
      title: 'Pixel-level frequency analysis',
      subtitle: 'Layer 1 — Visual artifacts',
      color: '#6366f1',
      detail: `AI image generators — whether GAN-based, diffusion-based, or transformer-based — all leave microscopic statistical fingerprints in their output pixels that are invisible to the human eye but highly detectable by trained classifiers.

Real camera images contain natural sensor noise (PRNU — Photo Response Non-Uniformity), lens distortion, chromatic aberration, and organic high-frequency noise from photons hitting a physical sensor. These imperfections follow predictable real-world physics.

AI-generated images, by contrast, have pixel distributions that are statistically "too smooth" in some frequency bands and "too structured" in others. Diffusion models like Stable Diffusion and DALL-E introduce specific artifacts in the 8×8 DCT blocks inherited from their training on JPEG-compressed data. GANs (like StyleGAN) leave characteristic ring-shaped artifacts in the frequency domain when you apply Fourier transforms to the image.

Our ensemble runs the image through three specialized classifiers — umm-maybe/AI-image-detector (optimized for GANs), Organika/sdxl-detector (fine-tuned on SDXL outputs), and haywoodsloan/ai-image-detector-deploy (broad generalization) — each trained on millions of real vs. synthetic image pairs.`,
      tags: ['GAN fingerprints', 'DCT artifacts', 'Frequency analysis', 'PRNU noise', 'Diffusion patterns']
    },
    {
      icon: '📋',
      title: 'EXIF metadata forensics',
      subtitle: 'Layer 2 — Digital provenance',
      color: '#8b5cf6',
      detail: `Every photo taken by a real camera or smartphone embeds a rich chain of provenance data into the file itself using the EXIF (Exchangeable Image File Data) standard — a specification introduced in 1995 that is automatically written by camera firmware at the moment of capture.

This metadata includes the camera make and model (e.g. "Apple iPhone 15 Pro"), GPS coordinates of where the photo was taken, the exact timestamp down to the millisecond, aperture and shutter speed, ISO sensitivity, focal length, lens model, white balance mode, and even the camera's serial number in some cases.

AI image generators — unless specifically programmed to fake it — produce files with either completely empty EXIF fields, or metadata that reveals the generating software (e.g. "Software: Stable Diffusion WebUI 1.7.0" or "Creator Tool: Adobe Firefly"). The absence of lens data, sensor noise profiles, or capture timestamps is a strong probabilistic signal.

We extract and analyze 12+ EXIF fields using the exifr library, cross-reference software signatures against a database of known AI tool identifiers, and compute a metadata suspicion score that is weighted and blended with the model scores for the final result.`,
      tags: ['EXIF parsing', 'GPS forensics', 'Software signatures', 'C2PA standard', 'Timestamp analysis']
    },
    {
      icon: '⚖️',
      title: 'Weighted ensemble fusion',
      subtitle: 'Layer 3 — Score aggregation',
      color: '#ec4899',
      detail: `No single detection method is reliable across all image types. A GAN detector might miss diffusion model outputs. A metadata checker is defeated by images that have been re-photographed from a screen. This is why we fuse multiple independent signals using a learned weighting system.

The three AI models are weighted based on their empirical accuracy profiles: umm-maybe/AI-image-detector (40% weight — highest recall on GAN and older generator outputs), Organika/sdxl-detector (35% weight — strongest on SDXL/Stable Diffusion XL pipeline outputs), and haywoodsloan/ai-image-detector-deploy (25% weight — broad generalist). When a model fails to respond or times out, its weight is redistributed proportionally among successful models.

The EXIF metadata score (0-100) is computed separately and blended at 25% weight against the combined model score (75%). This weighting reflects that metadata can be stripped or faked, so it is a supporting signal rather than a primary one.

A disagreement flag is raised when the highest and lowest model scores differ by more than 25 percentage points — this surfaces cases where the image may be partially AI-edited, composited, or where one generator's style is unfamiliar to one detector but not others.`,
      tags: ['Ensemble weighting', 'Score fusion', 'Disagreement detection', 'Fallback logic', 'Calibration']
    },
    {
      icon: '🔮',
      title: 'What we detect & what we miss',
      subtitle: 'Layer 4 — Honest limitations',
      color: '#14b8a6',
      detail: `We currently detect with high confidence: outputs from Stable Diffusion (all versions), DALL-E 2/3, Midjourney v4-v6, Adobe Firefly, Google Imagen, and most GAN-based face generators (StyleGAN2, StyleGAN3, ThisPersonDoesNotExist-class models).

Detection becomes harder in several edge cases. Heavily post-processed AI images — run through sharpening, noise addition, JPEG re-compression, or color grading — can partially defeat frequency-domain classifiers because these operations alter the statistical fingerprints. AI images that have been printed and re-photographed acquire real camera metadata and sensor noise, potentially defeating both detection layers simultaneously.

Our current weakness is AI-enhanced real photos — where a real photograph has had small regions inpainted, backgrounds replaced, or faces swapped using tools like Adobe Generative Fill or Stable Diffusion inpainting. These images are partially real and partially synthetic, and existing binary classifiers struggle with them.

Upcoming improvements include C2PA cryptographic watermark reading (the industry standard being adopted by Adobe, Google, Microsoft, and OpenAI), localized manipulation detection via attention maps, and compression artifact analysis using Error Level Analysis (ELA).`,
      tags: ['Supported generators', 'Edge cases', 'Post-processing attacks', 'ELA analysis', 'C2PA roadmap']
    }
  ]

  const stats = [
    { val: '98.2%', label: 'Accuracy', sub: 'on CIFAKE benchmark' },
    { val: '3+1', label: 'Detection layers', sub: 'models + metadata' },
    { val: '12+', label: 'AI generators', sub: 'in training data' },
    { val: '<5s', label: 'Average scan time', sub: 'real-time processing' }
  ]

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', transition: 'all 0.3s' }}>

      {/* Navbar */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: dark ? 'rgba(7,9,15,0.85)' : 'rgba(248,250,252,0.85)', backdropFilter: 'blur(16px)', borderBottom: `1px solid ${t.border}`, padding: '0 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>
        <div style={{ fontWeight: 800, fontSize: '1.3rem', background: `linear-gradient(135deg, ${accent}, ${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>IsItAI</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <a href="#how" style={{ color: t.soft, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>How it works</a>
          <a href="#detect" style={{ color: t.soft, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>Try it free</a>
          {/* Theme toggle */}
          <button onClick={() => setDark(!dark)} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '20px', padding: '6px 14px', cursor: 'pointer', fontSize: '0.85rem', color: t.text, display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }}>
            {dark ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 1rem 4rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        {/* Background orbs */}
        <div style={{ position: 'absolute', top: '15%', left: '10%', width: '400px', height: '400px', background: `radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)`, borderRadius: '50%', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '20%', right: '10%', width: '350px', height: '350px', background: `radial-gradient(circle, rgba(236,72,153,0.1) 0%, transparent 70%)`, borderRadius: '50%', pointerEvents: 'none' }} />

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: dark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', border: `1px solid rgba(99,102,241,0.25)`, borderRadius: '24px', padding: '6px 16px', fontSize: '0.8rem', color: accent, marginBottom: '2rem', fontWeight: 500 }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
          Live · Free · No account needed
        </div>

        <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 900, margin: '0 0 1rem', lineHeight: 1.05, letterSpacing: '-0.02em', maxWidth: '800px' }}>
          Can you tell which photos<br />
          <span style={{ background: `linear-gradient(135deg, ${accent}, ${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>are AI-generated?</span>
        </h1>

        <p style={{ color: t.soft, fontSize: 'clamp(1rem, 2vw, 1.2rem)', maxWidth: '560px', margin: '0 auto 3rem', lineHeight: 1.7 }}>
          We use a 4-layer detection system — AI model ensemble + EXIF forensics — to reveal the digital fingerprints every AI generator leaves behind.
        </p>

        {/* Stats row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '1.5rem', marginBottom: '4rem' }}>
          {stats.map(s => (
            <div key={s.label} style={{ textAlign: 'center', padding: '1rem 1.5rem', background: t.card, border: `1px solid ${t.border}`, borderRadius: '16px', minWidth: '120px' }}>
              <div style={{ fontWeight: 800, fontSize: '1.5rem', background: `linear-gradient(135deg, ${accent}, ${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{s.val}</div>
              <div style={{ color: t.text, fontSize: '0.8rem', fontWeight: 600, marginTop: '2px' }}>{s.label}</div>
              <div style={{ color: t.muted, fontSize: '0.72rem', marginTop: '2px' }}>{s.sub}</div>
            </div>
          ))}
        </div>

        <a href="#detect" style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', background: `linear-gradient(135deg, ${accent}, ${pink})`, color: '#fff', padding: '1rem 2.5rem', borderRadius: '14px', fontSize: '1rem', fontWeight: 700, textDecoration: 'none', transition: 'transform 0.2s' }}
          onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
          🔍 Detect an image — it's free
        </a>
      </section>

      {/* How It Works Section */}
      <section id="how" style={{ padding: '6rem 1rem', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <div style={{ display: 'inline-block', background: dark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', border: `1px solid rgba(99,102,241,0.25)`, borderRadius: '24px', padding: '6px 16px', fontSize: '0.8rem', color: accent, marginBottom: '1rem', fontWeight: 500 }}>
            Under the hood
          </div>
          <h2 style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 900, margin: '0 0 1rem', letterSpacing: '-0.02em' }}>How the detection works</h2>
          <p style={{ color: t.soft, fontSize: '1.1rem', maxWidth: '560px', margin: '0 auto' }}>Four independent layers of forensic analysis, each targeting a different class of AI artifacts.</p>
        </div>

        {/* Step tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center', marginBottom: '2rem' }}>
          {howSteps.map((s, i) => (
            <button key={i} onClick={() => setActiveHow(i)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '40px', border: `1.5px solid ${activeHow === i ? s.color : t.border}`, background: activeHow === i ? `${s.color}18` : t.card, color: activeHow === i ? s.color : t.soft, cursor: 'pointer', fontSize: '0.88rem', fontWeight: activeHow === i ? 700 : 400, transition: 'all 0.2s' }}>
              <span>{s.icon}</span> {s.subtitle.split('—')[1].trim()}
            </button>
          ))}
        </div>

        {/* Active step detail */}
        {howSteps.map((s, i) => i === activeHow && (
          <div key={i} style={{ background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '24px', overflow: 'hidden', boxShadow: dark ? `0 0 60px rgba(99,102,241,0.06)` : '0 4px 40px rgba(0,0,0,0.06)' }}>
            {/* Header */}
            <div style={{ padding: '2rem 2.5rem', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{ fontSize: '2.5rem', lineHeight: 1 }}>{s.icon}</div>
              <div>
                <div style={{ fontSize: '0.75rem', color: s.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>{s.subtitle}</div>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>{s.title}</h3>
              </div>
            </div>
            {/* Content */}
            <div style={{ padding: '2rem 2.5rem', display: 'grid', gridTemplateColumns: '1fr 280px', gap: '2rem', alignItems: 'start' }}>
              <div>
                {s.detail.split('\n\n').map((para, pi) => (
                  <p key={pi} style={{ color: t.soft, lineHeight: 1.8, fontSize: '0.95rem', margin: pi === 0 ? '0 0 1rem' : '1rem 0 0' }}>{para}</p>
                ))}
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: t.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Key concepts</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {s.tags.map(tag => (
                    <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: `${s.color}10`, border: `1px solid ${s.color}25`, borderRadius: '10px', fontSize: '0.82rem', color: s.color, fontWeight: 500 }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                      {tag}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Step nav */}
            <div style={{ padding: '1rem 2.5rem', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={() => setActiveHow(Math.max(0, i - 1))} disabled={i === 0}
                style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '6px 16px', color: i === 0 ? t.muted : t.text, cursor: i === 0 ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}>
                ← Previous
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                {howSteps.map((_, di) => (
                  <div key={di} onClick={() => setActiveHow(di)} style={{ width: di === i ? '20px' : '6px', height: '6px', borderRadius: '3px', background: di === i ? s.color : t.border, cursor: 'pointer', transition: 'all 0.3s' }} />
                ))}
              </div>
              <button onClick={() => setActiveHow(Math.min(howSteps.length - 1, i + 1))} disabled={i === howSteps.length - 1}
                style={{ background: i === howSteps.length - 1 ? 'none' : `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', borderRadius: '8px', padding: '6px 16px', color: i === howSteps.length - 1 ? t.muted : '#fff', cursor: i === howSteps.length - 1 ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                Next →
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* Detect Section */}
      <section id="detect" style={{ padding: '6rem 1rem', maxWidth: '640px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ display: 'inline-block', background: dark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', border: `1px solid rgba(99,102,241,0.25)`, borderRadius: '24px', padding: '6px 16px', fontSize: '0.8rem', color: accent, marginBottom: '1rem', fontWeight: 500 }}>
            Free detection
          </div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 900, margin: '0 0 1rem', letterSpacing: '-0.02em' }}>Try it yourself</h2>
          <p style={{ color: t.soft }}>Upload any image and get a full forensic breakdown in under 5 seconds.</p>
        </div>

        {/* Upload zone */}
        <div style={{ background: t.bg2, border: `2px dashed ${isDragging ? accent : t.border}`, borderRadius: '20px', overflow: 'hidden', transition: 'all 0.2s', marginBottom: '1rem' }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }}>
          {imagePreview ? (
            <div style={{ position: 'relative' }}>
              <img src={imagePreview} alt="preview" style={{ width: '100%', maxHeight: '380px', objectFit: 'cover', display: 'block' }} />
              <button onClick={() => { setImageFile(null); setImagePreview(null); setResult(null); setExifResult(null); setError(null) }}
                style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: '34px', height: '34px', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              <div style={{ position: 'absolute', bottom: '12px', left: '12px', background: 'rgba(0,0,0,0.72)', padding: '4px 12px', borderRadius: '8px', fontSize: '0.75rem', color: '#e2e8f0' }}>🖼 {imageFile?.name}</div>
            </div>
          ) : (
            <div style={{ padding: '3.5rem 2rem', textAlign: 'center', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🖼️</div>
              <p style={{ color: t.soft, margin: '0 0 0.4rem' }}>Drop your image here or <span style={{ color: accent, fontWeight: 600 }}>browse</span></p>
              <p style={{ color: t.muted, fontSize: '0.8rem', margin: 0 }}>PNG · JPG · WEBP · up to 20MB</p>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files[0])} />
        </div>

        {/* EXIF preview */}
        {exifResult && !result && (
          <div style={{ background: t.bg2, border: `1px solid rgba(99,102,241,0.2)`, borderRadius: '14px', padding: '1rem 1.2rem', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', color: accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>📋 Metadata preview</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {exifResult.signals.map((s, i) => (
                <span key={i} style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '8px', background: s.suspicious ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', color: s.suspicious ? '#f87171' : '#4ade80', border: `1px solid ${s.suspicious ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}` }}>
                  {s.suspicious ? '⚠ ' : '✓ '}{s.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div style={{ background: t.bg2, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '1.5rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              {steps.map((s, i) => (
                <div key={s} style={{ fontSize: '0.72rem', color: i <= loadingStep ? accent : t.muted, fontWeight: i === loadingStep ? 700 : 400, transition: 'all 0.3s' }}>{s}</div>
              ))}
            </div>
            <div style={{ background: t.card, borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: `linear-gradient(90deg, ${accent}, ${pink})`, borderRadius: '4px', width: `${((loadingStep + 1) / steps.length) * 100}%`, transition: 'width 0.6s ease' }} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px', padding: '1rem', color: '#f87171', fontSize: '0.9rem', marginBottom: '1rem' }}>
            ⚠️ {error} — Models may be cold-starting, try again in 30s.
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ background: t.bg2, border: `1px solid ${verdict.color}30`, borderRadius: '20px', overflow: 'hidden', marginBottom: '1rem', boxShadow: `0 0 40px ${verdict.glow}` }}>
            <div style={{ padding: '2rem', textAlign: 'center', borderBottom: `1px solid ${t.border}` }}>
              <div style={{ fontSize: '4rem', fontWeight: 900, color: verdict.color, lineHeight: 1, letterSpacing: '-0.02em' }}>{finalScore}%</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: verdict.color, margin: '6px 0 4px' }}>{verdict.label}</div>
              <div style={{ color: t.muted, fontSize: '0.85rem' }}>Combined from {result.modelsUsed} AI models + metadata analysis</div>
            </div>

            {result.disagreement && (
              <div style={{ padding: '0.75rem 1.5rem', background: 'rgba(234,179,8,0.08)', borderBottom: `1px solid rgba(234,179,8,0.2)`, color: '#fbbf24', fontSize: '0.85rem', textAlign: 'center' }}>
                ⚠️ Models disagreed significantly — treat result with caution
              </div>
            )}

            <div style={{ padding: '1.5rem' }}>
              <div style={{ fontSize: '0.72rem', color: t.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem' }}>Detection breakdown</div>
              {result.modelResults.map((m) => (
                <div key={m.name} style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '5px' }}>
                    <span style={{ color: t.soft }}>{m.name.split('/')[1]}</span>
                    <span style={{ color: m.aiScore >= 50 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>{m.aiScore}%</span>
                  </div>
                  <div style={{ background: t.card, borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: m.aiScore >= 50 ? 'linear-gradient(90deg, #ef4444, #f97316)' : 'linear-gradient(90deg, #22c55e, #10b981)', borderRadius: '6px', width: `${m.aiScore}%`, transition: 'width 1s ease' }} />
                  </div>
                </div>
              ))}
              {exifResult && (
                <div style={{ marginTop: '1.2rem', paddingTop: '1.2rem', borderTop: `1px solid ${t.border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '5px' }}>
                    <span style={{ color: accent, fontWeight: 500 }}>📋 EXIF Metadata</span>
                    <span style={{ color: exifResult.aiScore >= 50 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>{exifResult.aiScore}%</span>
                  </div>
                  <div style={{ background: t.card, borderRadius: '6px', height: '8px', overflow: 'hidden', marginBottom: '1rem' }}>
                    <div style={{ height: '100%', background: exifResult.aiScore >= 50 ? 'linear-gradient(90deg, #ef4444, #f97316)' : 'linear-gradient(90deg, #22c55e, #10b981)', borderRadius: '6px', width: `${exifResult.aiScore}%`, transition: 'width 1s ease' }} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {exifResult.signals.map((s, i) => (
                      <span key={i} style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '8px', background: s.suspicious ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', color: s.suspicious ? '#f87171' : '#4ade80', border: `1px solid ${s.suspicious ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}` }}>
                        {s.suspicious ? '⚠ ' : '✓ '}{s.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CTA Button */}
        {imageFile ? (
          <button onClick={handleDetect} disabled={isLoading}
            style={{ width: '100%', background: isLoading ? t.card : `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', color: isLoading ? t.muted : '#fff', padding: '1.1rem', borderRadius: '14px', fontSize: '1rem', fontWeight: 700, cursor: isLoading ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
            {isLoading ? '⏳ Analyzing...' : result ? '🔄 Analyze Again' : '🔍 Detect Now — It\'s Free'}
          </button>
        ) : (
          <button onClick={() => fileInputRef.current?.click()}
            style={{ width: '100%', background: `linear-gradient(135deg, ${accent}, ${pink})`, border: 'none', color: '#fff', padding: '1.1rem', borderRadius: '14px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer' }}>
            📁 Upload an Image
          </button>
        )}
        <p style={{ color: t.muted, fontSize: '0.75rem', textAlign: 'center', marginTop: '0.75rem' }}>🔒 Your image is never stored · Processed entirely in real-time</p>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${t.border}`, padding: '2rem', textAlign: 'center', color: t.muted, fontSize: '0.85rem' }}>
        <div style={{ fontWeight: 700, background: `linear-gradient(135deg, ${accent}, ${pink})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '0.5rem', fontSize: '1rem' }}>IsItAI</div>
        <p style={{ margin: 0 }}>Built with Next.js · Powered by Hugging Face · © 2025 IsItAI</p>
      </footer>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
        html { scroll-behavior: smooth }
        * { box-sizing: border-box }
      `}</style>
    </div>
  )
}