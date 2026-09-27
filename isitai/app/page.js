'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import HeatmapOverlay from './components/HeatmapOverlay'
import { ToolNav } from './components/ToolChrome'

// ─── Plain monochrome palette. Color is reserved for nothing; hierarchy comes
//     from weight, size and hairline rules. ────────────────────────────────────
const ink = '#161616'          // primary text
const inkSoft = '#5c5c5c'      // secondary text
const inkFaint = '#8a8a8a'     // tertiary / captions
const line = '#e3e3e3'         // hairline borders
const surface = '#fafafa'      // subtle fills

// ─── Verdict copy + plain-text markers (server returns level/line1) ──────────
function verdictText(result) {
  const s = result.score, v = result.verdict || {}
  switch (v.level) {
    case 'definitive-ai': return { line2: `High-confidence evidence across multiple layers puts AI probability at ${s}% (band ${result.band?.label}).`, sub: 'Strong generator fingerprints were found in metadata, pixels and/or model scores.' }
    case 'likely-ai': return { line2: `We estimate a ${s}% chance this image is AI-generated (uncertainty band ${result.band?.label}).`, sub: 'More evidence points toward generation than authentic capture.' }
    case 'uncertain': return { line2: `Signals are mixed — ${s}% lean toward AI, with an uncertainty band of ${result.band?.label}.`, sub: 'This image may be AI-enhanced, heavily edited, re-uploaded, or from an unfamiliar generator.' }
    case 'likely-real': return { line2: `We estimate only a ${s}% chance of AI generation (band ${result.band?.label}).`, sub: 'Most detection layers found no significant AI indicators.' }
    case 'definitive-real': return { line2: `Nearly all forensic layers agree: ${100 - s >= 90 ? '>90' : 100 - s}% confidence this is a genuine camera photo.`, sub: 'Rich provenance metadata and natural pixel statistics detected.' }
    default: return { line2: `AI probability: ${s}% (band ${result.band?.label}).`, sub: '' }
  }
}

const VMARK = {
  'definitive-ai': { mark: '[!]', note: 'High AI probability' },
  'likely-ai': { mark: '[!]', note: 'Leans AI-generated' },
  'uncertain': { mark: '[?]', note: 'Mixed evidence' },
  'likely-real': { mark: '[OK]', note: 'Likely a real photo' },
  'definitive-real': { mark: '[OK]', note: 'Genuine camera photo' },
}
const vmark = level => VMARK[level] || { mark: '[?]', note: 'No verdict' }

// ─── Session history (localStorage, results only — never images) ─────────────
const HISTORY_KEY = 'isitai_history_v1'
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [] } catch { return [] }
}

