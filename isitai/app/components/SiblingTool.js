'use client'
// ─── Shared media-tool UI (text + audio) ─────────────────────────────────────
// Same architecture and visual language as the image detector on the home page:
// verdict card with animated score, uncertainty band, degraded banner, per-layer
// evidence cards with explainable signal chips, a localization heatmap
// (sentence-level for text, waveform + suspicion strip for audio), feedback →
// calibration wiring and shareable reports. One component powers /isitext and
// /isitaudio so both stay feature-identical to images.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import SignalChip from './SignalChip'
import { ToolNav } from './ToolChrome'

const ink = '#161616'
const inkSoft = '#5c5c5c'
const inkFaint = '#8a8a8a'
const line = '#e3e3e3'
const surface = '#fafafa'

const VMARK = {
  'definitive-ai': { mark: '[!]', note: 'High AI probability' },
  'likely-ai': { mark: '[!]', note: 'Leans AI-generated' },
  'uncertain': { mark: '[?]', note: 'Mixed evidence' },
  'likely-real': { mark: '[OK]', note: 'Likely human-made' },
  'definitive-real': { mark: '[OK]', note: 'Strong human signals' },
}
const vmark = level => VMARK[level] || { mark: '[?]', note: 'No verdict' }

function verdictCopy(result, kind) {
  const s = result.score, v = result.verdict || {}
  const noun = kind === 'text' ? 'text' : kind === 'audio' ? 'audio' : 'file'
  switch (v.level) {
    case 'definitive-ai': return { line2: `High-confidence evidence across multiple layers puts AI probability at ${s}% (band ${result.band?.label}).`, sub: `Generator fingerprints were found in this ${noun}'s statistics and structure.` }
    case 'likely-ai': return { line2: `We estimate a ${s}% chance this ${noun} is AI-generated (uncertainty band ${result.band?.label}).`, sub: 'More evidence points toward generation than authentic human creation.' }
    case 'uncertain': return { line2: `Signals are mixed — ${s}% lean toward AI, with an uncertainty band of ${result.band?.label}.`, sub: `This ${noun} may be AI-assisted, heavily edited, translated or too short for reliable stylometry.` }
    case 'likely-real': return { line2: `We estimate only a ${s}% chance of AI generation (band ${result.band?.label}).`, sub: 'Most detection layers found no significant AI indicators.' }
    case 'definitive-real': return { line2: `Nearly all layers agree: strong natural human-variance statistics detected.`, sub: `Rhythm, vocabulary${kind === 'audio' ? ', dynamics and noise floor' : ''} look authentically human.` }
    default: return { line2: `AI probability: ${s}% (band ${result.band?.label}).`, sub: '' }
  }
}

const HISTORY_KEY = 'isitai_sibling_history_v1'
function loadHistory(kind) {
  try { return (JSON.parse(localStorage.getItem(HISTORY_KEY)) || []).filter(h => h.kind === kind) } catch { return [] }
}

