'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ToolNav, ToolFooter } from '../components/ToolChrome'

const ink = '#161616', soft = '#5c5c5c', faint = '#8a8a8a', line = '#e3e3e3', surface = '#fafafa'

export default function CompareClient() {
  const [original, setOriginal] = useState(null)
  const [suspected, setSuspected] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function compare() {
    if (!original || !suspected) return setError('Choose both an original and suspected image.')
    setBusy(true); setError(null); setResult(null)
    try {
      const fd = new FormData(); fd.append('original', original); fd.append('suspected', suspected)
      const response = await fetch('/api/compare', { method: 'POST', body: fd })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Comparison failed.')
      setResult(data)
    } catch (e) { setError(e.message || 'Comparison failed.') } finally { setBusy(false) }
  }

  return <div style={{ minHeight: '100vh', background: '#fff', color: ink, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>
    <ToolNav active="compare" />
    <main style={{ maxWidth: 860, margin: '0 auto', padding: 'clamp(2rem,5vw,3.5rem) clamp(1rem,4vw,2rem)' }}>
      <p style={{ fontSize: '.8rem', fontWeight: 600, color: faint, textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: '.9rem' }}>Image forensics</p>
      <h1 style={{ fontSize: 'clamp(1.7rem,4.5vw,2.6rem)', margin: '0 0 .8rem' }}>Compare an original and suspected edit</h1>
      <p style={{ color: soft, lineHeight: 1.75, maxWidth: 650, margin: '0 0 2rem' }}>Find changed regions, metadata changes, and compression differences. This is evidence about the files, not proof of authorship.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
        {[['Original image', original, setOriginal], ['Suspected edit', suspected, setSuspected]].map(([label, file, setFile]) => <label key={label} style={{ border: `1.5px dashed ${file ? ink : '#c9c9c9'}`, borderRadius: 8, padding: '2rem 1rem', textAlign: 'center', cursor: 'pointer' }}>
          <input hidden type="file" accept="image/*" onChange={e => { setFile(e.target.files?.[0] || null); setResult(null) }} />
          <strong>{file ? file.name : `Choose ${label.toLowerCase()}`}</strong><div style={{ color: faint, fontSize: '.78rem', marginTop: 6 }}>PNG, JPG, WEBP up to 20 MB</div>
        </label>)}
      </div>
      <button onClick={compare} disabled={busy || !original || !suspected} style={{ width: '100%', marginTop: 14, background: busy || !original || !suspected ? '#e4e4e4' : ink, color: busy || !original || !suspected ? '#999' : '#fff', border: 0, borderRadius: 6, padding: '1rem', fontWeight: 600, fontSize: '.95rem' }}>{busy ? 'Comparing files…' : 'Compare images'}</button>
      {error && <p role="alert" style={{ borderLeft: '3px solid #161616', background: surface, padding: 12, marginTop: 12 }}>{error}</p>}
      {result && <section style={{ marginTop: 32 }}>
        <div style={{ border: `1px solid ${line}`, borderRadius: 8, padding: 24, background: surface }}><p style={{ color: faint, fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.1em' }}>Comparison result</p><h2 style={{ margin: '8px 0' }}>{result.verdict.line1}</h2><p style={{ color: soft }}>Difference index: <strong>{result.score}%</strong> · uncertainty band {result.band.label} · {result.changedTiles} changed regions</p></div>
        <h2 style={{ fontSize: '1.2rem', margin: '2rem 0 .8rem' }}>Changed-region map</h2>
        <div aria-label="Changed region heatmap" style={{ display: 'grid', gridTemplateColumns: 'repeat(16,1fr)', gap: 2, maxWidth: 520 }}>{result.heatmap.map((value, i) => <div key={i} title={`Region ${i + 1}: ${(value * 100).toFixed(0)}% difference`} style={{ aspectRatio: 1, background: value >= .18 ? '#161616' : value >= .08 ? '#777' : '#e8e8e8' }} />)}</div>
        <h2 style={{ fontSize: '1.2rem', margin: '2rem 0 .8rem' }}>Evidence</h2>
        {result.signals.map((signal, i) => <p key={i} style={{ color: signal.suspicious ? ink : soft, borderBottom: `1px solid ${line}`, padding: '10px 0', margin: 0 }}>{signal.suspicious ? '[!]' : '[OK]'} {signal.label}</p>)}
        {result.metadataChanges.length > 0 && <><h2 style={{ fontSize: '1.2rem', margin: '2rem 0 .8rem' }}>Metadata changes</h2>{result.metadataChanges.map(change => <p key={change.key} style={{ color: soft, margin: '8px 0' }}><strong>{change.key}</strong>: {change.original || 'missing'} → {change.suspected || 'missing'}</p>)}</>}
        <p style={{ color: faint, fontSize: '.8rem', marginTop: 24 }}>{result.privacy}</p>
      </section>}
      <p style={{ marginTop: 24, color: faint, fontSize: '.8rem' }}><Link href="/">Run a single-image authenticity analysis →</Link></p>
    </main><ToolFooter />
  </div>
}