export default function Home() {
  const [page, setPage] = useState('home')
  const [mode, setMode] = useState('upload')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [urlInput, setUrlInput] = useState('')
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [displayScore, setDisplayScore] = useState(0)
  const [activeHow, setActiveHow] = useState(0)
  const [loadingStep, setLoadingStep] = useState(0)
  const [scanAnim, setScanAnim] = useState(false)
  const [history, setHistory] = useState([])
  const [batchFiles, setBatchFiles] = useState([])
  const [batchIndex, setBatchIndex] = useState(-1)
  const [localMode, setLocalMode] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareUrl, setShareUrl] = useState(null)
  const [feedbackSent, setFeedbackSent] = useState(null)
  const fileInputRef = useRef(null)
  const batchInputRef = useRef(null)
  const featuresRef = useRef(null)
  const [featuresInView, setFeaturesInView] = useState(false)

  useEffect(() => {
    const el = featuresRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => e.isIntersecting && setFeaturesInView(true), { threshold: 0.12 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [page])

  useEffect(() => {
    if (!result) return
    let raf, start = null
    const dur = 700
    const step = ts => {
      if (!start) start = ts
      setDisplayScore(Math.min(100, Math.round((ts - start) / dur * 100)))
      if (ts - start < dur) raf = requestAnimationFrame(step)
    }
    cancelAnimationFrame(raf)
    setDisplayScore(0)
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [result])

  useEffect(() => {
    if (!isLoading) { setScanAnim(false); return }
    setScanAnim(true)
    const t = setTimeout(() => setScanAnim(false), 4000)
    return () => clearTimeout(t)
  }, [isLoading])

  useEffect(() => {
    if (!isLoading) { setLoadingStep(0); return }
    const timers = [setTimeout(() => setLoadingStep(1), 300), setTimeout(() => setLoadingStep(2), 1200)]
    return () => timers.forEach(clearTimeout)
  }, [isLoading])

  useEffect(() => { setHistory(loadHistory()) }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const incoming = params.get('url')
    if (!incoming) return
    setMode('url')
    setUrlInput(incoming)
    if (params.get('auto') === '1') window.setTimeout(() => document.querySelector('[data-auto-detect]')?.click(), 0)
  }, [])

  const bg = '#ffffff'
  const border = line
  const textPrimary = ink
  const textMuted = inkFaint
  const textSoft = inkSoft
  const loadingSteps = ['Preparing image', 'Running models + forensics', 'Fusing signals']

  const navigate = p => {
    setPage(p); setShowDetails(false); setShareUrl(null); setFeedbackSent(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function pushHistory(res, name) {
    const entry = { id: res.id, score: res.score, level: res.verdict?.level, line1: res.verdict?.line1, local: !!res.local, at: res.analyzedAt || Date.now(), name: String(name || '').slice(0, 60) }
    const next = [entry, ...loadHistory()].slice(0, 12)
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* storage full/blocked */ }
    setHistory(next)
  }

  const handleFile = f => {
    if (!f) return
    if (!f.type.startsWith('image/')) { setError('Please select an image file.'); return }
    if (f.size > 20 * 1024 * 1024) { setError('Image too large (max 20 MB).'); return }
    setError(null); setImageFile(f); setResult(null); setFeedbackSent(null); setShareUrl(null)
    const r = new FileReader()
    r.onload = e => setImagePreview(e.target.result)
    r.readAsDataURL(f)
  }

  const clearImage = () => { setImageFile(null); setImagePreview(null); setResult(null); setFeedbackSent(null); setShareUrl(null) }

  async function analyzeImage(file, url) {
    let res
    if (file) {
      const form = new FormData()
      form.append('image', file)
      res = await fetch('/api/detect', { method: 'POST', body: form })
    } else {
      res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
    }
    // If the server returns HTML (e.g. a 404 page or error document), res.json()
    // would throw "Unexpected token '<'" — surface a clear message instead.
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) {
      throw new Error(`Server returned an unexpected response (HTTP ${res.status}). Please try again.`)
    }
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Analysis failed.')
    return data
  }

  async function analyzeLocal(file) {
    const { detectLocally } = await import('../lib/localDetect')
    return detectLocally(file)
  }

  const handleDetect = async () => {
    if (mode === 'url' && !urlInput.trim()) { setError('Please enter an image URL.'); return }
    if (mode === 'upload' && !imageFile) { setError('Please upload an image first.'); return }
    if (localMode && mode === 'url') { setError('Local-only mode works with uploaded files, not URLs. Turn it off to analyze a link.'); return }
    setIsLoading(true); setError(null); setResult(null); setShowDetails(false); setFeedbackSent(null); setShareUrl(null)
    try {
      const data = localMode && imageFile
        ? await analyzeLocal(imageFile)
        : await analyzeImage(mode === 'upload' ? imageFile : null, mode === 'url' ? urlInput.trim() : null)
      setResult(data)
      pushHistory(data, mode === 'upload' ? imageFile?.name : urlInput.trim().split('/').pop())
    } catch (e) {
      setError(e.message || 'Something went wrong. Try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const addBatchFiles = list => {
    const files = Array.from(list || []).filter(f => f.type.startsWith('image/')).slice(0, 10 - batchFiles.length)
    if (!files.length) return
    setError(null)
    const items = files.map(f => ({ kind: 'file', file: f, name: f.name, preview: '', status: 'queued', result: null }))
    Promise.all(items.map(it => new Promise(resolve => {
      const r = new FileReader()
      r.onload = () => { it.preview = r.result; resolve() }
      r.onerror = () => resolve()
      r.readAsDataURL(it.file)
    }))).then(() => setBatchFiles(prev => [...prev, ...items].slice(0, 10)))
  }

  const addBatchUrl = () => {
    const u = urlInput.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) { setError('URLs must start with http:// or https://'); return }
    setBatchFiles(prev => prev.length >= 10 ? prev : [...prev, { kind: 'url', url: u, name: u.split('/').pop().slice(0, 60) || u, preview: '', status: 'queued', result: null }])
    setUrlInput(''); setError(null)
  }

  const handleBatch = async () => {
    if (!batchFiles.length) { setError('Add at least one image to the batch.'); return }
    if (localMode) { setError('Batch mode needs server analysis — turn off local-only mode.'); return }
    setIsLoading(true); setError(null); setResult(null)
    for (let i = 0; i < batchFiles.length; i++) {
      setBatchIndex(i)
      setBatchFiles(prev => prev.map((b, j) => j === i ? { ...b, status: 'pending' } : b))
      try {
        const b = batchFiles[i]
        const data = await analyzeImage(b.kind === 'file' ? b.file : null, b.kind === 'url' ? b.url : null)
        setBatchFiles(prev => prev.map((x, j) => j === i ? { ...x, status: 'done', result: data } : x))
        pushHistory(data, b.name)
      } catch (e) {
        setBatchFiles(prev => prev.map((x, j) => j === i ? { ...x, status: 'error', error: e.message } : x))
      }
    }
    setBatchIndex(-1)
    setIsLoading(false)
  }

  const handleShare = async () => {
    if (!result) return
    setSharing(true)
    try {
      const res = await fetch('/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result })
      })
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) throw new Error(`Share endpoint returned an unexpected response (HTTP ${res.status}).`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create share link.')
      const link = `${window.location.origin}/r/${data.id}`
      setShareUrl(link)
      try { await navigator.clipboard.writeText(link) } catch { /* clipboard blocked — link still shown */ }
    } catch (e) {
      setError(e.message || 'Could not create share link.')
    } finally {
      setSharing(false)
    }
  }

  const sendFeedback = async verdict => {
    if (!result) return
    try {
      await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: result.id, score: result.score, level: result.verdict?.level, degraded: !!result.degraded, modelsUsed: result.layers?.models?.results?.length || 0, judgement: verdict })
      })
    } catch { /* non-critical */ }
    setFeedbackSent(verdict)
  }

  const result_ = result
  const vstyle = result_ ? vmark(result_.verdict?.level) : null
  const verdict = result_ ? { ...(result_.verdict || {}), ...verdictText(result_) } : null
  const layerDefs = result_ ? [
    { icon: 'M', title: 'Metadata & Provenance', layer: result_.layers?.metadata },
    { icon: 'P', title: 'Pixel Forensics', layer: result_.layers?.pixels },
    { icon: 'N', title: 'Sensor Noise (PRNU) & Compression', layer: result_.layers?.noise },
    { icon: 'A', title: 'Anatomy Checks', layer: result_.layers?.anatomy },
    { icon: 'F', title: 'File Structure', layer: result_.layers?.structure },
    { icon: 'D', title: 'Dimensions', layer: result_.layers?.dimensions },
  ] : []

  const howSteps = [
    { icon: '01', label: 'AI Models' },
    { icon: '02', label: 'Metadata' },
    { icon: '03', label: 'Forensics' },
    { icon: '04', label: 'Sensor Noise' },
    { icon: '05', label: 'Anatomy' },
    { icon: '06', label: 'Heatmap' },
    { icon: '07', label: 'GIF / Video' },
    { icon: '08', label: 'Provenance' },
    { icon: '09', label: 'Dimensions' },
  ]

  const howContent = [
    {
      title: 'Diverse ML model ensemble', icon: '01',
      body: 'Multiple specialized classifiers analyze pixel-level statistical patterns invisible to the eye. Requests run in parallel with timeouts via Promise.allSettled — if one model is cold or down, its weight is redistributed and the result is marked "degraded" with a wider uncertainty band instead of failing outright. When models strongly disagree, that disagreement itself widens the reported uncertainty band.',
      tags: ['Parallel inference', 'Graceful degradation', 'Disagreement detection', 'Weight redistribution']
    },
    {
      title: 'Server-side EXIF forensics', icon: '02',
      body: 'Every real camera photo embeds rich provenance: make, model, GPS, timestamp, aperture, lens. We parse metadata on the server with exifr and check 12+ fields against known AI-tool signatures (Stable Diffusion, Midjourney, DALL-E, ComfyUI…). Missing metadata raises suspicion but never acts as sole proof — messaging apps strip EXIF too.',
      tags: ['12+ fields checked', 'AI software signatures', 'Adaptive weighting', 'Tamper awareness']
    },
    {
      title: 'Pixel & JPEG structure forensics', icon: '03',
      body: 'A corrected 2-D FFT measures the radial frequency spectrum: GAN upsampling leaves periodic fingerprints, diffusion output has characteristic mid-frequency deficits, while real photos follow a natural 1/f power law. We also measure block texture variance and inspect the JPEG container for recompression traces and quantization-table anomalies.',
      tags: ['2-D FFT spectrum', '1/f power law', 'Texture variance', 'JPEG quantization tables']
    },
    {
      title: 'PRNU sensor noise & compression forensics', icon: '04',
      body: 'Every camera sensor leaves a unique photo-response non-uniformity (PRNU) fingerprint. We extract the high-frequency residual and measure its strength and spatial consistency — generator output has an absent or unnaturally uniform noise floor. We also parse JPEG quantization tables to detect double-compression (re-saves typical of camera/editing chains) and test 8×8 block-boundary periodicity, which smooth diffusion output lacks.',
      tags: ['PRNU residual map', 'Regional noise consistency', 'Double-compression detection', '8×8 block periodicity']
    },
    {
      title: 'Anatomy plausibility checks', icon: '05',
      body: 'Generative models still stumble on faces and hands. Using skin-tone segmentation we locate face regions, then test eye symmetry, vertical alignment and local warp patterns; hand-shaped blobs are checked for finger-count and geometry anomalies. Every suspicious region is returned as a normalized box so it can be drawn directly on the image as a heatmap overlay.',
      tags: ['Face region detection', 'Eye symmetry & warping', 'Hand blob geometry', 'Boxed evidence for overlays']
    },
    {
      title: 'Region-level saliency heatmap', icon: '06',
      body: 'Rather than one number for the whole picture, we build an 8×8 grid scoring each region\'s suspicion from local noise statistics, texture anomalies and anatomy boxes. The result page renders this as a clickable heatmap — tap any flagged cell to zoom into that region and see exactly where the evidence points.',
      tags: ['8×8 suspicion grid', 'Local noise + texture fusion', 'Click-to-zoom inspection', 'Rendered on results & reports']
    },
    {
      title: 'Animated GIF & video temporal analysis', icon: '07',
      body: 'Still-image detectors fail on animation, so animated GIFs are decoded into up to 16 keyframes and analyzed frame-by-frame. Generated video re-uses the same synthetic grain across frames (a frozen noise floor), shows identical texture statistics and irregular interpolated luminance jumps. The same per-frame engine powers the /api/video endpoint for mp4/webm keyframe uploads.',
      tags: ['Up to 16 keyframes', 'Noise-floor evolution', 'Texture drift & jumps', '/api/video endpoint']
    },
    {
      title: 'Cryptographic provenance: C2PA & SynthID', icon: '08',
      body: 'We scan containers for C2PA content credentials (signed chains from Adobe, Truepic cameras…), Google DeepMind SynthID watermarks (Gemini/Imagen), GLIGEN tree-rings, XMP Generator fields written by GPT-image, and IPTC AI-tags used by stock platforms. A verified C2PA "captured by camera" manifest is near-proof of authenticity; an AI-signed one is near-proof of generation. Browse any past upload\'s raw provenance findings at /provenance.',
      tags: ['C2PA manifests', 'SynthID markers', 'GLIGEN detection', 'XMP / IPTC scans']
    },
    {
      title: 'Dimension heuristics', icon: '09',
      body: 'AI generators emit standard sizes: 512×512 (SD 1.x), 1024×1024 (SDXL/DALL-E), 1024×1792 (DALL-E 3), 1344×768 (Midjourney), 1008×1776 (Flux). Real cameras produce sensor-native irregular dimensions. We match exact sizes, multiples of 64/128, and aspect ratios — high-megapixel images earn a real-photo bonus.',
      tags: ['Exact size matching', 'Divisibility checks', 'Aspect ratios', 'Megapixel bonus']
    }
  ]

  return (
    <div style={{ minHeight: '100vh', background: bg, color: textPrimary, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', overflowX: 'hidden' }}>
      {/* Skip link for keyboard users */}
      <a href="#main" style={{ position: 'absolute', left: '-9999px', top: 0, background: ink, color: '#fff', padding: '8px 16px', zIndex: 200, borderRadius: '0 0 4px 0' }} onFocus={e => e.currentTarget.style.left = '0'} onBlur={e => e.currentTarget.style.left = '-9999px'}>Skip to content</a>

      <ToolNav active="images" />

      <main id="main" style={{ paddingTop: '58px' }}>
        {/* Home */}
        {page === 'home' && (
          <div>
            <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: 'clamp(4rem,10vw,7rem) clamp(1.25rem,5vw,3rem) clamp(3rem,6vw,4rem)', maxWidth: '980px', margin: '0 auto' }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '1.25rem' }}>IsItAI — AI detection for images, video · GIFs, text &amp; audio</p>

              <h1 style={{ fontSize: 'clamp(2.2rem,6vw,4.2rem)', fontWeight: 700, margin: '0 0 1.4rem', lineHeight: 1.1, letterSpacing: '-0.03em', maxWidth: '720px', color: ink }}>
                Is this image real,<br />or generated?
              </h1>

              <p style={{ color: inkSoft, fontSize: 'clamp(1rem,2vw,1.15rem)', maxWidth: '600px', margin: '0 auto 2.25rem', lineHeight: 1.75 }}>
                Upload a file or paste a URL. IsItAI runs nine detection layers — machine-learning classifiers, EXIF metadata, pixel forensics, PRNU sensor noise, anatomy checks, provenance standards like C2PA, plus temporal analysis for animated GIFs and video keyframes — then explains its answer in plain language, including when it isn&apos;t sure. Also available for <Link href="/isitext" style={{ color: ink, textDecoration: 'underline', textUnderlineOffset: '3px' }}>text</Link> and <Link href="/isitaudio" style={{ color: ink, textDecoration: 'underline', textUnderlineOffset: '3px' }}>audio</Link>.
              </p>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '3.5rem' }}>
                <button onClick={() => navigate('detect')} className="btn-primary"
                  style={{ background: ink, border: `1px solid ${ink}`, color: '#fff', padding: '0.8rem 1.6rem', borderRadius: '6px', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', minHeight: '46px', fontFamily: 'inherit' }}>
                  Analyze an image
                </button>
                <button onClick={() => navigate('how')} className="btn-ghost"
                  style={{ background: '#fff', border: '1px solid #c9c9c9', color: ink, padding: '0.8rem 1.6rem', borderRadius: '6px', fontSize: '0.95rem', fontWeight: 500, cursor: 'pointer', minHeight: '46px', fontFamily: 'inherit' }}>
                  How it works
                </button>
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '0 2rem', width: '100%', maxWidth: '880px', borderTop: `1px solid ${border}`, paddingTop: '1.5rem', textAlign: 'left' }}>
                {[['ML ensemble', 'with graceful model failover'], ['Nine forensic layers', 'EXIF · FFT · PRNU · anatomy · C2PA'], ['GIF & video forensics', '16-keyframe temporal analysis'], ['Text & audio detectors', 'sibling tools, same pipeline'], ['Uncertainty bands', 'we say so when we are unsure'], ['Local-only mode', 'nothing leaves your device']].map(([v, l]) => (
                  <li key={v} style={{ padding: '0.5rem 0' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.92rem', color: ink }}>{v}</span>
                    <span style={{ display: 'block', color: inkFaint, fontSize: '0.82rem', marginTop: '2px' }}>{l}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section ref={featuresRef} style={{ padding: 'clamp(2.5rem,6vw,4rem) clamp(1.25rem,5vw,3rem)', maxWidth: '980px', margin: '0 auto', borderTop: `1px solid ${border}` }}>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0 0 0.5rem', letterSpacing: '-0.02em', opacity: featuresInView ? 1 : 0, transform: featuresInView ? 'none' : 'translateY(12px)', transition: 'opacity 0.5s ease, transform 0.5s ease' }}>What makes this different</h2>
              <p style={{ color: inkSoft, maxWidth: '560px', lineHeight: 1.7, fontSize: '0.95rem', margin: '0 auto 2rem', opacity: featuresInView ? 1 : 0, transition: 'opacity 0.5s ease 0.1s' }}>Most detectors show a number and nothing else. We show the evidence behind the verdict and flag when the evidence is weak. Hover or tap a card to see how it works.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1rem', margin: 0 }}>
                {[
                  ['Evidence, explained', 'Every flagged signal carries a plain-language reason.', 'Open the forensic breakdown on any result and click a badge — each one explains which field, byte pattern, or statistic triggered it and why that matters for telling camera photos apart from generator output.'],
                  ['Honest uncertainty', 'Results include an explicit probability band, not just a raw score.', 'The band widens when detection layers disagree or when evidence is thin. When signals conflict, the verdict says "uncertain" instead of guessing — a detector that never admits doubt is lying to you.'],
                  ['Survives outages', 'Model failover with weight redistribution.', 'If an inference model is cold, rate-limited, or down, its weight is redistributed across the remaining models and the result is clearly marked "degraded" with a wider band — rather than crashing or silently returning a wrong number.'],
                  ['Private by design', 'Images are analyzed transiently and never stored.', 'Bytes live in memory only, results are keyed by SHA-256 hash, and shareable reports contain numbers and text — never the image itself. Local-only mode goes further: analysis runs entirely in your browser.'],
                  ['URL and batch mode', 'Paste a link or drop up to ten files at once.', 'Built for fact-checkers working through a thread of suspicious images. URLs are fetched server-side (bypassing CORS) with SSRF guards; batches run sequentially with per-item status and one-click drill-in.'],
                  ['Shareable reports', 'A privacy-safe link to any verdict.', 'Generate a report URL that shows the score, uncertainty band, and every detected signal — no image attached, expires after seven days. Safe to paste into a newsroom Slack or a dispute thread.'],
                  ['Animated GIF & video', 'Temporal forensics across keyframes.', 'Upload an animated GIF and we sample up to 16 keyframes: generated video re-uses the same synthetic grain frame-to-frame, so a frozen noise floor, identical texture statistics or interpolated luminance jumps push the score. The same per-frame engine powers /api/video for mp4/webm keyframes.'],
                  ['Sensor-noise forensics', 'PRNU, double compression, block periodicity.', 'Real camera sensors imprint a unique noise fingerprint (PRNU). We measure that residual, detect JPEG double-compression traces from the quantization tables, and check 8×8 block periodicity — smooth generator output lacks it. Anatomy checks flag warped eyes, asymmetric features and malformed hands with heatmap boxes.'],
                  ['Text & audio too', 'Same fusion, different medium.', 'The AI text detector measures burstiness, type-token ratio and LLM cliché fingerprints; the audio detector decodes waveforms to find TTS/voice-clone tells — over-clean high-frequency rolloff, unnatural silence floors, vocoder artifacts. Both share the score-band-verdict architecture of the image analyzer.'],
                ].map(([title, teaser, more], fi) => (
                  <FeatureCard key={title} title={title} teaser={teaser} more={more} index={fi} inView={featuresInView} />
                ))}
              </div>
              <p style={{ marginTop: '2.5rem' }}>
                <button onClick={() => navigate('detect')} style={{ background: 'none', border: 'none', color: ink, fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: '3px', fontFamily: 'inherit' }}>
                  Try it on an image →
                </button>
              </p>
            </section>
          </div>
        )}

        {/* How it works */}
        {page === 'how' && (
          <div style={{ maxWidth: '860px', margin: '0 auto', padding: 'clamp(2.5rem,5vw,4rem) clamp(1.25rem,5vw,2rem)' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '1rem' }}>Under the hood</p>
            <h1 style={{ fontSize: 'clamp(1.7rem,4vw,2.4rem)', fontWeight: 700, margin: '0 0 0.8rem', letterSpacing: '-0.02em' }}>How the detection works</h1>
            <p style={{ color: inkSoft, maxWidth: '560px', lineHeight: 1.75, fontSize: '0.95rem', margin: '0 0 2.5rem' }}>Nine independent layers each produce signals — including temporal keyframe analysis for animated GIFs and video. They are fused into one score with an uncertainty band that widens when the layers disagree.</p>

            <div role="tablist" aria-label="Detection layers" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(105px,1fr))', borderBottom: `1px solid ${border}`, marginBottom: '2rem' }}>
              {howSteps.map((s, i) => (
                <button key={i} role="tab" aria-selected={activeHow === i} onClick={() => setActiveHow(i)}
                  style={{ padding: '0.9rem 0.4rem', background: 'none', cursor: 'pointer', textAlign: 'left', minHeight: '52px', fontFamily: 'inherit', border: 'none', borderBottom: `2px solid ${activeHow === i ? ink : 'transparent'}`, marginBottom: '-1px', transition: 'border-color 0.15s' }}>
                  <span style={{ fontSize: '0.7rem', color: activeHow === i ? ink : inkFaint, fontVariantNumeric: 'tabular-nums', marginRight: '6px' }}>{s.icon}</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: activeHow === i ? 600 : 400, color: activeHow === i ? ink : inkSoft }}>{s.label}</span>
                </button>
              ))}
            </div>

            {howContent.map((h, i) => i === activeHow && (
              <div key={i} role="tabpanel" style={{ animation: 'panelIn 0.25s ease' }}>
                <h2 style={{ margin: '0 0 1rem', fontSize: '1.3rem', fontWeight: 700, letterSpacing: '-0.01em' }}><span style={{ color: inkFaint, fontWeight: 500, marginRight: '10px', fontVariantNumeric: 'tabular-nums' }}>{h.icon}</span>{h.title}</h2>
                <p style={{ color: inkSoft, lineHeight: 1.85, fontSize: '0.95rem', margin: '0 0 1.5rem', maxWidth: '640px' }}>{h.body}</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {h.tags.map(tag => (
                    <li key={tag} style={{ padding: '5px 12px', background: surface, border: `1px solid ${border}`, borderRadius: '4px', fontSize: '0.78rem', color: inkSoft }}>{tag}</li>
                  ))}
                </ul>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${border}`, paddingTop: '1rem', gap: '8px' }}>
                  <button onClick={() => setActiveHow(Math.max(0, i - 1))} disabled={i === 0} style={{ background: 'none', border: `1px solid ${i === 0 ? 'transparent' : '#c9c9c9'}`, borderRadius: '5px', padding: '8px 14px', color: i === 0 ? '#c4c4c4' : ink, cursor: i === 0 ? 'default' : 'pointer', fontSize: '0.84rem', minHeight: '44px', fontFamily: 'inherit' }}>Previous</button>
                  <span style={{ fontSize: '0.78rem', color: inkFaint, fontVariantNumeric: 'tabular-nums' }}>{i + 1} of {howSteps.length}</span>
                  {i < howSteps.length - 1
                    ? <button onClick={() => setActiveHow(i + 1)} style={{ background: ink, border: `1px solid ${ink}`, borderRadius: '5px', padding: '8px 14px', color: '#fff', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600, minHeight: '44px', fontFamily: 'inherit' }}>Next</button>
                    : <button onClick={() => navigate('detect')} style={{ background: ink, border: `1px solid ${ink}`, borderRadius: '5px', padding: '8px 14px', color: '#fff', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600, minHeight: '44px', fontFamily: 'inherit' }}>Try it on an image</button>
                  }
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Detect */}
        {page === 'detect' && (
          <div style={{ maxWidth: '620px', margin: '0 auto', padding: 'clamp(2rem,5vw,3.5rem) clamp(1rem,4vw,1.5rem)' }}>
            <h1 style={{ fontSize: 'clamp(1.5rem,4vw,2rem)', fontWeight: 700, margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>Analyze an image</h1>
            <p style={{ color: inkSoft, margin: '0 0 1.75rem', fontSize: '0.92rem', lineHeight: 1.7 }}>Free, no account. Verdicts come with uncertainty bands and the evidence behind them.</p>

            {/* Mode tabs */}
            <div role="tablist" aria-label="Input mode" style={{ display: 'flex', marginBottom: '1rem', borderBottom: `1px solid ${border}` }}>
              {[['upload', 'Upload'], ['url', 'URL'], ['batch', 'Batch']].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={mode === id} onClick={() => { setMode(id); setError(null) }}
                  style={{ padding: '9px 18px', background: 'none', border: 'none', borderBottom: `2px solid ${mode === id ? ink : 'transparent'}`, marginBottom: '-1px', color: mode === id ? ink : inkSoft, fontWeight: mode === id ? 600 : 400, fontSize: '0.86rem', cursor: 'pointer', fontFamily: 'inherit', minHeight: '42px', transition: 'border-color 0.15s' }}>{label}</button>
              ))}
            </div>

            {/* Local mode toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', padding: '9px 12px', background: localMode ? '#f0f0f0' : surface, border: `1px solid ${localMode ? '#161616' : border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', color: localMode ? ink : inkSoft }}>
              <input type="checkbox" checked={localMode} onChange={e => setLocalMode(e.target.checked)} style={{ accentColor: '#161616', width: 15, height: 15 }} />
              <span><strong>Run locally only</strong> — nothing leaves your device (heuristics only, lower accuracy)</span>
            </label>

            {/* Upload zone */}
            {mode === 'upload' && (
              <div
                style={{ background: isDragging ? '#f0f0f0' : surface, border: `1.5px dashed ${isDragging ? ink : '#c9c9c9'}`, borderRadius: '8px', overflow: 'hidden', marginBottom: '0.75rem', transition: 'background 0.15s, border-color 0.15s', position: 'relative' }}
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }}>
                {imagePreview ? (
                  <div style={{ position: 'relative' }}>
                    <img src={imagePreview} alt="The image you selected, shown as a preview" style={{ width: '100%', maxHeight: '320px', objectFit: 'cover', display: 'block' }} />
                    {scanAnim && (
                      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
                        <div style={{ position: 'absolute', left: 0, right: 0, height: '2px', background: 'rgba(22,22,22,0.85)', animation: 'scan 1.4s ease-in-out infinite' }} />
                        <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(22,22,22,0.9)', color: '#fff', padding: '4px 12px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#fff', animation: 'pulse 0.9s infinite' }} />ANALYZING
                        </div>
                      </div>
                    )}
                    <button onClick={clearImage} aria-label="Remove image" style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(255,255,255,0.92)', border: '1px solid #d0d0d0', color: ink, borderRadius: '4px', width: '30px', height: '30px', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, lineHeight: 1 }}>×</button>
                    <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(255,255,255,0.92)', border: '1px solid #ddd', padding: '3px 10px', borderRadius: '4px', fontSize: '0.72rem', color: inkSoft, zIndex: 2, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {imageFile?.name}{result?.cached ? ' · cached result' : ''}
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileInputRef.current?.click()} style={{ display: 'block', width: '100%', padding: '3rem 1.5rem', textAlign: 'center', cursor: 'pointer', minHeight: '190px', background: 'none', border: 'none', color: 'inherit', fontFamily: 'inherit' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginBottom: '8px' }}>
                        <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M5 17l4.5-4.5 3 3L16 12l3 3.5" />
                      </svg>
                      <span style={{ color: ink, fontWeight: 500, fontSize: '0.93rem' }}>Drop an image here, or <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>browse</span></span>
                      <span style={{ color: inkFaint, fontSize: '0.78rem' }}>PNG, JPG, WEBP or animated GIF (keyframe forensics), up to 20 MB</span>
                    </span>
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
              </div>
            )}

            {/* URL input */}
            {mode === 'url' && (
              <div style={{ marginBottom: '0.75rem' }}>
                <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleDetect()} placeholder="https://example.com/photo.jpg" aria-label="Image URL"
                  style={{ width: '100%', background: '#fff', border: '1px solid #c9c9c9', borderRadius: '6px', padding: '13px 14px', color: ink, fontSize: '0.92rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                <p style={{ color: inkFaint, fontSize: '0.75rem', margin: '6px 2px 0' }}>The server fetches the image directly. Private/internal addresses are rejected.</p>
              </div>
            )}

            {/* Batch zone */}
            {mode === 'batch' && (
              <div style={{ marginBottom: '0.75rem' }}>
                <div
                  style={{ background: isDragging ? '#f0f0f0' : surface, border: `1.5px dashed ${isDragging ? ink : '#c9c9c9'}`, borderRadius: '8px', padding: '1.6rem 1rem', textAlign: 'center', cursor: 'pointer', marginBottom: '8px', fontSize: '0.86rem', color: inkSoft }}
                  onClick={() => batchInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); addBatchFiles(e.dataTransfer.files) }}>
                  Drop up to 10 images here — they are analyzed one by one
                </div>
                <input ref={batchInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => addBatchFiles(e.target.files)} />
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addBatchUrl()} placeholder="…or add an image URL to the batch" aria-label="Add URL to batch"
                    style={{ flex: 1, background: '#fff', border: '1px solid #c9c9c9', borderRadius: '6px', padding: '10px 12px', color: ink, fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit', minWidth: 0 }} />
                  <button onClick={addBatchUrl} style={{ background: '#fff', border: '1px solid #161616', color: ink, borderRadius: '6px', padding: '10px 14px', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'inherit' }}>Add</button>
                </div>
                {batchFiles.length > 0 && (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {batchFiles.map((b, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: '#fff', border: `1px solid ${border}`, borderRadius: '6px', marginBottom: '6px', fontSize: '0.8rem' }}>
                        {b.preview ? <img src={b.preview} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 4 }} /> : <span style={{ width: 34, height: 34, borderRadius: 4, background: surface, border: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: inkFaint }}>URL</span>}
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: inkSoft }}>{b.name}</span>
                        {b.status === 'queued' && <span style={{ color: inkFaint }}>queued</span>}
                        {b.status === 'pending' && batchIndex === i && <span style={{ color: ink }}>analyzing…</span>}
                        {b.status === 'error' && <span style={{ color: inkSoft }} title={b.error}>failed</span>}
                        {b.status === 'done' && b.result && (
                          <button onClick={() => { setResult(b.result); setMode('upload'); setImageFile(b.file || null); setImagePreview(b.preview || null) }}
                            style={{ background: b.result.score >= 60 ? '#161616' : '#fff', border: '1px solid #161616', color: b.result.score >= 60 ? '#fff' : ink, borderRadius: '4px', padding: '3px 10px', fontWeight: 600, cursor: 'pointer', fontSize: '0.76rem', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}>
                            {b.result.score}% AI
                          </button>
                        )}
                        <button onClick={() => setBatchFiles(list => list.filter((_, j) => j !== i))} aria-label={`Remove ${b.name}`} style={{ background: 'none', border: 'none', color: inkFaint, cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}>×</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Loading */}
            {isLoading && mode !== 'batch' && (
              <div role="status" aria-live="polite" style={{ background: surface, border: `1px solid ${border}`, borderRadius: '8px', padding: '1.25rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${loadingSteps.length},1fr)`, gap: '4px', marginBottom: '0.8rem' }}>
                  {loadingSteps.map((s, i) => (
                    <div key={s} style={{ textAlign: 'left' }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: i < loadingStep ? '#d9d9d9' : i === loadingStep ? ink : '#ececec', border: `1px solid ${i <= loadingStep ? ink : 'transparent'}`, margin: '0 0 5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.64rem', color: i < loadingStep ? ink : i === loadingStep ? '#fff' : inkFaint, transition: 'all 0.3s', fontVariantNumeric: 'tabular-nums' }}>
                        {i < loadingStep ? '✓' : i + 1}
                      </div>
                      <div style={{ fontSize: '0.66rem', color: i <= loadingStep ? ink : inkFaint, fontWeight: i === loadingStep ? 600 : 400 }}>{s}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: '#e8e8e8', borderRadius: '2px', height: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: ink, borderRadius: '2px', width: `${((loadingStep + 1) / loadingSteps.length) * 100}%`, transition: 'width 0.7s ease' }} />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div role="alert" style={{ background: '#f5f5f5', border: '1px solid #161616', borderLeftWidth: '3px', borderRadius: '4px', padding: '0.9rem 1.1rem', color: ink, fontSize: '0.87rem', marginBottom: '0.75rem' }}>
                {error}
              </div>
            )}

            {/* Verdict card */}
            {result_ && mode !== 'batch' && (
              <div style={{ border: '1px solid #161616', borderRadius: '8px', overflow: 'hidden', marginBottom: '0.75rem', background: '#fff', animation: 'reveal 0.35s ease' }}>
                <div style={{ padding: '1.75rem 1.5rem', borderBottom: `1px solid ${border}` }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Verdict {vstyle.mark} {vstyle.note}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 'clamp(2.8rem,9vw,4.2rem)', fontWeight: 700, color: ink, lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }} aria-label={`AI probability ${result_.score} percent, uncertainty band ${result_.band?.label}`}>{displayScore}%</div>
                    <div style={{ fontSize: '0.95rem', color: inkSoft, maxWidth: '280px', lineHeight: 1.5 }}>chance this image is AI-generated</div>
                  </div>
                  <div style={{ marginTop: '0.9rem', fontSize: '0.8rem', color: inkFaint }}>
                    {verdict.line1} · uncertainty band <strong style={{ color: inkSoft, fontWeight: 600 }}>{result_.band?.label}</strong>{result_.cached ? ' · instant (cached)' : ''}{result_.local ? ' · local analysis only' : ''}
                  </div>
                </div>

                {/* Degraded banner */}
                {result_.degraded && (
                  <div style={{ padding: '0.7rem 1.5rem', background: surface, borderBottom: `1px solid ${border}`, fontSize: '0.8rem', color: ink, borderLeft: '3px solid #161616' }}>
                    Reduced-evidence mode: {result_.degradedReason || 'some detection models were unavailable'}. Treat this verdict as provisional.
                  </div>
                )}

                <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${border}` }}>
                  <p style={{ margin: '0 0 0.5rem', fontSize: '0.98rem', lineHeight: 1.7, color: ink }}>{verdict.line2}</p>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: inkSoft, lineHeight: 1.65 }}>{verdict.sub}</p>
                  <div style={{ marginTop: '0.9rem', fontSize: '0.76rem', color: inkFaint, display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                    <span>Confidence: <strong style={{ color: ink, fontWeight: 600 }}>{result_.confidence}</strong></span>
                    {result_.layers?.models?.disagreement && <span style={{ color: inkSoft }}>Models disagreed</span>}
                    {result_.layers?.models?.available && <span>{result_.layers.models.results.length} models{result_.layers.models.failed?.length ? ` · ${result_.layers.models.failed.length} unavailable` : ''}</span>}
                    {result_.source === 'url' && <span>via URL</span>}
                  </div>
                </div>

                {/* Region-level heatmap overlay — zoom into flagged regions */}
                {imagePreview && !result_.local && (result_.saliency?.cells?.length || result_.layers?.anatomy?.boxes?.length) > 0 && (
                  <div style={{ padding: '0 1.5rem 0.5rem' }}>
                    <HeatmapOverlay src={imagePreview} result={result_} />
                  </div>
                )}

                {/* Actions: details / share / feedback */}
                <div style={{ padding: '1rem 1.5rem', background: surface }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' }}>
                    <button onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails} style={{ background: '#fff', border: '1px solid #c9c9c9', cursor: 'pointer', fontSize: '0.8rem', color: ink, padding: '7px 12px', borderRadius: '5px', display: 'flex', alignItems: 'center', gap: '7px', minHeight: '36px', fontFamily: 'inherit' }}>
                      <span style={{ fontSize: '0.65rem', display: 'inline-block', transform: showDetails ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▸</span>
                      {showDetails ? 'Hide forensic breakdown' : 'View forensic breakdown'}
                    </button>
                    {!result_.local && (
                      <button onClick={handleShare} disabled={sharing} style={{ background: '#fff', border: sharing ? '1px solid #d0d0d0' : '1px solid #161616', color: sharing ? inkFaint : ink, borderRadius: '5px', padding: '7px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: sharing ? 'wait' : 'pointer', minHeight: '36px', fontFamily: 'inherit' }}>
                        {sharing ? 'Creating link…' : 'Share report'}
                      </button>
                    )}
                  </div>
                  {shareUrl && (
                    <div style={{ fontSize: '0.76rem', color: ink, background: '#fff', border: `1px solid ${border}`, borderRadius: '5px', padding: '8px 10px', wordBreak: 'break-all' }}>
                      Link copied — <a href={shareUrl} style={{ color: ink }}>{shareUrl}</a> (results only, no image, expires in 7 days)
                    </div>
                  )}

                  {/* Feedback */}
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e0e0e0', fontSize: '0.8rem', color: inkSoft }}>
                    {feedbackSent ? (
                      <span style={{ color: ink }}>Thanks for the feedback — it helps calibrate accuracy.</span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        Was this verdict right?
                        <button onClick={() => sendFeedback('correct')} style={{ background: '#fff', border: '1px solid #161616', color: ink, borderRadius: '5px', padding: '4px 10px', fontSize: '0.76rem', cursor: 'pointer', fontFamily: 'inherit' }}>Correct</button>
                        <button onClick={() => sendFeedback('wrong_real')} style={{ background: '#fff', border: '1px solid #c9c9c9', color: inkSoft, borderRadius: '5px', padding: '4px 10px', fontSize: '0.76rem', cursor: 'pointer', fontFamily: 'inherit' }}>It&apos;s actually real</button>
                        <button onClick={() => sendFeedback('wrong_ai')} style={{ background: '#fff', border: '1px solid #c9c9c9', color: inkSoft, borderRadius: '5px', padding: '4px 10px', fontSize: '0.76rem', cursor: 'pointer', fontFamily: 'inherit' }}>It&apos;s actually AI</button>
                      </span>
                    )}
                  </div>

                  {showDetails && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #e0e0e0', animation: 'fadeUp 0.2s ease' }}>
                      <div style={{ fontSize: '0.7rem', color: inkFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>Model scores</div>
                      {result_.layers?.models?.available ? (
                        (result_.layers.models.results || []).map(m => (
                          <div key={m.name} style={{ marginBottom: '0.9rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                              <span style={{ color: inkSoft }}>{m.shortName} <span style={{ color: inkFaint, fontSize: '0.72rem' }}>({Math.round((m.weight || 0) * 100)}% weight)</span></span>
                              <span style={{ color: ink, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{m.aiScore}%</span>
                            </div>
                            <div style={{ background: '#e8e8e8', borderRadius: '2px', height: '5px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', background: m.aiScore >= 50 ? '#161616' : '#a8a8a8', borderRadius: '2px', width: `${m.aiScore}%`, transition: 'width 0.7s ease' }} />
                            </div>
                          </div>
                        ))
                      ) : (
                        <p style={{ color: inkSoft, fontSize: '0.82rem', margin: '0 0 0.8rem' }}>Models were unavailable — verdict based on heuristic forensics only{result_.layers?.models?.reason ? ` (${result_.layers.models.reason})` : ''}.</p>
                      )}

                      {layerDefs.map(l => <LayerBlock key={l.title} {...l} />)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CTA */}
            {mode === 'batch' ? (
              <button onClick={handleBatch} disabled={isLoading || !batchFiles.length}
                style={{ width: '100%', background: isLoading || !batchFiles.length ? '#e4e4e4' : ink, border: 'none', color: isLoading || !batchFiles.length ? '#9a9a9a' : '#fff', padding: '1rem', borderRadius: '6px', fontSize: '0.95rem', fontWeight: 600, cursor: isLoading ? 'wait' : 'pointer', minHeight: '52px', fontFamily: 'inherit' }}>
                {isLoading ? `Analyzing ${batchIndex + 1}/${batchFiles.length}…` : `Analyze ${batchFiles.length || ''} image${batchFiles.length === 1 ? '' : 's'}`}
              </button>
            ) : mode === 'url' ? (
              <button data-auto-detect onClick={handleDetect} disabled={isLoading}
                style={{ width: '100%', background: isLoading ? '#e4e4e4' : ink, border: 'none', color: isLoading ? '#9a9a9a' : '#fff', padding: '1rem', borderRadius: '6px', fontSize: '0.95rem', fontWeight: 600, cursor: isLoading ? 'wait' : 'pointer', minHeight: '52px', fontFamily: 'inherit' }}>
                {isLoading ? 'Fetching & analyzing…' : result ? 'Analyze another URL' : 'Detect this URL'}
              </button>
            ) : (
              <button onClick={imageFile ? handleDetect : () => fileInputRef.current?.click()} disabled={isLoading}
                style={{ width: '100%', background: isLoading ? '#e4e4e4' : ink, border: 'none', color: isLoading ? '#9a9a9a' : '#fff', padding: '1rem', borderRadius: '6px', fontSize: '0.95rem', fontWeight: 600, cursor: isLoading ? 'wait' : 'pointer', minHeight: '52px', fontFamily: 'inherit' }}>
                {isLoading ? 'Analyzing…' : result ? 'Analyze again' : imageFile ? (localMode ? 'Run local analysis' : 'Detect now') : 'Upload an image'}
              </button>
            )}
            <p style={{ color: inkFaint, fontSize: '0.75rem', textAlign: 'center', marginTop: '0.75rem' }}>
              {localMode ? 'Local mode active — this image never left your device.' : 'Images are analyzed transiently and never stored · 12 free checks per minute'}
            </p>

            {/* Session history */}
            {history.length > 0 && (
              <section aria-label="Your recent analyses" style={{ marginTop: '2rem', borderTop: `1px solid ${border}`, paddingTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h2 style={{ fontSize: '0.72rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Recent analyses (this device)</h2>
                  <button onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]) }} style={{ background: 'none', border: 'none', color: inkSoft, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px' }}>Clear</button>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {history.slice(0, 6).map(h => (
                    <li key={h.id + h.at} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 2px', borderBottom: `1px solid ${border}`, fontSize: '0.8rem' }}>
                      <span style={{ color: inkFaint, fontSize: '0.72rem', width: '28px' }}>{vmark(h.level).mark}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: inkSoft }}>{h.name || h.line1}</span>
                      {h.local && <span style={{ color: inkFaint, fontSize: '0.7rem' }}>local</span>}
                      <span style={{ color: ink, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{h.score}%</span>
                      <span style={{ color: inkFaint, fontSize: '0.72rem', fontVariantNumeric: 'tabular-nums' }}>{new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
                </ul>
                <p style={{ color: inkFaint, fontSize: '0.7rem', margin: '8px 2px 0' }}>Stored only in your browser — never on our servers.</p>
              </section>
            )}
          </div>
        )}

        {/* Footer */}
        <footer style={{ borderTop: `1px solid ${border}`, padding: 'clamp(2rem,4vw,3rem) clamp(1rem,4vw,2rem)', marginTop: 'clamp(2rem,5vw,4rem)' }}>
          <div style={{ maxWidth: '960px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '2rem', marginBottom: '2rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.6rem' }}>
                <Logo size={22} />
                <span style={{ fontWeight: 700, color: ink, fontSize: '0.95rem' }}>IsItAI</span>
              </div>
              <p style={{ color: textMuted, fontSize: '0.8rem', margin: '0 0 0.5rem', lineHeight: 1.6 }}>Free AI image detection. No account. No paywall.</p>
              <p style={{ color: textMuted, fontSize: '0.75rem', margin: 0 }}>Results are probabilistic, not legal determinations.</p>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Product</div>
              {[['home', 'Home'], ['how', 'How it works'], ['detect', 'Try free']].map(([id, label]) => (
                <button key={id} onClick={() => navigate(id)} style={{ display: 'block', background: 'none', border: 'none', color: textSoft, cursor: 'pointer', fontSize: '0.83rem', padding: '3px 0', marginBottom: '4px', textAlign: 'left', fontFamily: 'inherit' }}>{label}</button>
              ))}
              <Link href="/isitext" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>AI Text Detector</Link>
              <Link href="/isitaudio" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>AI Audio Detector</Link>
              <Link href="/bulk-audit" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>Bulk audit</Link>
              <Link href="/api-guide" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0' }}>Public API</Link>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Resources</div>
              <Link href="/how-to-detect-ai-images" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>Detect AI images guide</Link>
              <Link href="/midjourney-vs-dalle-detector" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>Midjourney vs DALL-E</Link>
              <Link href="/ai-video-deepfake-guide" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>Deepfakes & video</Link>
              <Link href="/provenance" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>C2PA provenance viewer</Link>


            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Legal</div>
              <Link href="/privacy" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>Privacy Policy</Link>
              <Link href="/terms" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0' }}>Terms of Service</Link>
            </div>
          </div>
          <div style={{ maxWidth: '960px', margin: '0 auto', paddingTop: '1.5rem', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <p style={{ color: textMuted, margin: 0, fontSize: '0.78rem' }}>© 2026 IsItAI · Built with Next.js · Powered by Hugging Face</p>
            <a href="https://github.com/Ali2191/isitai" target="_blank" rel="noreferrer" style={{ color: textSoft, fontSize: '0.78rem', textDecoration: 'underline', textUnderlineOffset: '2px' }}>Source on GitHub</a>
          </div>
        </footer>
      </main>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0 }
        html { scroll-behavior: smooth }
        button, a { font-family: inherit }
        :focus-visible { outline: 2px solid #161616; outline-offset: 2px; border-radius: 2px }
        ::selection { background: #161616; color: #fff }
        input::placeholder { color: #a5a5a5 }

        @keyframes fadeUp { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes panelIn { from { opacity:0; transform:translateY(5px) } to { opacity:1; transform:translateY(0) } }
        @keyframes reveal { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        @keyframes scan { 0%{top:-2px;opacity:0} 8%{opacity:1} 92%{opacity:1} 100%{top:100%;opacity:0} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }

        @media (max-width: 767px) {
          .desk-nav { display: none !important }
          .mob-menu { display: block !important }
        }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important }
        }
      `}</style>
    </div>
  )
}

// ─── Feature card — reveals detail on hover / focus / tap ────────────────────
function FeatureCard({ title, teaser, more, index, inView }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      tabIndex={0}
      role="button"
      aria-expanded={open}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen(o => !o)}
      style={{
        position: 'relative', overflow: 'hidden', cursor: 'pointer',
        border: `1px solid ${open ? '#161616' : '#e3e3e3'}`, borderRadius: '8px',
        background: open ? '#fafafa' : '#ffffff',
        padding: '1.1rem 1.15rem', minHeight: '120px', textAlign: 'left',
        transition: 'border-color 0.2s ease, background 0.2s ease, transform 0.2s ease',
        transform: open ? 'translateY(-2px)' : 'none',
        opacity: inView ? 1 : 0,
      }}
    >
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem', fontWeight: 600, color: '#161616' }}>{title}</h3>
      <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.6, color: '#5c5c5c' }}>{teaser}</p>
      {/* Revealed panel */}
      <div aria-hidden={!open} style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: '#161616', color: '#f2f2f2', padding: '0.85rem 1.15rem',
        fontSize: '0.78rem', lineHeight: 1.6,
        transform: open ? 'translateY(0)' : 'translateY(101%)',
        transition: 'transform 0.28s ease',
      }}>
        {more}
      </div>
      <span aria-hidden="true" style={{ position: 'absolute', top: '0.9rem', right: '1rem', fontSize: '0.7rem', color: '#8a8a8a', transition: 'color 0.2s', fontWeight: 600 }}>{open ? '−' : '+'}</span>
    </div>
  )
}

// ─── Logo — plain black square with a magnifier, no gradients ────────────────
const Logo = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect width="32" height="32" rx="6" fill="#161616" />
    <circle cx="14.5" cy="14.5" r="6" fill="none" stroke="white" strokeWidth="2" />
    <line x1="19" y1="19" x2="24" y2="24" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
)