export default function SiblingTool({ kind, api, title, intro, placeholder, acceptHint }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [res, setRes] = useState(null)
  const [text, setText] = useState('')
  const [csv, setCsv] = useState('')
  const [bulkRes, setBulkRes] = useState(null)
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')
  const [referenceFile, setReferenceFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [displayScore, setDisplayScore] = useState(0)
  const [feedbackSent, setFeedbackSent] = useState(null)
  const [shareUrl, setShareUrl] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [history, setHistory] = useState([])

  useEffect(() => { setHistory(loadHistory(kind)) }, [kind])

  // local preview URL for the uploaded audio (revoked on change/unmount)
  const [objectUrl, setObjectUrl] = useState(null)
  useEffect(() => {
    if (!file) { setObjectUrl(null); return }
    const u = URL.createObjectURL(file)
    setObjectUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  useEffect(() => {
    if (!res) return
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
  }, [res])

  function pushHistory(r) {
    const entry = { kind, id: r.id, score: r.score, level: r.verdict?.level, line1: r.verdict?.line1, at: r.analyzedAt || Date.now(), name: kind === 'text' ? `${String(text).trim().slice(0, 40)}…` : fileName }
    let next = []
    try {
      next = [entry, ...(JSON.parse(localStorage.getItem(HISTORY_KEY)) || []).filter(h => h.kind !== kind)].slice(0, 24)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    } catch { /* storage blocked */ }
    setHistory(next.filter(h => h.kind === kind))
  }

  async function submit() {
    setErr(null); setRes(null); setFeedbackSent(null); setShareUrl(null); setBusy(true)
    try {
      let r
      if (kind === 'bulk') {
        setBulkRes(null)
        r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv })
      } else if (kind === 'text') {
        r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      } else {
        if (!file) throw new Error('Choose an audio file first')
        const fd = new FormData(); fd.append('audio', file)
        if (referenceFile) fd.append('reference', referenceFile)
        r = await fetch(api, { method: 'POST', body: fd })
      }
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json')) throw new Error(`Server returned an unexpected response (HTTP ${r.status}).`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      if (kind === 'bulk') { setBulkRes(j); pushHistory({ id: `bulk-${Date.now()}`, score: Math.round(j.rows.filter(x => !x.error && x.score >= 50).length / Math.max(j.count, 1) * 100), verdict: { level: null }, analyzedAt: Date.now() }) }
      else { setRes(j); pushHistory(j) }
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  async function exportCsv() {
    if (!csv.trim()) return
    setErr(null); setBusy(true)
    try {
      const r = await fetch(`${api}?format=csv`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      const blob = await r.blob()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'isitai-bulk-audit.csv'; a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  async function handleShare() {
    if (!res) return
    setSharing(true)
    try {
      const r = await fetch('/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: res }),
      })
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json')) throw new Error(`Share endpoint returned an unexpected response (HTTP ${r.status}).`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Could not create share link.')
      const link = `${window.location.origin}/r/${data.id}`
      setShareUrl(link)
      try { await navigator.clipboard.writeText(link) } catch { /* link still shown */ }
    } catch (e) { setErr(e.message || 'Could not create share link.') } finally { setSharing(false) }
  }

  async function sendFeedback(verdict) {
    if (!res) return
    try {
      await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: res.id, score: res.score, level: res.verdict?.level, degraded: !!res.degraded, modelsUsed: res.layers?.models?.results?.length || 0, judgement: verdict }),
      })
    } catch { /* non-critical */ }
    setFeedbackSent(verdict)
  }

  const v = res?.verdict
  const vs = v ? vmark(v.level) : null
  const copy = res && v ? { ...v, ...verdictCopy(res, kind) } : null
  const layerDefs = res ? (kind === 'text' ? [
    { icon: 'S', title: 'Statistical Stylometry', layer: res.layers?.statistics },
    { icon: 'T', title: 'Structure & Chat Formatting', layer: res.layers?.structure },
    { icon: 'W', title: 'AI Traces & Watermarks', layer: res.layers?.traces },
  ] : [
    { icon: 'W', title: 'Waveform & Spectral Forensics', layer: res.layers?.waveform },
    { icon: 'C', title: 'Container Structure', layer: res.layers?.structure },
  ]) : []

  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const urlCount = csv.split(/\s*\n\s*/).map(s => s.trim()).filter(Boolean).length
  const disabled = busy || (kind === 'text' && text.trim().length < 50) || (kind === 'audio' && !file) || (kind === 'bulk' && urlCount === 0)
  const bulkFlagged = bulkRes ? bulkRes.rows.filter(x => !x.error && x.score >= 50).length : 0

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: ink, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>
      <ToolNav active={kind === 'text' ? 'text' : kind === 'audio' ? 'audio' : 'bulk'} />

      <main style={{ maxWidth: 860, margin: '0 auto', padding: 'clamp(2rem,5vw,3.5rem) clamp(1rem,4vw,2rem)' }}>
        <p style={{ fontSize: '0.8rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.9rem' }}>
          IsItAI — {kind === 'text' ? 'AI text detector' : kind === 'audio' ? 'AI audio & voice-clone detector' : 'Bulk image audit'}
        </p>
        <h1 style={{ fontSize: 'clamp(1.7rem,4.5vw,2.6rem)', fontWeight: 700, margin: '0 0 0.8rem', lineHeight: 1.15, letterSpacing: '-0.02em' }}>{title}</h1>
        <p style={{ color: inkSoft, fontSize: '1rem', lineHeight: 1.75, maxWidth: 640, margin: '0 0 2rem' }}>{intro}</p>

        {/* Input */}
        {kind === 'bulk' ? (
          <div style={{ border: `1px solid ${ink}`, borderRadius: 8, overflow: 'hidden' }}>
            <textarea
              value={csv} onChange={e => setCsv(e.target.value)} rows={8} placeholder={placeholder} aria-label="Image URLs to audit, one per line"
              style={{ width: '100%', boxSizing: 'border-box', border: 'none', outline: 'none', resize: 'vertical', padding: '1rem 1.1rem', fontSize: '0.9rem', lineHeight: 1.7, color: ink, background: '#fff', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', display: 'block' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem', borderTop: `1px solid ${line}`, background: surface, fontSize: '0.75rem', color: inkFaint }}>
              <span>{urlCount} URL{urlCount === 1 ? '' : 's'} · up to 50 audited in parallel{urlCount > 50 ? ' — extras are ignored' : ''}</span>
              <button onClick={() => { setCsv(''); setRes(null) }} style={{ background: 'none', border: 'none', color: inkSoft, cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline', textUnderlineOffset: 2, fontFamily: 'inherit' }}>Clear</button>
            </div>
          </div>
        ) : kind === 'text' ? (
          <div style={{ border: `1px solid ${ink}`, borderRadius: 8, overflow: 'hidden' }}>
            <textarea
              value={text} onChange={e => setText(e.target.value)} rows={10} placeholder={placeholder} aria-label="Paste text to analyze"
              style={{ width: '100%', boxSizing: 'border-box', border: 'none', outline: 'none', resize: 'vertical', padding: '1rem 1.1rem', fontSize: '0.95rem', lineHeight: 1.65, color: ink, background: '#fff', fontFamily: 'inherit', display: 'block' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem', borderTop: `1px solid ${line}`, background: surface, fontSize: '0.75rem', color: inkFaint }}>
              <span>{words} words · {text.length.toLocaleString()} characters{words > 0 && words < 40 ? ' — need 40+ words for reliable stylometry' : ''}</span>
              <button onClick={() => { setText(''); setRes(null) }} style={{ background: 'none', border: 'none', color: inkSoft, cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline', textUnderlineOffset: 2, fontFamily: 'inherit' }}>Clear</button>
            </div>
          </div>
        ) : (
          <label
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false)
              const f = e.dataTransfer?.files?.[0]
              if (f) {
                if (!f.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name)) { setErr('Please drop an audio file.'); return }
                setErr(null); setFile(f); setFileName(f.name); setRes(null)
              }
            }}
            style={{ display: 'block', border: `1.5px dashed ${dragOver ? ink : '#c9c9c9'}`, borderRadius: 8, background: dragOver ? surface : '#fff', padding: '2.2rem 1.5rem', textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s, background .15s' }}
          >
            <input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac" hidden onChange={e => {
              const f = e.target.files?.[0]
              if (f) { setErr(null); setFile(f); setFileName(f.name); setRes(null) }
            }} />
            {file ? (
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>♪</div>
                <div
                  title={fileName}
                  style={{ fontWeight: 600, color: ink, fontSize: '0.95rem', maxWidth: '100%', margin: '0 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', wordBreak: 'break-all', display: 'block' }}
                >
                  {fileName.length > 48 ? `${fileName.slice(0, 32)}…${fileName.slice(-13)}` : fileName}
                </div>
                <div style={{ color: inkFaint, fontSize: '0.78rem', marginTop: 4 }}>{(file.size / 1024 / 1024).toFixed(2)} MB · click to replace</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>⬆</div>
                <div style={{ fontWeight: 600, color: ink, fontSize: '0.95rem' }}>Drop an audio file or click to browse</div>
                <div style={{ color: inkFaint, fontSize: '0.78rem', marginTop: 4 }}>{acceptHint}</div>
              </div>
            )}
          </label>
        )}

        {kind === 'audio' && file && objectUrl && (
          <div style={{ marginTop: 12 }}>
            <audio controls preload="metadata" src={objectUrl || undefined} style={{ width: '100%', height: 40 }} aria-label="Audio preview of your upload" />
            <p style={{ color: inkFaint, fontSize: '0.72rem', margin: '6px 0 0' }}>Playback happens locally in your browser — the file is only sent when you press Detect.</p>
          </div>
        )}

        {kind === 'audio' && (
          <label style={{ display: 'block', marginTop: 12, border: `1px solid ${line}`, borderRadius: 8, padding: '0.8rem 1rem', color: inkSoft, fontSize: '0.82rem', cursor: 'pointer' }}>
            <input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac" hidden onChange={e => setReferenceFile(e.target.files?.[0] || null)} />
            {referenceFile ? `Reference recording: ${referenceFile.name}` : 'Optional reference recording for spectral voice consistency'}
          </label>
        )}

        {kind === 'bulk' ? (
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={submit} disabled={disabled}
              style={{ flex: 1, minWidth: 200, background: disabled ? '#e4e4e4' : ink, border: 'none', color: disabled ? '#9a9a9a' : '#fff', padding: '1rem', borderRadius: 6, fontSize: '0.95rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', minHeight: 52, fontFamily: 'inherit' }}>
              {busy ? 'Auditing…' : bulkRes ? 'Run audit again' : `Audit ${Math.min(urlCount, 50)} URL${urlCount === 1 ? '' : 's'}`}
            </button>
            <button onClick={exportCsv} disabled={disabled}
              style={{ background: '#fff', border: `1px solid ${ink}`, color: ink, padding: '1rem 1.4rem', borderRadius: 6, fontSize: '0.95rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', minHeight: 52, fontFamily: 'inherit' }}>
              Export CSV
            </button>
          </div>
        ) : (
          <>
            <button onClick={submit} disabled={disabled}
              style={{ width: '100%', marginTop: 14, background: disabled ? '#e4e4e4' : ink, border: 'none', color: disabled ? '#9a9a9a' : '#fff', padding: '1rem', borderRadius: 6, fontSize: '0.95rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', minHeight: 52, fontFamily: 'inherit' }}>
              {busy ? 'Analyzing…' : res ? `Analyze another ${kind}` : `Detect AI ${kind}`}
            </button>
            <p style={{ color: inkFaint, fontSize: '0.75rem', textAlign: 'center', marginTop: '0.6rem' }}>
              {kind === 'text' ? 'Nothing is stored — passages are analyzed transiently in memory.' : 'Files are decoded in server memory and discarded immediately. Never uploaded anywhere else.'}
            </p>
          </>
        )}

        {err && <div role="alert" style={{ background: '#f5f5f5', border: `1px solid ${ink}`, borderLeftWidth: 3, borderRadius: 4, padding: '0.9rem 1.1rem', color: ink, fontSize: '0.87rem', marginTop: '0.75rem' }}>{err}</div>}

        {/* Bulk results — same verdict-card shell as the single detectors */}
        {kind === 'bulk' && bulkRes && (
          <div style={{ border: `1px solid ${ink}`, borderRadius: 8, overflow: 'hidden', marginTop: '1.5rem', background: '#fff', animation: 'reveal 0.35s ease' }}>
            <div style={{ padding: '1.75rem 1.5rem', borderBottom: `1px solid ${line}` }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Audit summary</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 'clamp(2.8rem,9vw,4.2rem)', fontWeight: 700, color: ink, lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{bulkRes.count}</div>
                <div style={{ fontSize: '0.95rem', color: inkSoft, maxWidth: 320, lineHeight: 1.5 }}>URLs audited · <strong style={{ color: ink }}>{bulkFlagged}</strong> flagged at ≥50% AI probability</div>
              </div>
              <div style={{ marginTop: '0.9rem', fontSize: '0.76rem', color: inkFaint }}>Each row runs the full nine-layer image pipeline and gets a permanent SHA-256 permalink.</div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: inkFaint, background: surface }}>
                    <th style={{ padding: '8px 14px', fontWeight: 600 }}>URL</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>Score</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>Verdict</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>Top signals</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>Permalink</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkRes.rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${line}` }}>
                      <td style={{ padding: '8px 14px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.url}>
                        {r.error ? <span style={{ color: '#b45309' }}>{r.error}</span> : r.url}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: r.score >= 50 ? ink : inkSoft, fontVariantNumeric: 'tabular-nums' }}>{r.error ? '—' : `${r.score}%`}</td>
                      <td style={{ padding: '8px 10px' }}>{vmark(r.verdict).mark} {r.verdict || '—'}</td>
                      <td style={{ padding: '8px 10px', color: inkSoft }}>{(r.topSignals || []).join('; ') || '—'}</td>
                      <td style={{ padding: '8px 10px' }}>{r.permalink ? <Link href={r.permalink} style={{ color: ink, textDecoration: 'underline', textUnderlineOffset: 2 }}>view</Link> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '0.9rem 1.5rem', background: surface, fontSize: '0.78rem', color: inkSoft }}>
              Runs are recorded in an append-only audit log on the server. Results contain no image bytes — only forensic measurements.
            </div>
          </div>
        )}

        {/* Verdict card — same anatomy as the image results */}
        {kind !== 'bulk' && (<>
        {res && res.score != null && (
          <div style={{ border: `1px solid ${ink}`, borderRadius: 8, overflow: 'hidden', marginTop: '1.5rem', background: '#fff', animation: 'reveal 0.35s ease' }}>
            <div style={{ padding: '1.75rem 1.5rem', borderBottom: `1px solid ${line}` }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Verdict {vs?.mark} {vs?.note}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 'clamp(2.8rem,9vw,4.2rem)', fontWeight: 700, color: ink, lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }} aria-label={`AI probability ${res.score} percent`}>{displayScore}%</div>
                <div style={{ fontSize: '0.95rem', color: inkSoft, maxWidth: 280, lineHeight: 1.5 }}>{kind === 'text' ? 'strength of AI-associated authorship signals' : kind === 'audio' ? 'strength of synthetic-audio signals' : `chance this ${kind} is AI-generated`}</div>
              </div>
              <div style={{ marginTop: '0.9rem', fontSize: '0.8rem', color: inkFaint }}>
                {copy?.line1} · uncertainty band <strong style={{ color: inkSoft, fontWeight: 600 }}>{res.band?.label}</strong>
              </div>
            </div>

            {res.degraded && (
              <div style={{ padding: '0.7rem 1.5rem', background: surface, borderBottom: `1px solid ${line}`, fontSize: '0.8rem', color: ink, borderLeft: '3px solid #161616' }}>
                Reduced-evidence mode: {res.degradedReason} Treat this verdict as provisional.
              </div>
            )}

            <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${line}` }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.98rem', lineHeight: 1.7, color: ink }}>{copy?.line2}</p>
              <p style={{ margin: 0, fontSize: '0.85rem', color: inkSoft, lineHeight: 1.65 }}>{copy?.sub}</p>
              <div style={{ marginTop: '0.9rem', fontSize: '0.76rem', color: inkFaint, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>Confidence: <strong style={{ color: ink, fontWeight: 600 }}>{res.confidence}</strong></span>
                {res.layers?.models?.available && <span>Neural model attached ({res.layers.models.combined}%)</span>}
                {!res.layers?.models?.available && <span>Heuristic layers only</span>}
                {kind === 'audio' && res.layers?.waveform?.stats && <span>{res.layers.waveform.stats.durationSec}s · RMS {res.layers.waveform.stats.rms} · HF ratio {res.layers.waveform.stats.hfRatio}</span>}
                {kind === 'audio' && res.voiceConsistency && <span>Reference: {res.voiceConsistency.label.toLowerCase()}</span>}
                {kind === 'text' && res.layers?.statistics?.features && <span>{res.layers.statistics.features.words} words · burstiness {res.layers.statistics.features.burstiness} · TTR {res.layers.statistics.features.typeTokenRatio}</span>}
              </div>
            </div>

            {/* Localization: sentence heatmap (text) or waveform strip (audio) */}
            {kind === 'text' && res.saliency?.sentences?.length > 0 && (
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${line}` }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.7rem' }}>Where the suspicion lives — sentence-level heatmap</div>
                <p style={{ margin: '0 0 0.8rem', fontSize: '0.78rem', color: inkSoft, lineHeight: 1.6 }}>Darker sentences carry more machine-writing tells. Mean suspicion: {(res.saliency.mean * 100).toFixed(0)}%.</p>
                <div style={{ fontSize: '0.9rem', lineHeight: 2, color: ink }}>
                  {res.saliency.sentences.map(s => (
                    <span key={s.index} title={`${(s.suspicion * 100).toFixed(0)}% suspicious${s.reasons?.length ? ` — ${s.reasons.join('; ')}` : ''}`}
                      style={{ background: heat(s.suspicion), padding: '2px 2px', borderRadius: 2, marginRight: 4 }}>
                      {s.preview}{/[.!?…]$/.test(s.preview) ? '' : '. '}
                    </span>
                  ))}
                </div>
                {res.saliency.flagged?.length > 0 && (
                  <ul style={{ margin: '0.9rem 0 0', padding: 0, listStyle: 'none' }}>
                    {res.saliency.flagged.slice(0, 3).map(f => (
                      <li key={f.index} style={{ fontSize: '0.78rem', color: inkSoft, marginBottom: 4 }}>
                        <strong style={{ color: ink }}>Sentence {f.index + 1} ({(f.suspicion * 100).toFixed(0)}%)</strong>: “{f.preview.slice(0, 90)}{f.preview.length > 90 ? '…' : ''}”{f.reasons?.length ? ` — ${f.reasons.join(', ')}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {kind === 'audio' && res.waveform?.envelope?.length > 0 && (
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${line}` }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.7rem' }}>Waveform &amp; temporal suspicion strip</div>
                <Waveform result={res} />
              </div>
            )}
            {kind === 'audio' && res.voiceConsistency && (
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${line}` }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.7rem' }}>Reference recording comparison</div>
                <p style={{ margin: 0, color: inkSoft, fontSize: '0.85rem', lineHeight: 1.6 }}>{res.voiceConsistency.label} · distance {res.voiceConsistency.distance}. {res.voiceConsistency.evidence}</p>
              </div>
            )}

            {/* Actions */}
            <div style={{ padding: '1rem 1.5rem', background: surface }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                <button onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails} style={{ background: '#fff', border: '1px solid #c9c9c9', cursor: 'pointer', fontSize: '0.8rem', color: ink, padding: '7px 12px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 7, minHeight: 36, fontFamily: 'inherit' }}>
                  <span style={{ fontSize: '0.65rem', display: 'inline-block', transform: showDetails ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▸</span>
                  {showDetails ? 'Hide forensic breakdown' : 'View forensic breakdown'}
                </button>
                <button onClick={handleShare} disabled={sharing} style={{ background: '#fff', border: sharing ? '1px solid #d0d0d0' : `1px solid ${ink}`, color: sharing ? inkFaint : ink, borderRadius: 5, padding: '7px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: sharing ? 'wait' : 'pointer', minHeight: 36, fontFamily: 'inherit' }}>
                  {sharing ? 'Creating link…' : 'Share report'}
                </button>
              </div>
              {shareUrl && (
                <div style={{ fontSize: '0.76rem', color: ink, background: '#fff', border: `1px solid ${line}`, borderRadius: 5, padding: '8px 10px', wordBreak: 'break-all' }}>
                  Link copied — <a href={shareUrl} style={{ color: ink }}>{shareUrl}</a> (results only, expires in 7 days)
                </div>
              )}

              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e0e0e0', fontSize: '0.8rem', color: inkSoft }}>
                {feedbackSent ? (
                  <span style={{ color: ink }}>Thanks — your feedback feeds the weekly calibration job.</span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    Was this verdict right?
                    <button onClick={() => sendFeedback('correct')} style={{ background: '#fff', border: `1px solid ${ink}`, color: ink, borderRadius: 5, padding: '4px 10px', fontSize: '0.76rem', cursor: 'pointer', fontFamily: 'inherit' }}>Correct</button>
                    <button onClick={() => sendFeedback('wrong_real')} style={{ background: '#fff', border: '1px solid #c9c9c9', color: inkSoft, borderRadius: 5, padding: '4px 10px', fontSize: '0.76rem', cursor: 'pointer', fontFamily: 'inherit' }}>It&apos;s actually real</button>
                    <button onClick={() => sendFeedback('wrong_ai')} style={{ background: '#fff', border: '1px solid #c9c9c9', color: inkSoft, borderRadius: 5, padding: '4px 10px', fontSize: '0.76rem', cursor: 'pointer', fontFamily: 'inherit' }}>It&apos;s actually AI</button>
                  </span>
                )}
              </div>

              {showDetails && (
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #e0e0e0', animation: 'fadeUp 0.2s ease' }}>
                  <div style={{ fontSize: '0.7rem', color: inkFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>Model scores</div>
                  {res.layers?.models?.available ? (
                    (res.layers.models.results || []).map(m => (
                      <div key={m.name} style={{ marginBottom: '0.9rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                          <span style={{ color: inkSoft }}>{m.shortName} <span style={{ color: inkFaint, fontSize: '0.72rem' }}>({Math.round((m.weight || 0) * 100)}% weight)</span></span>
                          <span style={{ color: ink, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{m.aiScore}%</span>
                        </div>
                        <div style={{ background: '#e8e8e8', borderRadius: 2, height: 5, overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: m.aiScore >= 50 ? ink : '#a8a8a8', borderRadius: 2, width: `${m.aiScore}%`, transition: 'width 0.7s ease' }} />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p style={{ color: inkSoft, fontSize: '0.82rem', margin: '0 0 0.8rem' }}>No neural classifier attached — verdict based on heuristic layers only{res.layers?.models?.reason ? ` (${res.layers.models.reason})` : ''}.</p>
                  )}
                  {layerDefs.map(l => <LayerBlock key={l.title} {...l} />)}
                  {kind === 'text' && res.layers?.statistics?.features && (
                    <div style={{ marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px solid #e8e8e8' }}>
                      <div style={{ fontSize: '0.8rem', color: ink, fontWeight: 600, marginBottom: 6 }}>Measured features</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '4px 14px', fontSize: '0.76rem', color: inkSoft, fontVariantNumeric: 'tabular-nums' }}>
                        {Object.entries(res.layers.statistics.features).filter(([k]) => k !== 'phraseHits').map(([k, val]) => (
                          <span key={k}>{k}: <strong style={{ color: ink }}>{String(val)}</strong></span>
                        ))}
                        {res.layers.statistics.features.phraseHits?.length > 0 && (
                          <span style={{ gridColumn: '1 / -1' }}>cliché hits: <strong style={{ color: ink }}>{res.layers.statistics.features.phraseHits.join(', ')}</strong></span>
                        )}
                      </div>
                    </div>
                  )}
                  {kind === 'audio' && res.layers?.waveform?.stats && (
                    <div style={{ marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px solid #e8e8e8' }}>
                      <div style={{ fontSize: '0.8rem', color: ink, fontWeight: 600, marginBottom: 6 }}>PCM measurements</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '4px 14px', fontSize: '0.76rem', color: inkSoft, fontVariantNumeric: 'tabular-nums' }}>
                        <span>duration: <strong style={{ color: ink }}>{res.layers.waveform.stats.durationSec}s</strong></span>
                        <span>rms: <strong style={{ color: ink }}>{res.stats.rms}</strong></span>
                        <span>peak: <strong style={{ color: ink }}>{res.layers.waveform.stats.peak}</strong></span>
                        <span>clipped: <strong style={{ color: ink }}>{(res.layers.waveform.stats.clippedRatio * 100).toFixed(3)}%</strong></span>
                        <span>near-zero samples: <strong style={{ color: ink }}>{(res.layers.waveform.stats.nearZeroRatio * 100).toFixed(2)}%</strong></span>
                        <span>zero-crossing rate: <strong style={{ color: ink }}>{res.layers.waveform.stats.zeroCrossRate}</strong></span>
                        <span>HF/LF energy ratio: <strong style={{ color: ink }}>{res.stats.hfRatio}</strong></span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {res && res.score == null && (
          <div style={{ marginTop: '1rem', padding: '0.9rem 1.1rem', border: `1px solid ${line}`, borderRadius: 8, fontSize: '0.87rem', color: inkSoft }}>
            {(res.signals?.[0]?.label) || 'Not enough input for a reliable analysis.'}
          </div>
        )}

        </>)}
        {/* Session history */}
        {history.length > 0 && (
          <section aria-label="Your recent analyses" style={{ marginTop: '2rem', borderTop: `1px solid ${line}`, paddingTop: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h2 style={{ fontSize: '0.72rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Recent {kind} analyses (this device)</h2>
              <button onClick={() => { try { const all = (JSON.parse(localStorage.getItem(HISTORY_KEY)) || []).filter(h => h.kind !== kind); localStorage.setItem(HISTORY_KEY, JSON.stringify(all)) } catch { }; setHistory([]) }}
                style={{ background: 'none', border: 'none', color: inkSoft, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}>Clear</button>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {history.slice(0, 6).map(h => (
                <li key={h.id + h.at} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 2px', borderBottom: `1px solid ${line}`, fontSize: '0.8rem' }}>
                  <span style={{ color: inkFaint, fontSize: '0.72rem', width: 28 }}>{vmark(h.level).mark}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: inkSoft }}>{h.name || h.line1}</span>
                  <span style={{ color: ink, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{h.score}%</span>
                  <span style={{ color: inkFaint, fontSize: '0.72rem', fontVariantNumeric: 'tabular-nums' }}>{new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
            <p style={{ color: inkFaint, fontSize: '0.7rem', margin: '8px 2px 0' }}>Stored only in your browser — never on our servers.</p>
          </section>
        )}

        {/* Cross-links to sibling tools */}
        <section style={{ marginTop: '2.5rem', borderTop: `1px solid ${line}`, paddingTop: '1.5rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
          <span style={{ color: inkFaint }}>Also check:</span>
          <Link href="/" style={{ color: ink, textDecoration: 'underline', textUnderlineOffset: 3 }}>AI image detector</Link>
          {kind !== 'text' && <Link href="/isitext" style={{ color: ink, textDecoration: 'underline', textUnderlineOffset: 3 }}>AI text detector</Link>}
          {kind !== 'audio' && <Link href="/isitaudio" style={{ color: ink, textDecoration: 'underline', textUnderlineOffset: 3 }}>AI audio detector</Link>}
          <Link href="/bulk-audit" style={{ color: ink, textDecoration: 'underline', textUnderlineOffset: 3 }}>Bulk audit</Link>
        </section>
      </main>

      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes reveal { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        :focus-visible { outline: 2px solid #161616; outline-offset: 2px; border-radius: 2px }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important } }
      `}</style>
    </div>
  )
}
// monochrome heat: 0 → white, 1 → near-black ink
function heat(v) {
  const t = Math.max(0, Math.min(1, v))
  const c = Math.round(255 - t * (255 - 22))
  return `rgb(${c},${c},${c})`
}

// ─── Waveform view: peak-envelope bars + suspicion strip underneath ──────────
function Waveform({ result }) {
  const env = result.waveform.envelope || []
  const strip = result.waveform.suspicionStrip || []
  const W = 800, H = 90, mid = H / 2
  const bw = Math.max(1.5, W / Math.max(env.length, 1) - 1)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} width="100%" height="auto" role="img" aria-label="Audio waveform with per-window suspicion coloring" style={{ display: 'block', background: '#fafafa', border: `1px solid ${line}`, borderRadius: 6 }}>
        {env.map((p, i) => {
          const h = Math.max(2, p * (H - 10))
          const x = (i * W) / env.length
          const susp = strip[i] ?? 0.5
          const fill = susp >= 0.7 ? '#161616' : susp >= 0.5 ? '#6b6b6b' : '#bdbdbd'
          return (
            <g key={i}>
              <rect x={x} y={mid - h / 2} width={bw} height={h} fill={fill} rx={0.75} />
              <rect x={x} y={H + 4} width={bw} height={8} fill={heat(susp)} opacity={0.9} />
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: inkFaint, marginTop: 6 }}>
        <span>{result.waveform.durationSec}s · 16 kHz mono decode</span>
        <span>lower strip = per-window suspicion (darker = more synthetic-sounding)</span>
      </div>
    </div>
  )
}

// ─── Layer block (same design as the image forensic breakdown) ────────────────
function LayerBlock({ icon, title, layer }) {
  if (!layer || !(layer.signals || []).length) return null
  const sc = layer.score ?? layer.aiScore
  return (
    <div style={{ marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px solid #e8e8e8' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 6 }}>
        <span style={{ color: ink, fontWeight: 600 }}>{icon} · {title}</span>
        {sc !== undefined && <span style={{ color: sc >= 50 ? ink : inkFaint, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{sc}% suspicious</span>}
      </div>
      {sc !== undefined && (
        <div style={{ background: '#ececec', borderRadius: 3, height: 5, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', background: sc >= 50 ? ink : '#b3b3b3', borderRadius: 3, width: `${sc}%`, transition: 'width 0.7s ease' }} />
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {layer.signals.map((s, i) => <SignalChip key={i} s={s} />)}
      </div>
    </div>
  )
}
