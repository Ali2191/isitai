'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { runLocalAnalysis } from '../lib/localDetect'

// ─── Verdict copy (server returns level/emoji/color/line1; we add detail) ───
function verdictText(result) {
  const s = result.score, v = result.verdict || {}
  switch (v.level) {
    case 'definitive-ai': return { line2: `High-confidence evidence across multiple layers puts AI probability at ${s}% (band ${result.band?.label}).`, sub: 'Strong generator fingerprints were found in metadata, pixels and/or model scores.', glow: 'rgba(239,68,68,0.15)' }
    case 'likely-ai': return { line2: `We estimate a ${s}% chance this image is AI-generated (uncertainty band ${result.band?.label}).`, sub: 'More evidence points toward generation than authentic capture.', glow: 'rgba(249,115,22,0.15)' }
    case 'uncertain': return { line2: `Signals are mixed — ${s}% lean toward AI, with an uncertainty band of ${result.band?.label}.`, sub: 'This image may be AI-enhanced, heavily edited, re-uploaded, or from an unfamiliar generator.', glow: 'rgba(234,179,8,0.12)' }
    case 'likely-real': return { line2: `We estimate only a ${s}% chance of AI generation (band ${result.band?.label}).`, sub: 'Most detection layers found no significant AI indicators.', glow: 'rgba(34,197,94,0.15)' }
    case 'definitive-real': return { line2: `Nearly all forensic layers agree: ${100 - s >= 90 ? '>90' : 100 - s}% confidence this is a genuine camera photo.`, sub: 'Rich provenance metadata and natural pixel statistics detected.', glow: 'rgba(34,197,94,0.15)' }
    default: return { line2: `AI probability: ${s}% (band ${result.band?.label}).`, sub: '', glow: 'rgba(124,58,237,0.15)' }
  }
}

// ─── Session history (localStorage, results only — never images) ─────────────
const HISTORY_KEY = 'isitai_history_v1'
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function pushHistory(result, name) {
  try {
    const entry = { id: result.id, score: result.score, level: result.verdict?.level, emoji: result.verdict?.emoji, color: result.verdict?.color, line1: result.verdict?.line1, local: !!result.local, at: result.analyzedAt || Date.now(), name: String(name || '').slice(0, 60) }
    const h = [entry, ...loadHistory()].slice(0, 12)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h))
    return h
  } catch { return loadHistory() }
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
const Logo = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <defs><linearGradient id="lg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#7c3aed" /><stop offset="100%" stopColor="#06b6d4" /></linearGradient></defs>
    <rect width="32" height="32" rx="8" fill="url(#lg2)" />
    <ellipse cx="16" cy="15" rx="8.5" ry="5.5" fill="none" stroke="white" strokeWidth="1.8" />
    <circle cx="16" cy="15" r="2.8" fill="white" />
    <circle cx="16" cy="15" r="1.1" fill="url(#lg2)" />
    <line x1="21.5" y1="20.5" x2="25.5" y2="24.5" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
    <circle cx="10" cy="10" r="1" fill="rgba(255,255,255,0.6)" />
    <circle cx="22" cy="10" r="0.7" fill="rgba(255,255,255,0.4)" />
  </svg>
)

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

// ─── Signal badge with explanation tooltip ────────────────────────────────────
function SignalChip({ s }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => s.why && setOpen(o => !o)} aria-expanded={open ? 'true' : 'false'}
        style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: '20px', background: s.suspicious ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', color: s.suspicious ? '#fca5a5' : '#86efac', border: `1px solid ${s.suspicious ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`, fontWeight: 500, cursor: s.why ? 'pointer' : 'default', fontFamily: 'inherit' }}>
        {s.suspicious ? '⚠ ' : '✓ '}{s.label}
      </button>
      {open && s.why && (
        <span role="tooltip" style={{ position: 'absolute', zIndex: 30, top: '110%', left: 0, width: 'min(260px, 70vw)', background: '#18181b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 12px', fontSize: '0.72rem', color: '#d4d4d8', lineHeight: 1.55, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', display: 'block', textAlign: 'left' }}>
          {s.why}
        </span>
      )}
    </span>
  )
}