// ─── Signal badge with explanation tooltip ────────────────────────────────────
function SignalChip({ s }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => s.why && setOpen(o => !o)} aria-expanded={open ? 'true' : 'false'}
        style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: '4px', background: s.suspicious ? '#161616' : '#ffffff', color: s.suspicious ? '#ffffff' : '#5c5c5c', border: `1px solid ${s.suspicious ? '#161616' : '#d6d6d6'}`, fontWeight: 500, cursor: s.why ? 'pointer' : 'default', fontFamily: 'inherit' }}>
        {s.suspicious ? '! ' : ''}{s.label}
      </button>
      {open && s.why && (
        <span role="tooltip" style={{ position: 'absolute', zIndex: 30, top: '110%', left: 0, width: 'min(260px, 70vw)', background: '#161616', border: '1px solid #161616', borderRadius: 6, padding: '10px 12px', fontSize: '0.72rem', color: '#f2f2f2', lineHeight: 1.55, boxShadow: '0 6px 20px rgba(0,0,0,0.18)', display: 'block', textAlign: 'left' }}>
          {s.why}
        </span>
      )}
    </span>
  )
}

// ─── Layer block in forensic breakdown ────────────────────────────────────────
function LayerBlock({ icon, title, layer }) {
  if (!layer || !(layer.signals || []).length) return null
  const sc = layer.score ?? layer.aiScore
  return (
    <div style={{ marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px solid #e8e8e8' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
        <span style={{ color: '#161616', fontWeight: 600 }}>{icon} · {title}</span>
        {sc !== undefined && <span style={{ color: sc >= 50 ? '#161616' : '#8a8a8a', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{sc}% suspicious</span>}
      </div>
      {sc !== undefined && (
        <div style={{ background: '#ececec', borderRadius: '3px', height: '5px', overflow: 'hidden', marginBottom: '8px' }}>
          <div style={{ height: '100%', background: sc >= 50 ? '#161616' : '#b3b3b3', borderRadius: '3px', width: `${sc}%`, transition: 'width 0.7s ease' }} />
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
        {layer.signals.map((s, i) => <SignalChip key={i} s={s} />)}
      </div>
    </div>
  )
}
