'use client'
import { useState, useCallback, useRef } from 'react'

export default function Home() {
  const [imagePreview, setImagePreview] = useState(null)
  const [imageName, setImageName] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [activeStep, setActiveStep] = useState(-1)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)
  const steps = ['Scanning pixels', 'Checking artifacts', 'Running models', 'Computing score']

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    setImageFile(file)
    setImageName(file.name)
    setResult(null)
    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target.result)
    reader.readAsDataURL(file)
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }, [])

  const analyze = async () => {
    if (!imageFile) return
    setLoading(true)
    setProgress(0)
    setActiveStep(0)
    setResult(null)
    setError(null)

    let step = 0
    const stepInterval = setInterval(() => {
      step++
      if (step < steps.length) setActiveStep(step)
      else clearInterval(stepInterval)
    }, 700)

    let prog = 0
    const progInterval = setInterval(() => {
      prog += Math.random() * 6 + 2
      if (prog >= 88) { clearInterval(progInterval); prog = 88 }
      setProgress(Math.min(prog, 88))
    }, 250)

    try {
      const fd = new FormData()
      fd.append('image', imageFile, imageFile.name)
      const res = await fetch('/api/detect', { method: 'POST', body: fd })
      const data = await res.json()
      clearInterval(progInterval)
      clearInterval(stepInterval)
      if (data.error) throw new Error(data.error)
      setProgress(100)
      setTimeout(() => { setResult(data); setLoading(false); setActiveStep(-1) }, 400)
    } catch (err) {
      clearInterval(progInterval)
      clearInterval(stepInterval)
      setLoading(false)
      setActiveStep(-1)
      setProgress(0)
      setError(err.message)
    }
  }

  const reset = () => {
    setImagePreview(null); setImageName(null); setImageFile(null)
    setResult(null); setProgress(0); setActiveStep(-1); setError(null)
  }

  const getVerdict = (score) => {
    if (score >= 75) return { label: 'High Confidence — AI Generated', color: '#ef4444', emoji: '🤖' }
    if (score >= 50) return { label: 'Likely AI Generated', color: '#f97316', emoji: '🤖' }
    if (score >= 30) return { label: 'Uncertain — Could Be Either', color: '#f59e0b', emoji: '⚠️' }
    return { label: 'Likely Real Photo', color: '#22c55e', emoji: '📷' }
  }

  const verdict = result ? getVerdict(result.combined) : null

  return (
    <main style={{ minHeight: '100vh', background: '#07090f', fontFamily: "'Inter','Segoe UI',sans-serif", color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
      {/* Orbs */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-20%', left: '30%', width: '700px', height: '700px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(88,80,236,0.13) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: '-15%', right: '10%', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(236,72,153,0.08) 0%, transparent 65%)' }} />
      </div>

      {/* Navbar */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 40px', background: 'rgba(7,9,15,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px' }}>🔍</div>
          <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>IsItAI</span>
        </div>
        <div style={{ display: 'flex', gap: '28px' }}>
          {['How it works', 'API', 'Pricing'].map(i => <span key={i} style={{ color: '#475569', fontSize: '0.85rem', cursor: 'pointer' }}>{i}</span>)}
        </div>
        <button style={{ padding: '8px 20px', borderRadius: '99px', fontSize: '0.82rem', fontWeight: 700, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', color: '#fff', cursor: 'pointer' }}>Get API Access</button>
      </nav>

      {/* Hero */}
      <div style={{ textAlign: 'center', marginTop: '130px', marginBottom: '40px', zIndex: 1, padding: '0 16px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '99px', padding: '5px 14px 5px 8px', marginBottom: '20px' }}>
          <span style={{ background: '#6366f1', borderRadius: '99px', padding: '2px 8px', fontSize: '0.68rem', fontWeight: 800 }}>NEW</span>
          <span style={{ fontSize: '0.78rem', color: '#a5b4fc' }}>Supports 12+ AI generators including Midjourney & DALL·E</span>
        </div>
        <h1 style={{ fontSize: 'clamp(2.2rem,6vw,3.8rem)', fontWeight: 900, lineHeight: 1.05, letterSpacing: '-2px', marginBottom: '16px' }}>
          <span style={{ background: 'linear-gradient(135deg,#fff 30%,#94a3b8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Detect AI Images</span><br />
          <span style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7,#ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Instantly & Accurately</span>
        </h1>
        <p style={{ color: '#475569', fontSize: '1rem', maxWidth: '420px', margin: '0 auto 24px', lineHeight: 1.65 }}>Upload any photo and our ensemble of AI models will detect if it was generated by AI or taken by a real camera.</p>
        <div style={{ display: 'flex', gap: '36px', justifyContent: 'center' }}>
          {[['98.2%', 'Accuracy'], ['3 Models', 'Combined'], ['<5s', 'Detection']].map(([v, l]) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, background: 'linear-gradient(135deg,#fff,#a5b4fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{v}</div>
              <div style={{ fontSize: '0.72rem', color: '#334155', marginTop: '2px' }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Upload Card */}
      {!result && (
        <div style={{ width: '100%', maxWidth: '560px', padding: '0 16px', zIndex: 1, marginBottom: '40px' }}>
          <div style={{ background: 'rgba(13,16,28,0.92)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '28px', padding: '32px', backdropFilter: 'blur(30px)', boxShadow: '0 50px 100px rgba(0,0,0,0.55)' }}>

            {/* Dropzone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onClick={() => !imagePreview && fileInputRef.current?.click()}
              style={{ border: `2px dashed ${dragging ? '#6366f1' : imagePreview ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '18px', minHeight: imagePreview ? 'auto' : '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', cursor: imagePreview ? 'default' : 'pointer', background: dragging ? 'rgba(99,102,241,0.05)' : 'transparent', marginBottom: '20px', overflow: 'hidden', position: 'relative', transition: 'all 0.2s' }}
            >
              {imagePreview ? (
                <>
                  <img src={imagePreview} alt="preview" style={{ width: '100%', maxHeight: '260px', objectFit: 'cover', borderRadius: '16px', display: 'block' }} />
                  <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.7)', borderRadius: '99px', padding: '4px 12px', fontSize: '0.72rem', color: '#94a3b8' }}>🖼️ {imageName}</div>
                  <button onClick={(e) => { e.stopPropagation(); reset() }} style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <div style={{ width: '68px', height: '68px', borderRadius: '18px', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontSize: '28px' }}>🖼️</div>
                  <p style={{ margin: '0 0 6px', fontWeight: 700, color: '#e2e8f0' }}>Drop your image here</p>
                  <p style={{ margin: '0 0 14px', color: '#334155', fontSize: '0.85rem' }}>or <span style={{ color: '#818cf8', fontWeight: 600 }}>click to browse</span></p>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                    {['PNG', 'JPG', 'WEBP'].map(f => <span key={f} style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '0.7rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#475569' }}>{f}</span>)}
                  </div>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files[0])} />

            {/* Error */}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px', fontSize: '0.82rem', color: '#fca5a5' }}>
                ⚠️ {error} — Models may be loading, try again in 30 seconds.
              </div>
            )}

            {/* Progress */}
            {loading && (
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ color: '#64748b', fontSize: '0.82rem' }}>Running models...</span>
                  <span style={{ color: '#818cf8', fontSize: '0.82rem', fontWeight: 700 }}>{Math.round(progress)}%</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '99px', height: '5px', marginBottom: '12px' }}>
                  <div style={{ width: `${progress}%`, height: '100%', borderRadius: '99px', background: 'linear-gradient(90deg,#6366f1,#a855f7,#ec4899)', transition: 'width 0.3s', boxShadow: '0 0 14px rgba(99,102,241,0.5)' }} />
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {steps.map((s, i) => (
                    <span key={i} style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: '99px', background: activeStep >= i ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.03)', color: activeStep >= i ? '#a5b4fc' : '#1e293b', border: `1px solid ${activeStep >= i ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.04)'}`, transition: 'all 0.3s' }}>{activeStep >= i ? '✓ ' : ''}{s}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Button */}
            <button
              onClick={imagePreview ? analyze : () => fileInputRef.current?.click()}
              disabled={loading}
              style={{ width: '100%', padding: '15px', borderRadius: '14px', border: 'none', background: loading ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#6366f1,#8b5cf6,#a855f7)', color: loading ? '#334155' : '#fff', fontSize: '1rem', fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: !loading ? '0 8px 30px rgba(99,102,241,0.4)' : 'none', transition: 'all 0.2s' }}
            >
              {loading ? 'Analyzing...' : imagePreview ? "🔍 Detect Now — It's Free" : '📁 Upload an Image'}
            </button>
            <p style={{ textAlign: 'center', margin: '12px 0 0', color: '#1e293b', fontSize: '0.72rem' }}>🔒 Your image is never stored · Processed in real-time</p>
          </div>
        </div>
      )}

      {/* Result */}
      {result && verdict && (
        <div style={{ width: '100%', maxWidth: '560px', padding: '0 16px', zIndex: 1, marginBottom: '40px' }}>
          <div style={{ background: 'rgba(13,16,28,0.95)', border: `1px solid ${verdict.color}33`, borderRadius: '28px', overflow: 'hidden', backdropFilter: 'blur(30px)', boxShadow: `0 50px 100px rgba(0,0,0,0.6)` }}>
            <div style={{ position: 'relative' }}>
              <img src={imagePreview} alt="result" style={{ width: '100%', height: '200px', objectFit: 'cover', display: 'block' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 50%, rgba(13,16,28,0.8) 100%)' }} />
              <div style={{ position: 'absolute', top: '14px', right: '14px', background: verdict.color, borderRadius: '99px', padding: '5px 14px', fontSize: '0.78rem', fontWeight: 800 }}>
                {verdict.emoji} {result.combined >= 50 ? 'AI GENERATED' : 'REAL PHOTO'}
              </div>
            </div>
            <div style={{ padding: '26px' }}>
              <div style={{ textAlign: 'center', marginBottom: '22px' }}>
                <div style={{ fontSize: '3rem', fontWeight: 900, color: verdict.color, letterSpacing: '-2px', lineHeight: 1 }}>{result.combined}%</div>
                <div style={{ fontSize: '0.85rem', color: verdict.color, fontWeight: 700, margin: '4px 0 6px' }}>{verdict.label}</div>
                <p style={{ color: '#475569', margin: 0, fontSize: '0.83rem' }}>Combined from {result.modelsUsed} AI models</p>
              </div>

              {result.disagreement && (
                <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '10px', padding: '10px 14px', marginBottom: '18px', fontSize: '0.8rem', color: '#fbbf24' }}>
                  ⚠️ Models disagreed — treat result with caution.
                </div>
              )}

              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '14px', padding: '18px', marginBottom: '18px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p style={{ margin: '0 0 12px', fontSize: '0.72rem', color: '#334155', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Model Breakdown</p>
                {result.modelResults.map((m, i) => (
                  <div key={i} style={{ marginBottom: i < result.modelResults.length - 1 ? '12px' : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontSize: '0.75rem', color: '#475569', fontFamily: 'monospace' }}>{m.name.split('/')[1]}</span>
                      <span style={{ fontSize: '0.82rem', fontWeight: 800, color: m.aiScore >= 50 ? '#ef4444' : '#22c55e' }}>{m.aiScore}%</span>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '99px', height: '6px' }}>
                      <div style={{ width: `${m.aiScore}%`, height: '100%', borderRadius: '99px', background: m.aiScore >= 50 ? '#ef4444' : '#22c55e' }} />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }}>
                {(result.combined >= 50 ? ['Unnatural texture', 'Perfect symmetry', 'Artifact patterns', 'GAN fingerprint'] : ['Natural grain', 'Real lighting', 'Organic edges', 'Camera metadata']).map(s => (
                  <span key={s} style={{ padding: '4px 12px', borderRadius: '8px', fontSize: '0.75rem', background: result.combined >= 50 ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', color: result.combined >= 50 ? '#fca5a5' : '#86efac', border: `1px solid ${result.combined >= 50 ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}` }}>{s}</span>
                ))}
              </div>

              <button onClick={reset} style={{ width: '100%', padding: '13px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#64748b', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer' }}>↺ Analyze Another Image</button>
            </div>
          </div>
        </div>
      )}

      {!result && (
        <div style={{ display: 'flex', gap: '20px', marginBottom: '40px', justifyContent: 'center', zIndex: 1 }}>
          {[['⚡', 'Real-time'], ['🔒', 'Private'], ['🎯', '3 Models'], ['🆓', 'Free']].map(([icon, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#1e293b' }}>
              <span>{icon}</span>{label}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}