// ─── Layer block in forensic breakdown ────────────────────────────────────────
function LayerBlock({ icon, title, layer, color }) {
  if (!layer || !(layer.signals || []).length) return null
  const sc = layer.score ?? layer.aiScore
  return (
    <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
        <span style={{ color, fontWeight: 600 }}>{icon} {title}</span>
        {sc !== undefined && <span style={{ color: sc >= 50 ? '#f87171' : '#4ade80', fontWeight: 700 }}>{sc}% suspicious</span>}
      </div>
      {sc !== undefined && (
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '8px' }}>
          <div style={{ height: '100%', background: sc >= 50 ? 'linear-gradient(90deg,#ef4444,#f97316)' : 'linear-gradient(90deg,#22c55e,#10b981)', borderRadius: '4px', width: `${sc}%`, transition: 'width 0.9s cubic-bezier(0.34,1.2,0.64,1)' }} />
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
        {layer.signals.map((s, i) => <SignalChip key={i} s={s} />)}
      </div>
    </div>
  )
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
  const [error, setError] = useState(null)
  const [activeHow, setActiveHow] = useState(0)
  const [displayScore, setDisplayScore] = useState(0)
  const [showDetails, setShowDetails] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // New feature state
  const [mode, setMode] = useState('upload')            // upload | url | batch
  const [urlInput, setUrlInput] = useState('')
  const [batchFiles, setBatchFiles] = useState([])       // [{file,name,preview,status,result,error}]
  const [batchIndex, setBatchIndex] = useState(-1)
  const [localMode, setLocalMode] = useState(false)
  const [shareUrl, setShareUrl] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(null)
  const [history, setHistory] = useState([])
  const fileInputRef = useRef(null)
  const batchInputRef = useRef(null)
  const scoreTimerRef = useRef(null)
  const featuresRef = useRef(null)
  const featuresInView = useInView(featuresRef)

  useEffect(() => { setHistory(loadHistory()) }, [])

  const accent = '#7c3aed'
  const accentCyan = '#06b6d4'
  const bg = '#0a0a0a'
  const bg2 = '#111111'
  const border = 'rgba(255,255,255,0.08)'
  const textPrimary = '#f4f4f5'
  const textMuted = '#71717a'
  const textSoft = '#a1a1aa'
  const loadingSteps = ['Preparing image', 'Running models + forensics', 'Fusing signals']

  const navigate = (to) => {
    if (to === page || animating) return
    setMenuOpen(false); setAnimating(true)
    setTimeout(() => { setPage(to); setAnimating(false); window.scrollTo({ top: 0 }) }, 280)
  }

  const clearImage = () => { setImageFile(null); setImagePreview(null); setResult(null); setError(null); setShareUrl(null); setFeedbackSent(null); setShowDetails(false) }

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) { setError('Please choose an image file (PNG, JPG, WEBP).'); return }
    if (file.size > 20 * 1024 * 1024) { setError('Image too large — limit is 20 MB.'); return }
    setImageFile(file); setImagePreview(URL.createObjectURL(file))
    setResult(null); setError(null); setShareUrl(null); setFeedbackSent(null); setShowDetails(false)
  }

  const animateCounter = (target) => {
    if (scoreTimerRef.current) clearInterval(scoreTimerRef.current)
    setDisplayScore(0); let cur = 0
    scoreTimerRef.current = setInterval(() => {
      cur = Math.min(target, cur + Math.max(1, Math.ceil(target / 35)))
      setDisplayScore(cur)
      if (cur >= target) clearInterval(scoreTimerRef.current)
    }, 22)
  }

  const presentResult = (data, fileName) => {
    setScanAnim(false); setResult(data); setIsLoading(false)
    animateCounter(data.score)
    setHistory(pushHistory(data, fileName))
  }

  const detectError = async message => { setError(message); setScanAnim(false); setIsLoading(false) }

  const handleDetect = async () => {
    setError(null); setResult(null); setShareUrl(null); setFeedbackSent(null); setShowDetails(false)
    setIsLoading(true); setLoadingStep(0); setScanAnim(true); setDisplayScore(0)
    let step = 0
    const iv = setInterval(() => { step++; if (step < loadingSteps.length) setLoadingStep(step) }, 1100)

    // ── Local-only mode: everything stays in the browser ──
    if (localMode) {
      if (!imageFile) { clearInterval(iv); await detectError('Choose an image first.') ; return }
      try {
        const data = await runLocalAnalysis(imageFile)
        clearInterval(iv); setLoadingStep(2)
        setTimeout(() => presentResult(data, imageFile.name), 300)
      } catch (e) { clearInterval(iv); await detectError('Local analysis failed: ' + String(e?.message || e).slice(0, 120)) }
      return
    }

    try {
      let res
      if (mode === 'url') {
        if (!/^https?:\/\//i.test(urlInput.trim())) { clearInterval(iv); await detectError('Enter a full http(s) image URL.'); return }
        res = await fetch('/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: urlInput.trim() }) })
      } else {
        if (!imageFile) { clearInterval(iv); await detectError('Choose an image first.'); return }
        const fd = new FormData(); fd.append('image', imageFile)
        res = await fetch('/api/detect', { method: 'POST', body: fd })
      }
      const data = await res.json()
      clearInterval(iv); setLoadingStep(2)
      if (!res.ok || data.error) { await detectError(data.error || `Request failed (${res.status})${res.status === 429 ? ' — try again in ' + (data.retryAfter || 5) + 's' : ''}`); return }
      setTimeout(() => presentResult(data, mode === 'url' ? urlInput.split('/').pop() : imageFile?.name), 250)
    } catch { clearInterval(iv); await detectError('Connection failed — please try again.') }
  }

  // ── Batch analysis (sequential to respect rate limits) ──
  const handleBatch = async () => {
    if (!batchFiles.length || localMode) return
    setError(null); setIsLoading(true); setBatchIndex(0)
    const next = batchFiles.map(b => ({ ...b, status: 'pending', result: null, error: null }))
    setBatchFiles(next)
    for (let i = 0; i < next.length; i++) {
      setBatchIndex(i)
      const b = next[i]
      if (b.kind === 'file') {
        const fd = new FormData(); fd.append('image', b.file)
        try {
          const res = await fetch('/api/detect', { method: 'POST', body: fd })
          const data = await res.json()
          if (!res.ok || data.error) { b.status = 'error'; b.error = data.error || `HTTP ${res.status}` }
          else { b.status = 'done'; b.result = data; setHistory(prev => pushHistory({ ...data, name: b.name }, b.name) && (() => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] } })()) }
        } catch (e) { b.status = 'error'; b.error = String(e?.message || e).slice(0, 100) }
      } else {
        try {
          const res = await fetch('/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: b.url }) })
          const data = await res.json()
          if (!res.ok || data.error) { b.status = 'error'; b.error = data.error || `HTTP ${res.status}` }
          else { b.status = 'done'; b.result = data }
        } catch (e) { b.status = 'error'; b.error = String(e?.message || e).slice(0, 100) }
      }
      setBatchFiles([...next])
      if (i < next.length - 1) await new Promise(r => setTimeout(r, 1200)) // pace under rate limit
    }
    setBatchIndex(-1); setIsLoading(false)
  }

  const addBatchFiles = files => {
    const items = Array.from(files || []).filter(f => f.type.startsWith('image/')).slice(0, 10 - batchFiles.length)
    setBatchFiles(b => [...b, ...items.map(f => ({ kind: 'file', file: f, name: f.name, preview: URL.createObjectURL(f), status: 'queued', result: null, error: null }))].slice(0, 10))
  }
  const addBatchUrl = () => {
    const u = urlInput.trim()
    if (!/^https?:\/\//i.test(u)) { setError('Enter a valid http(s) URL to add to the batch.'); return }
    setBatchFiles(b => [...b, { kind: 'url', url: u, name: decodeURIComponent(u.split('/').pop().split('?')[0]) || u, status: 'queued', result: null, error: null }].slice(0, 10))
    setUrlInput('')
  }

  // ── Shareable report ──
  const handleShare = async () => {
    if (!result || result.local) return
    setSharing(true); setError(null)
    try {
      let res
      if (mode === 'url') {
        res = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: urlInput.trim() }) })
      } else {
        const fd = new FormData(); fd.append('image', imageFile)
        res = await fetch('/api/report', { method: 'POST', body: fd })
      }
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
      const link = `${window.location.origin}/r/${data.id}`
      setShareUrl(link)
      try { await navigator.clipboard.writeText(link) } catch { /* clipboard blocked — link still shown */ }
    } catch (e) { setError('Could not create share link: ' + String(e?.message || e).slice(0, 120)) }
    setSharing(false)
  }

  // ── Feedback loop ──
  const sendFeedback = async judgement => {
    if (!result) return
    try {
      await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score: result.score, verdict: result.verdict?.level, judgement, degraded: !!result.degraded }) })
      setFeedbackSent(judgement)
    } catch { /* non-critical */ }
  }

  const result_ = result
  const verdict = result_ ? { ...(result_.verdict || {}), ...verdictText(result_) } : null
  const layerDefs = result_ ? [
    { icon: '📋', title: 'Metadata & Provenance', layer: result_.layers?.metadata, color: '#8b5cf6' },
    { icon: '🌊', title: 'Pixel Forensics', layer: result_.layers?.pixels, color: accentCyan },
    { icon: '🗂️', title: 'File Structure', layer: result_.layers?.structure, color: '#14b8a6' },
    { icon: '📐', title: 'Dimensions', layer: result_.layers?.dimensions, color: '#f59e0b' },
  ] : []

  const howSteps = [
    { icon: '🧬', label: 'AI Models', color: accent },
    { icon: '📋', label: 'Metadata', color: '#8b5cf6' },
    { icon: '🌊', label: 'Forensics', color: accentCyan },
    { icon: '🔏', label: 'Provenance', color: '#f59e0b' },
    { icon: '📐', label: 'Dimensions', color: '#14b8a6' },
  ]

  const howContent = [
    {
      title: 'Diverse ML model ensemble', icon: '🧬', color: accent,
      body: 'Multiple specialized classifiers analyze pixel-level statistical patterns invisible to the eye. Requests run in parallel with timeouts via Promise.allSettled — if one model is cold or down, its weight is redistributed and the result is marked "degraded" with a wider uncertainty band instead of failing outright. When models strongly disagree, that disagreement itself widens the reported uncertainty band.',
      tags: ['Parallel inference', 'Graceful degradation', 'Disagreement detection', 'Weight redistribution']
    },
    {
      title: 'Server-side EXIF forensics', icon: '📋', color: '#8b5cf6',
      body: 'Every real camera photo embeds rich provenance: make, model, GPS, timestamp, aperture, lens. We parse metadata on the server with exifr and check 12+ fields against known AI-tool signatures (Stable Diffusion, Midjourney, DALL-E, ComfyUI…). Missing metadata raises suspicion but never acts as sole proof — messaging apps strip EXIF too.',
      tags: ['12+ fields checked', 'AI software signatures', 'Adaptive weighting', 'Tamper awareness']
    },
    {
      title: 'Pixel & JPEG structure forensics', icon: '🌊', color: accentCyan,
      body: 'A corrected 2-D FFT measures the radial frequency spectrum: GAN upsampling leaves periodic fingerprints, diffusion output has characteristic mid-frequency deficits, while real photos follow a natural 1/f power law. We also measure block texture variance and inspect the JPEG container for recompression traces and quantization-table anomalies.',
      tags: ['2-D FFT spectrum', '1/f power law', 'Texture variance', 'JPEG quantization tables']
    },
    {
      title: 'Cryptographic provenance: C2PA & SynthID', icon: '🔏', color: '#f59e0b',
      body: 'We scan containers for C2PA content credentials (signed chains from Adobe, Truepic cameras…), Google DeepMind SynthID watermarks (Gemini/Imagen), GLIGEN tree-rings, XMP Generator fields written by GPT-image, and IPTC AI-tags used by stock platforms. A verified C2PA "captured by camera" manifest is near-proof of authenticity; an AI-signed one is near-proof of generation.',
      tags: ['C2PA manifests', 'SynthID markers', 'GLIGEN detection', 'XMP / IPTC scans']
    },
    {
      title: 'Dimension heuristics', icon: '📐', color: '#14b8a6',
      body: 'AI generators emit standard sizes: 512×512 (SD 1.x), 1024×1024 (SDXL/DALL-E), 1024×1792 (DALL-E 3), 1344×768 (Midjourney), 1008×1776 (Flux). Real cameras produce sensor-native irregular dimensions. We match exact sizes, multiples of 64/128, and aspect ratios — high-megapixel images earn a real-photo bonus.',
      tags: ['Exact size matching', 'Divisibility checks', 'Aspect ratios', 'Megapixel bonus']
    }
  ]

  return (
    <div style={{ minHeight: '100vh', background: bg, color: textPrimary, fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif', overflowX: 'hidden' }}>
      {/* Skip link for keyboard users */}
      <a href="#main" style={{ position: 'absolute', left: '-9999px', top: 0, background: accent, color: '#fff', padding: '8px 16px', zIndex: 200, borderRadius: '0 0 8px 0' }} onFocus={e => e.currentTarget.style.left = '0'} onBlur={e => e.currentTarget.style.left = '-9999px'}>Skip to content</a>

      {/* Navbar */}
      <nav aria-label="Main navigation" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(24px)', borderBottom: `1px solid ${border}`, padding: '0 clamp(1rem,4vw,2rem)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '58px' }}>
        <button onClick={() => navigate('home')} aria-label="IsItAI home" style={{ display: 'flex', alignItems: 'center', gap: '9px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <Logo size={28} />
          <span style={{ fontWeight: 800, fontSize: '1.1rem', background: `linear-gradient(135deg,${accent},${accentCyan})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>IsItAI</span>
        </button>
        <div className="desk-nav" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {[['home', 'Home'], ['how', 'How it works'], ['detect', 'Try free']].map(([id, label]) => (
            <button key={id} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined} style={{ background: page === id ? `${accent}18` : 'none', border: `1px solid ${page === id ? accent + '35' : 'transparent'}`, borderRadius: '7px', padding: '6px 14px', color: page === id ? accent : textSoft, cursor: 'pointer', fontSize: '0.86rem', fontWeight: page === id ? 600 : 400, transition: 'all 0.18s', fontFamily: 'inherit' }}>
              {label}
            </button>
          ))}
          <Link href="/api-guide" style={{ marginLeft: '4px', padding: '6px 12px', color: textSoft, textDecoration: 'none', fontSize: '0.82rem', border: `1px solid ${border}`, borderRadius: '7px' }}>API</Link>
          <a href="https://github.com/Ali2191/isitai" target="_blank" rel="noreferrer" style={{ marginLeft: '4px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.06)', border: `1px solid ${border}`, borderRadius: '7px', padding: '6px 12px', color: textSoft, textDecoration: 'none', fontSize: '0.82rem' }}>
            ⭐ Star
          </a>
        </div>
        <button className="mob-menu" aria-label="Toggle menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} style={{ display: 'none', background: 'none', border: `1px solid ${border}`, borderRadius: '7px', padding: '8px 11px', color: textPrimary, fontSize: '1.1rem', cursor: 'pointer' }}>☰</button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div style={{ position: 'fixed', top: '58px', left: 0, right: 0, zIndex: 99, background: bg2, borderBottom: `1px solid ${border}`, padding: '0.5rem 1.5rem 1rem' }}>
          {[['home', 'Home'], ['how', 'How it works'], ['detect', 'Try free']].map(([id, label]) => (
            <button key={id} onClick={() => navigate(id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.8rem 0', color: page === id ? accent : textPrimary, cursor: 'pointer', fontSize: '1rem', fontWeight: page === id ? 600 : 400, borderBottom: `1px solid ${border}`, fontFamily: 'inherit' }}>{label}</button>
          ))}
          <Link href="/api-guide" onClick={() => setMenuOpen(false)} style={{ display: 'block', padding: '0.8rem 0', color: textPrimary, textDecoration: 'none', fontSize: '1rem', borderBottom: `1px solid ${border}` }}>API guide</Link>
        </div>
      )}

      <main id="main" style={{ paddingTop: '58px', animation: animating ? 'pOut 0.28s ease forwards' : 'pIn 0.38s ease forwards' }}>

        {/* ══ HOME ══ */}
        {page === 'home' && (
          <div>
            <section style={{ minHeight: 'calc(100vh - 58px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'clamp(2rem,6vw,5rem) clamp(1rem,4vw,2rem)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, opacity: 0.035, backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")', backgroundRepeat: 'repeat', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: '15%', left: '8%', width: 'min(50vw,600px)', height: 'min(50vw,600px)', background: `radial-gradient(circle,${accent}0f 0%,transparent 60%)`, borderRadius: '50%', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: '10%', right: '5%', width: 'min(40vw,450px)', height: 'min(40vw,450px)', background: `radial-gradient(circle,${accentCyan}0a 0%,transparent 60%)`, borderRadius: '50%', pointerEvents: 'none' }} />

              <div style={{ marginBottom: '1.5rem', animation: 'fadeUp 0.7s ease' }}><Logo size={50} /></div>

              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: `${accent}12`, border: `1px solid ${accent}28`, borderRadius: '24px', padding: '5px 16px', fontSize: '0.77rem', color: accent, marginBottom: '1.5rem', fontWeight: 500, animation: 'fadeUp 0.7s ease 0.1s both', letterSpacing: '0.02em' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                Free · No account · Multi-layer forensics · Uncertainty you can trust
              </div>

              <h1 style={{ fontSize: 'clamp(2.4rem,7vw,5.5rem)', fontWeight: 900, margin: '0 0 1.2rem', lineHeight: 1.04, letterSpacing: '-0.04em', maxWidth: '860px', animation: 'fadeUp 0.7s ease 0.15s both' }}>
                Is this image real<br />or{' '}
                <span style={{ background: `linear-gradient(135deg,${accent},${accentCyan})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AI-generated?</span>
              </h1>

              <p style={{ color: textSoft, fontSize: 'clamp(0.95rem,2vw,1.15rem)', maxWidth: '520px', margin: '0 auto 2.5rem', lineHeight: 1.8, animation: 'fadeUp 0.7s ease 0.2s both' }}>
                Upload a file, paste a URL, or batch-analyze up to 10 images. Get a plain-English verdict with honest uncertainty bands — and see exactly which evidence drove it.
              </p>

              <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '4.5rem', animation: 'fadeUp 0.7s ease 0.25s both' }}>
                <button onClick={() => navigate('detect')}
                  style={{ background: `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', color: '#fff', padding: '0.85rem 2rem', borderRadius: '10px', fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', boxShadow: `0 0 32px ${accent}40`, minHeight: '46px', fontFamily: 'inherit' }}>
                  Detect an image — it's free →
                </button>
                <button onClick={() => navigate('how')}
                  style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${border}`, color: textPrimary, padding: '0.85rem 1.8rem', borderRadius: '10px', fontSize: '0.95rem', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s', minHeight: '46px', fontFamily: 'inherit' }}>
                  How it works
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '0.8rem', maxWidth: '640px', width: '100%', animation: 'fadeUp 0.7s ease 0.3s both' }}>
                {[['ML ensemble', 'graceful failover'], ['5 layers', 'EXIF · FFT · C2PA'], ['Uncertainty', 'honest bands'], ['Local mode', 'nothing uploaded']].map(([v, l]) => (
                  <div key={v} style={{ padding: '1rem 0.8rem', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: '1.02rem', background: `linear-gradient(135deg,${accent},${accentCyan})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{v}</div>
                    <div style={{ color: textMuted, fontSize: '0.72rem', marginTop: '3px' }}>{l}</div>
                  </div>
                ))}
              </div>
            </section>

            <section ref={featuresRef} style={{ padding: 'clamp(3rem,6vw,5rem) clamp(1rem,4vw,2rem)', maxWidth: '960px', margin: '0 auto' }}>
              <div style={{ textAlign: 'center', marginBottom: '3rem', opacity: featuresInView ? 1 : 0, transform: featuresInView ? 'translateY(0)' : 'translateY(20px)', transition: 'all 0.6s ease' }}>
                <h2 style={{ fontSize: 'clamp(1.6rem,4vw,2.4rem)', fontWeight: 800, margin: '0 0 0.75rem', letterSpacing: '-0.03em' }}>Why IsItAI is different</h2>
                <p style={{ color: textSoft, maxWidth: '460px', margin: '0 auto', lineHeight: 1.7, fontSize: '0.95rem' }}>Most tools show you a number. We give you a verdict you can read — show our work — and tell you when we're unsure.</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '1rem' }}>
                {[
                  { icon: '💬', title: 'Evidence, explained', desc: 'Every flagged signal carries a plain-language reason. Tap any badge in the breakdown to learn why it matters.', color: accent },
                  { icon: '🎯', title: 'Honest uncertainty', desc: 'Results include an explicit probability band. When evidence conflicts, we say "uncertain" instead of guessing.', color: '#8b5cf6' },
                  { icon: '🛡️', title: 'Survives outages', desc: 'If a model is cold or down, weights redistribute and you get a clearly-marked degraded result — never a crash.', color: accentCyan },
                  { icon: '🔒', title: 'Private by design', desc: 'Images are analyzed transiently and never stored. Local mode keeps sensitive photos entirely on your device.', color: '#f59e0b' },
                  { icon: '📎', title: 'URL & batch mode', desc: 'Paste a link or drop up to 10 files. Perfect for fact-checkers moderating a thread of suspicious images.', color: '#14b8a6' },
                  { icon: '🔗', title: 'Shareable reports', desc: 'Generate a privacy-safe report link (results only, expires in 7 days) to share findings without the image.', color: '#ec4899' },
                ].map((f, fi) => (
                  <div key={f.title} style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '14px', transition: 'all 0.22s', opacity: featuresInView ? 1 : 0, transform: featuresInView ? 'translateY(0)' : 'translateY(16px)', transitionDelay: `${fi * 0.08}s` }}>
                    <div style={{ fontSize: '1.6rem', marginBottom: '0.8rem' }}>{f.icon}</div>
                    <h3 style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '0.93rem', color: textPrimary }}>{f.title}</h3>
                    <p style={{ margin: 0, color: textMuted, fontSize: '0.84rem', lineHeight: 1.7 }}>{f.desc}</p>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: '2.5rem' }}>
                <button onClick={() => navigate('detect')} style={{ background: `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', color: '#fff', padding: '0.85rem 2rem', borderRadius: '10px', fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer', boxShadow: `0 0 24px ${accent}30`, minHeight: '46px', fontFamily: 'inherit' }}>
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
              <p style={{ color: textSoft, maxWidth: '480px', margin: '0 auto', lineHeight: 1.7, fontSize: '0.93rem' }}>Five independent forensic layers fuse into one score with an honest uncertainty band.</p>
            </div>

            <div role="tablist" aria-label="Detection layers" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: '8px', marginBottom: '1.5rem' }}>
              {howSteps.map((s, i) => (
                <button key={i} role="tab" aria-selected={activeHow === i} onClick={() => setActiveHow(i)}
                  style={{ padding: '0.8rem 0.5rem', borderRadius: '10px', border: `1.5px solid ${activeHow === i ? s.color : border}`, background: activeHow === i ? `${s.color}12` : 'rgba(255,255,255,0.03)', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center', minHeight: '46px', fontFamily: 'inherit' }}>
                  <div style={{ fontSize: '1.2rem', marginBottom: '4px' }}>{s.icon}</div>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: activeHow === i ? s.color : textSoft, lineHeight: 1.2 }}>{s.label}</div>
                  <div style={{ fontSize: '0.6rem', color: activeHow === i ? s.color : textMuted, marginTop: '2px' }}>Layer {i + 1}</div>
                </button>
              ))}
            </div>

            {howContent.map((h, i) => i === activeHow && (
              <div key={i} role="tabpanel" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '18px', overflow: 'hidden', animation: 'panelIn 0.3s ease' }}>
                <div style={{ padding: '1.5rem 2rem', background: `${h.color}08`, borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '2.5rem' }}>{h.icon}</div>
                  <div>
                    <div style={{ fontSize: '0.66rem', color: h.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Layer {i + 1}</div>
                    <h2 style={{ margin: 0, fontSize: 'clamp(1rem,3vw,1.4rem)', fontWeight: 800, letterSpacing: '-0.02em' }}>{h.title}</h2>
                  </div>
                </div>
                <div className="how-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 220px' }}>
                  <div style={{ padding: '1.5rem 2rem', borderRight: `1px solid ${border}` }}>
                    <p style={{ color: textSoft, lineHeight: 1.85, fontSize: '0.92rem', margin: 0 }}>{h.body}</p>
                  </div>
                  <div style={{ padding: '1.5rem' }}>
                    <div style={{ fontSize: '0.66rem', color: textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>Key concepts</div>
                    {h.tags.map(tag => (
                      <div key={tag} style={{ padding: '6px 10px', background: `${h.color}0d`, border: `1px solid ${h.color}20`, borderRadius: '8px', fontSize: '0.76rem', color: h.color, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
                        <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: h.color, flexShrink: 0 }} />{tag}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: '1rem 2rem', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <button onClick={() => setActiveHow(Math.max(0, i - 1))} disabled={i === 0} style={{ background: 'none', border: `1px solid ${i === 0 ? 'transparent' : border}`, borderRadius: '7px', padding: '7px 16px', color: i === 0 ? textMuted : textPrimary, cursor: 'pointer', fontSize: '0.83rem', minHeight: '44px', fontFamily: 'inherit' }}>← Previous</button>
                  <span style={{ fontSize: '0.76rem', color: textMuted }}>{i + 1} / {howSteps.length}</span>
                  {i < howSteps.length - 1
                    ? <button onClick={() => setActiveHow(i + 1)} style={{ background: `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', borderRadius: '7px', padding: '7px 16px', color: '#fff', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600, minHeight: '44px', fontFamily: 'inherit' }}>Next →</button>
                    : <button onClick={() => navigate('detect')} style={{ background: `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', borderRadius: '7px', padding: '7px 16px', color: '#fff', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600, minHeight: '44px', fontFamily: 'inherit' }}>Try it free →</button>
                  }
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══ DETECT ══ */}
        {page === 'detect' && (
          <div style={{ maxWidth: '620px', margin: '0 auto', padding: 'clamp(2rem,5vw,3.5rem) clamp(1rem,4vw,1.5rem)' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <h1 style={{ fontSize: 'clamp(1.6rem,5vw,2.4rem)', fontWeight: 900, margin: '0 0 0.6rem', letterSpacing: '-0.03em' }}>Analyze your image</h1>
              <p style={{ color: textSoft, margin: 0, fontSize: '0.9rem', lineHeight: 1.7 }}>Plain-English verdict with uncertainty bands. Free forever.</p>
            </div>

            {/* Mode tabs */}
            <div role="tablist" aria-label="Input mode" style={{ display: 'flex', gap: '6px', marginBottom: '0.9rem' }}>
              {[['upload', '🖼️ Upload'], ['url', '🔗 URL'], ['batch', '🗂️ Batch']].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={mode === id} onClick={() => { setMode(id); setError(null) }}
                  style={{ flex: 1, padding: '9px 6px', borderRadius: '10px', border: `1px solid ${mode === id ? accent + '55' : border}`, background: mode === id ? `${accent}14` : 'rgba(255,255,255,0.02)', color: mode === id ? accent : textSoft, fontWeight: mode === id ? 700 : 500, fontSize: '0.83rem', cursor: 'pointer', fontFamily: 'inherit', minHeight: '42px' }}>{label}</button>
              ))}
            </div>

            {/* Local mode toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.9rem', padding: '8px 12px', background: localMode ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${localMode ? 'rgba(34,197,94,0.3)' : border}`, borderRadius: '10px', cursor: 'pointer', fontSize: '0.8rem', color: localMode ? '#4ade80' : textSoft }}>
              <input type="checkbox" checked={localMode} onChange={e => setLocalMode(e.target.checked)} style={{ accentColor: '#22c55e', width: 16, height: 16 }} />
              <span>🔒 <strong>Local-only mode</strong> — nothing leaves your device (heuristics only, lower accuracy)</span>
            </label>

            {/* Upload zone */}
            {mode === 'upload' && (
              <div
                style={{ background: isDragging ? `${accent}08` : 'rgba(255,255,255,0.02)', border: `2px dashed ${isDragging ? accent : border}`, borderRadius: '16px', overflow: 'hidden', marginBottom: '0.75rem', transition: 'all 0.22s', position: 'relative' }}
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }}>
                {imagePreview ? (
                  <div style={{ position: 'relative' }}>
                    <img src={imagePreview} alt="The image you selected, shown as a preview" style={{ width: '100%', maxHeight: '320px', objectFit: 'cover', display: 'block' }} />
                    {scanAnim && (
                      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
                        <div style={{ position: 'absolute', left: 0, right: 0, height: '2px', background: `linear-gradient(90deg,transparent,${accent},${accentCyan},transparent)`, animation: 'scan 1.4s ease-in-out infinite', boxShadow: `0 0 12px ${accent}` }} />
                        <div style={{ position: 'absolute', top: '10px', left: '10px', background: `${accent}ee`, color: '#fff', padding: '4px 12px', borderRadius: '20px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#fff', animation: 'pulse 0.8s infinite' }} />SCANNING
                        </div>
                      </div>
                    )}
                    <button onClick={clearImage} aria-label="Remove image" style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: '34px', height: '34px', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>✕</button>
                    <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.72)', padding: '3px 10px', borderRadius: '6px', fontSize: '0.7rem', color: '#d4d4d8', zIndex: 2, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {imageFile?.name}{result?.cached ? ' · cached result' : ''}
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileInputRef.current?.click()} style={{ display: 'block', width: '100%', padding: '3rem 1.5rem', textAlign: 'center', cursor: 'pointer', minHeight: '190px', background: 'none', border: 'none', color: 'inherit', fontFamily: 'inherit' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ width: '56px', height: '56px', borderRadius: '14px', background: `${accent}12`, border: `1px solid ${accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem' }}>🖼️</span>
                      <span style={{ color: textSoft, fontWeight: 500, fontSize: '0.93rem' }}>Drop your image or <span style={{ color: accent, fontWeight: 700 }}>browse</span></span>
                      <span style={{ color: textMuted, fontSize: '0.76rem', marginTop: '4px' }}>PNG · JPG · WEBP · up to 20MB</span>
                    </span>
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
              </div>
            )}

            {/* URL input */}
            {mode === 'url' && (
              <div style={{ marginBottom: '0.75rem' }}>
                <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://example.com/photo.jpg" aria-label="Image URL"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${border}`, borderRadius: '12px', padding: '14px 16px', color: textPrimary, fontSize: '0.92rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                <p style={{ color: textMuted, fontSize: '0.72rem', margin: '6px 2px 0' }}>The server fetches the image directly (bypasses CORS). Private/internal addresses are rejected.</p>
              </div>
            )}

            {/* Batch zone */}
            {mode === 'batch' && (
              <div style={{ marginBottom: '0.75rem' }}>
                <div
                  style={{ background: isDragging ? `${accent}08` : 'rgba(255,255,255,0.02)', border: `2px dashed ${isDragging ? accent : border}`, borderRadius: '14px', padding: '1.6rem 1rem', textAlign: 'center', cursor: 'pointer', marginBottom: '8px' }}
                  onClick={() => batchInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); addBatchFiles(e.dataTransfer.files) }}>
                  🗂️ Drop up to 10 images here — they're analyzed one by one
                </div>
                <input ref={batchInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => addBatchFiles(e.target.files)} />
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addBatchUrl()} placeholder="…or add an image URL to the batch" aria-label="Add URL to batch"
                    style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: `1px solid ${border}`, borderRadius: '10px', padding: '10px 12px', color: textPrimary, fontSize: '0.84rem', outline: 'none', fontFamily: 'inherit', minWidth: 0 }} />
                  <button onClick={addBatchUrl} style={{ background: `${accent}22`, border: `1px solid ${accent}55`, color: accent, borderRadius: '10px', padding: '10px 14px', fontWeight: 700, cursor: 'pointer', fontSize: '0.84rem', fontFamily: 'inherit' }}>+ Add</button>
                </div>
                {batchFiles.length > 0 && (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {batchFiles.map((b, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${border}`, borderRadius: '10px', marginBottom: '6px', fontSize: '0.8rem' }}>
                        {b.preview ? <img src={b.preview} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6 }} /> : <span style={{ width: 34, height: 34, borderRadius: 6, background: `${accentCyan}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔗</span>}
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: textSoft }}>{b.name}</span>
                        {b.status === 'queued' && <span style={{ color: textMuted }}>queued</span>}
                        {b.status === 'pending' && batchIndex === i && <span style={{ color: accent }}>analyzing…</span>}
                        {b.status === 'error' && <span style={{ color: '#f87171' }} title={b.error}>✕ failed</span>}
                        {b.status === 'done' && b.result && (
                          <button onClick={() => { setResult(b.result); setMode('upload'); setImageFile(b.file || null); setImagePreview(b.preview || null); animateCounter(b.result.score) }}
                            style={{ background: b.result.score >= 60 ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', border: `1px solid ${b.result.score >= 60 ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, color: b.result.score >= 60 ? '#f87171' : '#4ade80', borderRadius: '20px', padding: '3px 10px', fontWeight: 700, cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit' }}>
                            {b.result.score}% {b.result.verdict?.emoji || ''}
                          </button>
                        )}
                        <button onClick={() => setBatchFiles(list => list.filter((_, j) => j !== i))} aria-label={`Remove ${b.name}`} style={{ background: 'none', border: 'none', color: textMuted, cursor: 'pointer', fontSize: '0.9rem' }}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Loading */}
            {isLoading && mode !== 'batch' && (
              <div role="status" aria-live="polite" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, borderRadius: '14px', padding: '1.25rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${loadingSteps.length},1fr)`, gap: '4px', marginBottom: '0.8rem' }}>
                  {loadingSteps.map((s, i) => (
                    <div key={s} style={{ textAlign: 'center' }}>
                      <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: i < loadingStep ? `${accent}20` : i === loadingStep ? `linear-gradient(135deg,${accent},${accentCyan})` : 'rgba(255,255,255,0.05)', border: `1.5px solid ${i <= loadingStep ? accent : border}`, margin: '0 auto 5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.66rem', color: i < loadingStep ? accent : i === loadingStep ? '#fff' : textMuted, transition: 'all 0.35s', animation: i === loadingStep ? 'ring 1s ease infinite' : 'none' }}>
                        {i < loadingStep ? '✓' : i + 1}
                      </div>
                      <div style={{ fontSize: '0.6rem', color: i <= loadingStep ? accent : textMuted, fontWeight: i === loadingStep ? 700 : 400 }}>{s}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: `linear-gradient(90deg,${accent},${accentCyan})`, borderRadius: '4px', width: `${((loadingStep + 1) / loadingSteps.length) * 100}%`, transition: 'width 0.7s ease' }} />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div role="alert" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', padding: '0.9rem 1.1rem', color: '#fca5a5', fontSize: '0.87rem', marginBottom: '0.75rem' }}>
                ⚠️ {error}
              </div>
            )}

            {/* ── Verdict Card ── */}
            {result_ && mode !== 'batch' && (
              <div style={{ border: `1px solid ${verdict.color}28`, borderRadius: '18px', overflow: 'hidden', marginBottom: '0.75rem', animation: 'reveal 0.5s cubic-bezier(0.34,1.56,0.64,1)', boxShadow: `0 0 60px ${verdict.glow}` }}>
                <div style={{ padding: '2rem 1.5rem', textAlign: 'center', background: `${verdict.color}05`, borderBottom: `1px solid ${border}`, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.4rem', animation: 'bounceIn 0.4s ease' }}>{verdict.emoji}</div>
                  <div style={{ fontSize: 'clamp(3rem,10vw,5rem)', fontWeight: 900, color: verdict.color, lineHeight: 1, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }} aria-label={`AI probability ${result_.score} percent, uncertainty band ${result_.band?.label}`}>{displayScore}%</div>
                  <div style={{ marginTop: '0.6rem', display: 'inline-block', padding: '4px 16px', borderRadius: '20px', background: `${verdict.color}15`, border: `1px solid ${verdict.color}28`, fontSize: '0.88rem', fontWeight: 700, color: verdict.color }}>{verdict.line1}</div>
                  <div style={{ marginTop: '10px', fontSize: '0.78rem', color: textMuted }}>
                    uncertainty band <strong style={{ color: textSoft }}>{result_.band?.label}</strong>{result_.cached ? ' · instant (cached)' : ''}{result_.local ? ' · local only' : ''}
                  </div>
                </div>

                {/* Degraded banner — graceful failure made visible */}
                {result_.degraded && (
                  <div style={{ padding: '0.7rem 1.5rem', background: 'rgba(234,179,8,0.08)', borderBottom: `1px solid ${border}`, fontSize: '0.78rem', color: '#fbbf24' }}>
                    ⚠ Reduced-evidence mode: {result_.degradedReason || 'some detection models were unavailable'}. Treat this verdict as provisional.
                  </div>
                )}

                <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${border}`, background: 'rgba(255,255,255,0.01)' }}>
                  <p style={{ margin: '0 0 0.5rem', fontSize: '1rem', lineHeight: 1.75, color: textPrimary }}>{verdict.line2}</p>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: textMuted, lineHeight: 1.6 }}>{verdict.sub}</p>
                  <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: textMuted, display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <span>Confidence: <span style={{ color: result_.confidence === 'high' ? '#4ade80' : result_.confidence === 'medium' ? '#fbbf24' : '#f87171', fontWeight: 600 }}>{result_.confidence}</span></span>
                    {result_.layers?.models?.disagreement && <span style={{ color: '#fbbf24' }}>⚠ Models disagreed</span>}
                    {result_.layers?.models?.available && <span>{result_.layers.models.results.length} models{result_.layers.models.failed?.length ? ` · ${result_.layers.models.failed.length} unavailable` : ''}</span>}
                    {result_.source === 'url' && <span>via URL</span>}
                  </div>
                </div>

                {/* Actions: details / share / feedback */}
                <div style={{ padding: '0.9rem 1.5rem', background: 'rgba(255,255,255,0.01)' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' }}>
                    <button onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails} style={{ background: 'none', border: `1px solid ${border}`, cursor: 'pointer', fontSize: '0.78rem', color: textSoft, padding: '7px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', minHeight: '36px', fontFamily: 'inherit' }}>
                      <span style={{ fontSize: '0.7rem', display: 'inline-block', transform: showDetails ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
                      {showDetails ? 'Hide' : 'View'} forensic breakdown
                    </button>
                    {!result_.local && (
                      <button onClick={handleShare} disabled={sharing} style={{ background: sharing ? 'rgba(255,255,255,0.05)' : `${accentCyan}18`, border: `1px solid ${accentCyan}40`, color: accentCyan, borderRadius: '8px', padding: '7px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: sharing ? 'wait' : 'pointer', minHeight: '36px', fontFamily: 'inherit' }}>
                        {sharing ? 'Creating link…' : '🔗 Share report'}
                      </button>
                    )}
                  </div>
                  {shareUrl && (
                    <div style={{ fontSize: '0.75rem', color: '#4ade80', wordBreak: 'break-all', background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px', padding: '8px 10px' }}>
                      ✓ Link copied — <a href={shareUrl} style={{ color: '#4ade80' }}>{shareUrl}</a> (results only, no image, expires in 7 days)
                    </div>
                  )}

                  {/* Feedback */}
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${border}`, fontSize: '0.78rem', color: textMuted }}>
                    {feedbackSent ? (
                      <span style={{ color: '#4ade80' }}>✓ Thanks — your feedback helps calibrate accuracy.</span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        Was this verdict right?
                        <button onClick={() => sendFeedback('correct')} style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80', borderRadius: '7px', padding: '4px 10px', fontSize: '0.74rem', cursor: 'pointer', fontFamily: 'inherit' }}>👍 Correct</button>
                        <button onClick={() => sendFeedback('wrong_real')} style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${border}`, color: textSoft, borderRadius: '7px', padding: '4px 10px', fontSize: '0.74rem', cursor: 'pointer', fontFamily: 'inherit' }}>It's actually real</button>
                        <button onClick={() => sendFeedback('wrong_ai')} style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${border}`, color: textSoft, borderRadius: '7px', padding: '4px 10px', fontSize: '0.74rem', cursor: 'pointer', fontFamily: 'inherit' }}>It's actually AI</button>
                      </span>
                    )}
                  </div>

                  {showDetails && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${border}`, animation: 'fadeUp 0.25s ease' }}>
                      {/* Model scores */}
                      <div style={{ fontSize: '0.66rem', color: textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>AI model scores</div>
                      {result_.layers?.models?.available ? (
                        (result_.layers.models.results || []).map(m => (
                          <div key={m.name} style={{ marginBottom: '0.9rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                              <span style={{ color: textSoft }}>{m.shortName} <span style={{ color: textMuted, fontSize: '0.7rem' }}>({Math.round((m.weight || 0) * 100)}%)</span></span>
                              <span style={{ color: m.aiScore >= 50 ? '#f87171' : '#4ade80', fontWeight: 700 }}>{m.aiScore}%</span>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', background: m.aiScore >= 50 ? 'linear-gradient(90deg,#ef4444,#f97316)' : 'linear-gradient(90deg,#22c55e,#10b981)', borderRadius: '4px', width: `${m.aiScore}%`, transition: 'width 0.9s cubic-bezier(0.34,1.2,0.64,1)' }} />
                            </div>
                          </div>
                        ))
                      ) : (
                        <p style={{ color: textMuted, fontSize: '0.8rem', margin: '0 0 0.8rem' }}>Models were unavailable — verdict based on heuristic forensics only{result_.layers?.models?.reason ? ` (${result_.layers.models.reason})` : ''}.</p>
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
                style={{ width: '100%', background: isLoading || !batchFiles.length ? 'rgba(255,255,255,0.05)' : `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', color: isLoading || !batchFiles.length ? textMuted : '#fff', padding: '1rem', borderRadius: '12px', fontSize: '0.97rem', fontWeight: 700, cursor: isLoading ? 'wait' : 'pointer', minHeight: '52px', fontFamily: 'inherit' }}>
                {isLoading ? `⏳ Analyzing ${batchIndex + 1}/${batchFiles.length}…` : `🔍 Analyze ${batchFiles.length || ''} image${batchFiles.length === 1 ? '' : 's'} — Free`}
              </button>
            ) : mode === 'url' ? (
              <button onClick={handleDetect} disabled={isLoading}
                style={{ width: '100%', background: isLoading ? 'rgba(255,255,255,0.05)' : `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', color: isLoading ? textMuted : '#fff', padding: '1rem', borderRadius: '12px', fontSize: '0.97rem', fontWeight: 700, cursor: isLoading ? 'wait' : 'pointer', minHeight: '52px', fontFamily: 'inherit' }}>
                {isLoading ? '⏳ Fetching & analyzing…' : result ? '🔄 Analyze Again' : '🔗 Detect This URL — Free'}
              </button>
            ) : (
              <button onClick={imageFile ? handleDetect : () => fileInputRef.current?.click()} disabled={isLoading}
                style={{ width: '100%', background: isLoading ? 'rgba(255,255,255,0.05)' : `linear-gradient(135deg,${accent},${accentCyan})`, border: 'none', color: isLoading ? textMuted : '#fff', padding: '1rem', borderRadius: '12px', fontSize: '0.97rem', fontWeight: 700, cursor: isLoading ? 'wait' : 'pointer', minHeight: '52px', fontFamily: 'inherit' }}>
                {isLoading ? '⏳ Analyzing...' : result ? '🔄 Analyze Again' : imageFile ? (localMode ? '🔒 Run Local Analysis' : '🔍 Detect Now — Free') : '📁 Upload an Image'}
              </button>
            )}
            <p style={{ color: textMuted, fontSize: '0.72rem', textAlign: 'center', marginTop: '0.75rem' }}>
              {localMode ? '🔒 Local mode active — this image never left your device.' : '🔒 Images analyzed transiently and never stored · 12 free checks/min'}
            </p>

            {/* Session history */}
            {history.length > 0 && (
              <section aria-label="Your recent analyses" style={{ marginTop: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h2 style={{ fontSize: '0.72rem', fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Recent analyses (this device)</h2>
                  <button onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]) }} style={{ background: 'none', border: 'none', color: textMuted, fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {history.slice(0, 6).map(h => (
                    <li key={h.id + h.at} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${border}`, borderRadius: '10px', marginBottom: '5px', fontSize: '0.78rem' }}>
                      <span>{h.emoji}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: textSoft }}>{h.name || h.line1}</span>
                      {h.local && <span style={{ color: textMuted, fontSize: '0.68rem' }}>local</span>}
                      <span style={{ color: h.score >= 60 ? '#f87171' : '#4ade80', fontWeight: 700 }}>{h.score}%</span>
                      <span style={{ color: textMuted, fontSize: '0.68rem' }}>{new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
                </ul>
                <p style={{ color: textMuted, fontSize: '0.66rem', margin: '6px 2px 0' }}>Stored only in your browser's localStorage — never on our servers.</p>
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
                <span style={{ fontWeight: 800, background: `linear-gradient(135deg,${accent},${accentCyan})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: '0.95rem' }}>IsItAI</span>
              </div>
              <p style={{ color: textMuted, fontSize: '0.8rem', margin: '0 0 0.5rem', lineHeight: 1.6 }}>Free AI image detection. No account. No paywall. Built for truth.</p>
              <p style={{ color: textMuted, fontSize: '0.75rem', margin: 0 }}>Results are probabilistic, not legal determinations.</p>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Product</div>
              {[['home', 'Home'], ['how', 'How it works'], ['detect', 'Try free']].map(([id, label]) => (
                <button key={id} onClick={() => navigate(id)} style={{ display: 'block', background: 'none', border: 'none', color: textSoft, cursor: 'pointer', fontSize: '0.83rem', padding: '3px 0', marginBottom: '4px', textAlign: 'left', fontFamily: 'inherit' }}>{label}</button>
              ))}
              <Link href="/api-guide" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0' }}>Public API</Link>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Resources</div>
              <Link href="/how-to-detect-ai-images" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>Detect AI images guide</Link>
              <Link href="/midjourney-vs-dalle-detector" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>Midjourney vs DALL-E</Link>
              <Link href="/ai-video-deepfake-guide" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>Deepfakes & video</Link>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Legal</div>
              <Link href="/privacy" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0', marginBottom: '4px' }}>Privacy Policy</Link>
              <Link href="/terms" style={{ display: 'block', color: textSoft, fontSize: '0.83rem', textDecoration: 'none', padding: '3px 0' }}>Terms of Service</Link>
            </div>
          </div>
          <div style={{ maxWidth: '960px', margin: '0 auto', paddingTop: '1.5rem', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <p style={{ color: textMuted, margin: 0, fontSize: '0.78rem' }}>© 2026 IsItAI · Built with Next.js · Powered by Hugging Face</p>
            <a href="https://github.com/Ali2191/isitai" target="_blank" rel="noreferrer" style={{ color: textMuted, fontSize: '0.78rem', textDecoration: 'none' }}>⭐ Star on GitHub</a>
          </div>
        </footer>
      </main>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0 }
        html { scroll-behavior: smooth }
        button, a { font-family: inherit }
        :focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; border-radius: 6px }

        @keyframes pIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes pOut { from { opacity:1; transform:translateY(0) } to { opacity:0; transform:translateY(-6px) } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
        @keyframes panelIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        @keyframes reveal { from { opacity:0; transform:scale(0.97) translateY(8px) } to { opacity:1; transform:scale(1) translateY(0) } }
        @keyframes bounceIn { from { opacity:0; transform:scale(0.4) } to { opacity:1; transform:scale(1) } }
        @keyframes scan { 0%{top:-2px;opacity:0} 8%{opacity:1} 92%{opacity:1} 100%{top:100%;opacity:0} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes ring { 0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,0.4)} 50%{box-shadow:0 0 0 5px rgba(124,58,237,0)} }

        @media (max-width: 767px) {
          .desk-nav { display: none !important }
          .mob-menu { display: block !important }
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
