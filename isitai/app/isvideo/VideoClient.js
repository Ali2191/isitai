'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ToolNav, ToolFooter } from '../components/ToolChrome'

const ink = '#161616', soft = '#5c5c5c', faint = '#8a8a8a', line = '#e3e3e3', surface = '#fafafa'
const HOSTED_VIDEO_LIMIT = 4 * 1024 * 1024

export default function VideoClient() {
  const [file, setFile] = useState(null), [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null)
  async function detect() {
    if (!file) return setError('Choose a video first.')
    if (file.size > HOSTED_VIDEO_LIMIT) return setError('This hosted demo accepts videos up to 4 MB because the deployment gateway limits request size. Use a shorter/compressed clip or an animated GIF.')
    setBusy(true); setError(null); setResult(null)
    try {
      const fd = new FormData(); fd.append('video', file)
      const r = await fetch('/api/video', { method: 'POST', body: fd })
      const contentType = r.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const body = await r.text()
        if (r.status === 413 || /request entity too large|payload too large/i.test(body)) throw new Error('The deployment gateway rejected this video because it is too large. Please use a clip under 4 MB.')
        throw new Error(`Video service returned an unexpected response (HTTP ${r.status}).`)
      }
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Video analysis failed.')
      setResult(j)
    }
    catch (e) { setError(e.message || 'Video analysis failed.') } finally { setBusy(false) }
  }
  return <div style={{ minHeight: '100vh', background: '#fff', color: ink, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>
    <ToolNav active="video" /><main style={{ maxWidth: 860, margin: '0 auto', padding: 'clamp(2rem,5vw,3.5rem) clamp(1rem,4vw,2rem)' }}>
      <p style={{ fontSize: '.8rem', fontWeight: 600, color: faint, textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: '.9rem' }}>Video forensics</p>
      <h1 style={{ fontSize: 'clamp(1.7rem,4.5vw,2.6rem)', margin: '0 0 .8rem' }}>Is this video authentic?</h1>
      <p style={{ color: soft, lineHeight: 1.75, maxWidth: 650, margin: '0 0 2rem' }}>Sample frames across the clip and inspect temporal consistency, noise-floor changes, and texture drift. Results are calibrated evidence, not proof of authorship.</p>
      <label style={{ display: 'block', border: `1.5px dashed ${file ? ink : '#c9c9c9'}`, borderRadius: 8, padding: '2.4rem 1rem', textAlign: 'center', cursor: 'pointer' }}><input hidden type="file" accept="video/*,.mp4,.webm,.mov,.gif" onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); setError(null) }} /><strong>{file ? file.name : 'Choose a video or animated GIF'}</strong><div style={{ color: faint, fontSize: '.78rem', marginTop: 6 }}>Up to 4 MB on the hosted demo · analyzed transiently</div></label>
      <button onClick={detect} disabled={busy || !file} style={{ width: '100%', marginTop: 14, background: busy || !file ? '#e4e4e4' : ink, color: busy || !file ? '#999' : '#fff', border: 0, borderRadius: 6, padding: '1rem', fontWeight: 600, fontSize: '.95rem' }}>{busy ? 'Sampling frames…' : 'Analyze video'}</button>
      {error && <p role="alert" style={{ borderLeft: '3px solid #161616', background: surface, padding: 12, marginTop: 12 }}>{error}</p>}
      {result && <section style={{ marginTop: 32 }}>
        <div style={{ border: `1px solid ${line}`, borderRadius: 8, padding: 24, background: surface }}><p style={{ color: faint, fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.1em' }}>{result.mode} · {result.framesSampled} frames sampled</p><h2 style={{ margin: '8px 0' }}>{result.verdict.line1}</h2><p style={{ color: soft }}>AI probability: <strong>{result.score}%</strong> · uncertainty band {result.band.label}</p></div>
        <h2 style={{ fontSize: '1.2rem', margin: '2rem 0 .8rem' }}>Frame evidence</h2>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100, borderBottom: `1px solid ${line}`, padding: '0 2px' }}>{(result.perFrame || []).map((frame, i) => { const score = frame.aiLean ?? frame.score ?? result.score; return <div key={i} title={`Frame ${i + 1}: ${score}% AI lean`} style={{ flex: 1, height: `${Math.max(5, score)}%`, background: score >= 60 ? '#161616' : '#b5b5b5' }} /> })}</div>
        {result.signals.map((signal, i) => <p key={i} style={{ color: signal.suspicious ? ink : soft, borderBottom: `1px solid ${line}`, padding: '10px 0', margin: 0 }}>{signal.suspicious ? '[!]' : '[OK]'} {signal.label}</p>)}
        {result.temporal && <><h2 style={{ fontSize: '1.2rem', margin: '2rem 0 .8rem' }}>Temporal consistency</h2><p style={{ color: soft }}>{JSON.stringify(result.temporal)}</p></>}
        <p style={{ color: faint, fontSize: '.8rem', marginTop: 24 }}>{result.degradedReason}</p>
      </section>}
      <p style={{ marginTop: 24, color: faint, fontSize: '.8rem' }}><Link href="/ai-video-deepfake-guide">Read the video deepfake field guide →</Link></p>
    </main><ToolFooter />
  </div>
}
