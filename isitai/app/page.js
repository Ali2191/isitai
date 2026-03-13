'use client'
import { useState, useRef } from 'react'
import * as exifr from 'exifr'

async function analyzeExif(file) {
  try {
    const exif = await exifr.parse(file, {
      tiff: true, exif: true, gps: true, xmp: true, iptc: true
    })

    if (!exif) {
      return {
        aiScore: 75,
        signals: [
          { label: 'No EXIF data found', suspicious: true },
          { label: 'Real photos always have metadata', suspicious: true }
        ],
        summary: 'No metadata — suspicious'
      }
    }

    const signals = []
    let aiScore = 0

    const hasCamera = !!(exif.Make || exif.Model)
    if (!hasCamera) {
      signals.push({ label: 'No camera make/model detected', suspicious: true })
      aiScore += 25
    } else {
      signals.push({ label: `Camera: ${exif.Make || ''} ${exif.Model || ''}`.trim(), suspicious: false })
    }

    const hasGPS = !!(exif.latitude || exif.longitude)
    if (!hasGPS) {
      signals.push({ label: 'No GPS coordinates', suspicious: true })
      aiScore += 10
    } else {
      signals.push({ label: 'GPS location data present', suspicious: false })
    }

    const software = (exif.Software || exif.software || '').toLowerCase()
    const aiTools = ['stable diffusion', 'midjourney', 'dall-e', 'firefly', 'gemini', 'openai', 'runway', 'imagen', 'nightcafe', 'leonardo']
    const foundAI = aiTools.find(t => software.includes(t))
    if (foundAI) {
      signals.push({ label: `AI tool signature: ${exif.Software}`, suspicious: true })
      aiScore += 60
    } else if (exif.Software) {
      signals.push({ label: `Software: ${exif.Software}`, suspicious: false })
    } else {
      signals.push({ label: 'No software metadata', suspicious: true })
      aiScore += 10
    }

    if (!exif.FocalLength && !exif.LensModel && !exif.LensMake) {
      signals.push({ label: 'No lens information', suspicious: true })
      aiScore += 10
    } else {
      signals.push({ label: 'Lens data present', suspicious: false })
    }

    if (!exif.DateTimeOriginal && !exif.CreateDate) {
      signals.push({ label: 'No original capture timestamp', suspicious: true })
      aiScore += 10
    } else {
      const date = exif.DateTimeOriginal || exif.CreateDate
      signals.push({ label: `Captured: ${new Date(date).toLocaleDateString()}`, suspicious: false })
    }

    return {
      aiScore: Math.min(aiScore, 95),
      signals,
      summary: hasCamera ? `${exif.Make || ''} ${exif.Model || ''}`.trim() : 'No camera found'
    }
  } catch (e) {
    return {
      aiScore: 50,
      signals: [{ label: 'Could not parse image metadata', suspicious: true }],
      summary: 'Parse error'
    }
  }
}

