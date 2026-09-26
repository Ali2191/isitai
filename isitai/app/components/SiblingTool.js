'use client'
// Shared UI for the text/audio sibling tools — same architecture as the image
// analyzer: one fetch, fused score + band + verdict + signal list.
import { useState } from 'react'

const box = { background: '#151515', border: '1px solid #2a2a2a', borderRadius: 12, padding: 20, marginTop: 20 }

export default function SiblingTool({ kind, api, title, intro, placeholder, acceptHint }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [res, setRes] = useState(null)
  const [text, setText] = useState('')

  async function submit() {
    setErr(null); setRes(null); setBusy(true)
    try {
      let r
      if (kind === 'text') {
        r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      } else {
        const f = document.getElementById('audio-file').files?.[0]
        if (!f) throw new Error('Choose an audio file first')
        const fd = new FormData(); fd.append('file', f)
        r = await fetch(api, { method: 'POST', body: fd })
      }
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setRes(j)
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  const v = res?.verdict
  const cells = res?.saliency?.cells
  const G = res?.saliency?.grid || 8
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '40px 20px', color: '#eee', fontFamily: 'ui-sans-serif, system-ui' }}>
      <nav style={{ fontSize: 14, color: '#888' }}>
        <a href="/" style={{ color: '#8ab4f8' }}>Images</a> · <a href="/isitext" style={{ color: kind === 'text' ? '#fff' : '#8ab4f8' }}>Text</a> · <a href="/isitaudio" style={{ color: kind === 'audio' ? '#fff' : '#8ab4f8' }}>Audio</a> · <a href="/provenance" style={{ color: '#8ab4f8' }}>Provenance</a> · <a href="/benchmark" style={{ color: '#8ab4f8' }}>Benchmark</a> · <a href="/status" style={{ color: '#8ab4f8' }}>Status</a>
      </nav>
      <h1 style={{ marginTop: 16 }}>{title}</h1>
      <p style={{ color: '#aaa', lineHeight: 1.6 }}>{intro}</p>
      {kind === 'text' ? (
        <textarea value={text} onChange={e => setText(e.target.value)} rows={10} placeholder={placeholder}
          style={{ width: '100%', boxSizing: 'border-box', background: '#111', color: '#eee', border: '1px solid #333', borderRadius: 10, padding: 14, fontSize: 15 }} />
      ) : (
        <label style={box}>
          <div style={{ textAlign: 'center', cursor: 'pointer' }}>{acceptHint}</div>
          <input id="audio-file" type="file" accept="audio/*" hidden />
        </label>
      )}
      <button onClick={submit} disabled={busy || (kind === 'text' && text.trim().length < 50)}
        style={{ marginTop: 14, padding: '12px 26px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Analyzing…' : `Detect ${kind}`}
      </button>
      {err && <p style={{ color: '#f87171' }}>{err}</p>}
      {res && (
        <div style={box}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span style={{ fontSize: 42, fontWeight: 800, color: v?.color || '#eee' }}>{res.score ?? '—'}</span>
            <span style={{ fontSize: 18 }}>{v?.emoji} {v?.line1 || res.verdictLine}</span>
          </div>
          {res.band && <p style={{ color: '#888' }}>Confidence band: {res.band.lo}–{res.band.hi} ({res.confidence || res.band.width || ''})</p>}
          {(res.signals || res.features?.signals || []).slice(0, 12).map((s, i) => (
            <p key={i} style={{ margin: '6px 0', color: s.suspicious ? '#fb923c' : '#9ca3af' }}>{s.suspicious ? '▲' : '·'} {s.label || s.name}{s.why ? ` — ${s.why}` : ''}</p>
          ))}
          {res.sha256 && <p style={{ color: '#666', fontSize: 12 }}>File hash: <code>{res.sha256.slice(0, 16)}…</code> — reproducible verdict history: <a href={`/i/${res.sha256}`} style={{ color: '#8ab4f8' }}>/i/{res.sha256.slice(0, 12)}…</a></p>}
          {cells?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={{ color: '#888', fontSize: 13, margin: '0 0 6px' }}>Region suspicion map ({G}×{G}):</p>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${G},1fr)`, gap: 2, maxWidth: 220 }}>
                {cells.map((val, i) => (
                  <div key={i} title={`Region ${i + 1}: ${(val * 100).toFixed(0)}% suspicion`}
                    style={{ aspectRatio: '1', borderRadius: 2, background: val >= 0.66 ? '#ef4444' : val >= 0.4 ? '#f59e0b' : val >= 0.2 ? '#3f3f46' : '#1c1c1e' }} />
                ))}
              </div>
            </div>
          )}
          <p style={{ color: '#666', fontSize: 12 }}>{res.privacy || 'Nothing was stored. Analysis happened transiently in memory.'}</p>
        </div>
      )}
    </main>
  )
}