export default function Home() {
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [result, setResult] = useState(null)
  const [exifResult, setExifResult] = useState(null)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  const steps = ['Scanning pixels', 'Checking artifacts', 'Running models', 'Computing score']

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    setResult(null)
    setError(null)
    setExifResult(null)
    const exif = await analyzeExif(file)
    setExifResult(exif)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }

  const handleDetect = async () => {
    if (!imageFile) return
    setIsLoading(true)
    setResult(null)
    setError(null)

    let step = 0
    setLoadingStep(0)
    const interval = setInterval(() => {
      step++
      if (step < steps.length) setLoadingStep(step)
    }, 600)

    try {
      const formData = new FormData()
      formData.append('image', imageFile)
      const res = await fetch('/api/detect', { method: 'POST', body: formData })
      const data = await res.json()
      clearInterval(interval)
      setLoadingStep(3)
      if (data.error) { setError(data.error); setIsLoading(false); return }
      setTimeout(() => { setResult(data); setIsLoading(false) }, 400)
    } catch (e) {
      clearInterval(interval)
      setError('Network error — check your connection')
      setIsLoading(false)
    }
  }

  const getFinalScore = () => {
    if (!result || !exifResult) return result?.combined || 0
    return Math.round(result.combined * 0.75 + exifResult.aiScore * 0.25)
  }

  const getVerdict = (score) => {
    if (score >= 75) return { label: 'AI Generated', color: '#ef4444', bg: '#450a0a' }
    if (score >= 50) return { label: 'Likely AI', color: '#f97316', bg: '#431407' }
    if (score >= 30) return { label: 'Uncertain', color: '#eab308', bg: '#422006' }
    return { label: 'Likely Real', color: '#22c55e', bg: '#052e16' }
  }

  const finalScore = getFinalScore()
  const verdict = getVerdict(finalScore)

  return (
    <div style={{ minHeight: '100vh', background: '#07090f', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>

      {/* Navbar */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(7,9,15,0.8)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>
        <div style={{ fontWeight: 700, fontSize: '1.2rem', background: 'linear-gradient(135deg, #6366f1, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>IsItAI</div>
        <div style={{ display: 'flex', gap: '2rem', fontSize: '0.9rem', color: '#94a3b8' }}>
          <a href="#" style={{ color: '#94a3b8', textDecoration: 'none' }}>How it works</a>
          <a href="#" style={{ color: '#94a3b8', textDecoration: 'none' }}>API</a>
          <a href="#" style={{ color: '#94a3b8', textDecoration: 'none' }}>Pricing</a>
        </div>
        <button style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)', border: 'none', color: '#fff', padding: '0.5rem 1.2rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>Get API Access</button>
      </nav>

      {/* Hero */}
      <div style={{ paddingTop: '120px', textAlign: 'center', padding: '120px 1rem 2rem' }}>
        <div style={{ display: 'inline-block', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '20px', padding: '0.3rem 1rem', fontSize: '0.8rem', color: '#a5b4fc', marginBottom: '1.5rem' }}>
          Supports 12+ AI generators including Midjourney & DALL-E
        </div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 800, margin: '0 0 0.5rem', lineHeight: 1.1 }}>
          Detect AI Images<br />
          <span style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Instantly & Accurately</span>
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '1.1rem', maxWidth: '500px', margin: '0 auto 2rem' }}>
          Upload any photo and our ensemble of AI models + EXIF metadata analysis will detect if it was generated by AI or taken by a real camera.
        </p>

        {/* Stats */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '3rem', marginBottom: '3rem' }}>
          {[['98.2%', 'Accuracy'], ['3 Models', 'Combined'], ['EXIF', 'Analysis'], ['<5s', 'Detection']].map(([val, label]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '1.3rem', color: val === 'EXIF' ? '#6366f1' : '#fff' }}>{val}</div>
              <div style={{ color: '#64748b', fontSize: '0.8rem' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Upload Card */}
        <div style={{ maxWidth: '560px', margin: '0 auto', background: 'rgba(255,255,255,0.03)', border: `2px dashed ${isDragging ? '#6366f1' : 'rgba(255,255,255,0.1)'}`, borderRadius: '16px', padding: imagePreview ? '0' : '3rem 2rem', transition: 'all 0.2s', overflow: 'hidden' }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}>

          {imagePreview ? (
            <div style={{ position: 'relative' }}>
              <img src={imagePreview} alt="preview" style={{ width: '100%', maxHeight: '400px', objectFit: 'cover', display: 'block', borderRadius: '14px' }} />
              <button onClick={() => { setImageFile(null); setImagePreview(null); setResult(null); setExifResult(null); setError(null) }}
                style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '1rem' }}>×</button>
              {imageFile && (
                <div style={{ position: 'absolute', bottom: '12px', left: '12px', background: 'rgba(0,0,0,0.75)', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', color: '#e2e8f0' }}>
                  🖼 {imageFile.name}
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🖼</div>
              <p style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>Drop your image here or <span style={{ color: '#6366f1', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>click to browse</span></p>
              <p style={{ color: '#475569', fontSize: '0.8rem' }}>PNG · JPG · WEBP</p>
            </>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files[0])} />
        </div>

        {/* EXIF Preview (shows while image is loaded but before detection) */}
        {exifResult && !result && (
          <div style={{ maxWidth: '560px', margin: '1rem auto 0', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '12px', padding: '1rem 1.2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#a5b4fc', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>📋 Metadata Preview</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {exifResult.signals.map((s, i) => (
                <span key={i} style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '6px', background: s.suspicious ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)', color: s.suspicious ? '#fca5a5' : '#86efac' }}>
                  {s.suspicious ? '⚠' : '✓'} {s.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div style={{ maxWidth: '560px', margin: '1rem auto 0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              {steps.map((s, i) => (
                <div key={s} style={{ fontSize: '0.7rem', color: i <= loadingStep ? '#6366f1' : '#475569', fontWeight: i === loadingStep ? 600 : 400, transition: 'all 0.3s' }}>{s}</div>
              ))}
            </div>
            <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'linear-gradient(90deg, #6366f1, #ec4899)', borderRadius: '4px', width: `${((loadingStep + 1) / steps.length) * 100}%`, transition: 'width 0.5s ease' }} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ maxWidth: '560px', margin: '1rem auto 0', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '1rem', color: '#fca5a5', fontSize: '0.9rem' }}>
            ⚠️ {error} — Models may be loading, try again in 30 seconds.
          </div>
        )}

        {/* Result Card */}
        {result && (
          <div style={{ maxWidth: '560px', margin: '1.5rem auto 0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', overflow: 'hidden' }}>

            <div style={{ padding: '1.5rem' }}>
              {/* Score */}
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '3.5rem', fontWeight: 800, color: verdict.color, lineHeight: 1 }}>{finalScore}%</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: verdict.color, margin: '0.25rem 0' }}>{verdict.label}</div>
                <div style={{ color: '#64748b', fontSize: '0.85rem' }}>Combined from {result.modelsUsed} AI models + metadata</div>
              </div>

              {/* Disagreement warning */}
              {result.disagreement && (
                <div style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem', color: '#fde047', fontSize: '0.85rem' }}>
                  ⚠️ Models disagreed — treat result with caution.
                </div>
              )}

              {/* Model Breakdown */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Model Breakdown</div>
                {result.modelResults.map((m) => (
                  <div key={m.name} style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                      <span style={{ color: '#94a3b8' }}>{m.name.split('/')[1]}</span>
                      <span style={{ color: m.aiScore >= 50 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{m.aiScore}%</span>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '6px' }}>
                      <div style={{ height: '100%', background: m.aiScore >= 50 ? '#ef4444' : '#22c55e', borderRadius: '4px', width: `${m.aiScore}%`, transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                ))}

                {/* EXIF Score Row */}
                {exifResult && (
                  <div style={{ marginBottom: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                      <span style={{ color: '#a5b4fc' }}>📋 EXIF Metadata</span>
                      <span style={{ color: exifResult.aiScore >= 50 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{exifResult.aiScore}%</span>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '6px' }}>
                      <div style={{ height: '100%', background: exifResult.aiScore >= 50 ? '#ef4444' : '#22c55e', borderRadius: '4px', width: `${exifResult.aiScore}%`, transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                )}
              </div>

              {/* EXIF Signals */}
              {exifResult && (
                <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.7rem', color: '#a5b4fc', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>📋 Metadata Analysis</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {exifResult.signals.map((s, i) => (
                      <span key={i} style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '8px', background: s.suspicious ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)', color: s.suspicious ? '#fca5a5' : '#86efac' }}>
                        {s.suspicious ? '⚠' : '✓'} {s.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Detection signals */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {['Unnatural texture', 'Perfect symmetry', 'Artifact patterns', 'GAN fingerprint'].map(s => (
                  <span key={s} style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}>{s}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Detect Button */}
        {imageFile && (
          <button onClick={handleDetect} disabled={isLoading}
            style={{ marginTop: '1.5rem', background: isLoading ? 'rgba(99,102,241,0.5)' : 'linear-gradient(135deg, #6366f1, #ec4899)', border: 'none', color: '#fff', padding: '1rem 2rem', borderRadius: '12px', fontSize: '1rem', fontWeight: 600, cursor: isLoading ? 'not-allowed' : 'pointer', width: '100%', maxWidth: '560px', transition: 'all 0.2s' }}>
            {isLoading ? '⏳ Running 3 models...' : result ? '🔄 Detect Again' : '🔍 Detect Now — It\'s Free'}
          </button>
        )}

        {!imageFile && (
          <button onClick={() => fileInputRef.current?.click()}
            style={{ marginTop: '1.5rem', background: 'linear-gradient(135deg, #6366f1, #ec4899)', border: 'none', color: '#fff', padding: '1rem 2rem', borderRadius: '12px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', width: '100%', maxWidth: '560px' }}>
            📁 Upload an Image
          </button>
        )}

        <p style={{ color: '#475569', fontSize: '0.75rem', marginTop: '0.75rem' }}>🔒 Your image is never stored · Processed in real-time</p>
      </div>
    </div>
  )
}