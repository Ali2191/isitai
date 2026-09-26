'use client'
import { useState } from 'react'
import Link from 'next/link'
import ToolPage, { ink, inkSoft, inkFaint, line, surface } from '../components/ToolChrome'

// ─── Shared card styling — same hairline/monochrome language as the image tool ─
const card = { border: `1px solid ${line}`, borderRadius: 8, background: '#fff', padding: '1.4rem 1.5rem', marginTop: '1.25rem' }
const h3 = { fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em', margin: '0 0 0.6rem', color: ink }
const chipStyle = (ok) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, marginLeft: 8, verticalAlign: 'middle', background: ok ? '#eef7ee' : surface, color: ok ? '#1d6b2f' : inkSoft, border: `1px solid ${ok ? '#cde5cd' : line}` })
const mono = { wordBreak: 'break-all', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8rem', color: inkSoft }

export default function ProvenanceClient() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [res, setRes] = useState(null)
  const [name, setName] = useState('')
  const [dragOver, setDragOver] = useState(false)

  async function onFile(f) {
    if (!f) return
    setName(f.name); setErr(null); setRes(null); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await fetch('/api/provenance', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      setRes(j)
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <ToolPage
      eyebrow="IsItAI — Provenance & Content Credentials"
      title="Who made this file, and what happened to it?"
      intro={<>C2PA “Content Credentials” embed a signed history inside an image — but almost no tool lets normal people read them. Upload a photo (JPEG/PNG/WebP/TIFF) and we parse the certificate chain plus classic EXIF/XMP metadata, in plain language. Your file is analyzed in memory and discarded — nothing is stored or logged.</>}
    >
      {/* Drop zone — identical treatment to the audio detector */}
      <label
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f) onFile(f) }}
        style={{ display: 'block', border: `1.5px dashed ${dragOver ? ink : '#c9c9c9'}`, borderRadius: 8, background: dragOver ? surface : '#fff', padding: '2.2rem 1.5rem', textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s, background .15s' }}
      >
        <input type="file" accept="image/*,.tif,.tiff" hidden onChange={e => onFile(e.target.files?.[0])} />
        {busy ? (
          <div style={{ color: inkSoft, fontSize: '0.95rem' }}>Reading certificate chain…</div>
        ) : name ? (
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>⛓</div>
            <div title={name} style={{ fontWeight: 600, color: ink, fontSize: '0.95rem', maxWidth: '100%', margin: '0 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{name}</div>
            <div style={{ color: inkFaint, fontSize: '0.78rem', marginTop: 4 }}>click to replace</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>⬆</div>
            <div style={{ fontWeight: 600, color: ink, fontSize: '0.95rem' }}>Drop an image, or click to choose</div>
            <div style={{ color: inkFaint, fontSize: '0.78rem', marginTop: 4 }}>JPEG · PNG · WebP · TIFF — parsed locally, never stored</div>
          </div>
        )}
      </label>

      {err && <p style={{ color: '#a12622', marginTop: '0.9rem', fontSize: '0.9rem' }}>{err}</p>}

      {res && (
        <div>
          {/* File fingerprint */}
          <section style={card}>
            <h3 style={h3}>File fingerprint</h3>
            <p style={{ ...mono, margin: '0 0 4px' }}>SHA-256: {res.sha256}</p>
            <p style={{ color: inkFaint, fontSize: '0.82rem', margin: '0 0 8px' }}>{res.fileName} · {(res.sizeBytes / 1024).toFixed(1)} KB · read {res.detectedAt}</p>
            <Link href={`/i/${res.sha256}`} style={{ color: ink, fontSize: '0.86rem', textDecoration: 'underline', textUnderlineOffset: 3 }}>View public verdict history for this exact file →</Link>
          </section>

          {/* C2PA */}
          <section style={card}>
            <h3 style={h3}>C2PA Content Credentials<span style={chipStyle(res.c2pa?.present)}>{res.c2pa?.present ? 'manifest found' : 'no manifest'}</span></h3>
            {res.c2pa?.present ? (
              <>
                <p style={{ color: inkSoft, fontSize: '0.9rem', lineHeight: 1.7, margin: '0 0 10px' }}>{res.c2pa.note}</p>
                {res.c2pa.generator && <p style={{ fontSize: '0.9rem', margin: '4px 0' }}><b>Generator:</b> {res.c2pa.generator}</p>}
                {res.c2pa.title && <p style={{ fontSize: '0.9rem', margin: '4px 0' }}><b>Title:</b> {res.c2pa.title}</p>}
                {res.c2pa.instanceId && <p style={{ fontSize: '0.9rem', margin: '4px 0', ...mono }}><b>Instance ID:</b> {res.c2pa.instanceId}</p>}
                {res.c2pa.assertions?.length > 0 && <p style={{ fontSize: '0.9rem', margin: '4px 0' }}><b>Assertions:</b> {res.c2pa.assertions.join(', ')}</p>}
              </>
            ) : (
              <p style={{ color: inkSoft, fontSize: '0.9rem', lineHeight: 1.7, margin: 0 }}>This file carries no C2PA manifest. Most photos on social media have been stripped of credentials by platforms — absence does not prove anything about authenticity.</p>
            )}
          </section>

          {/* EXIF / XMP */}
          {res.exif && (
            <section style={card}>
              <h3 style={h3}>Camera &amp; edit history (EXIF/XMP)</h3>
              <table style={{ fontSize: '0.88rem', borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  {[['Make', res.exif.make], ['Model', res.exif.model], ['Lens', res.exif.lensModel], ['Software', res.exif.software], ['Created', res.exif.createTime], ['Modified', res.exif.modifyTime], ['Artist', res.exif.artist], ['Copyright', res.exif.copyright], ['GPS embedded', res.exif.gpsPresent ? 'yes (hidden here for privacy)' : 'no']].filter(([, v]) => v != null).map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: `1px solid ${line}` }}>
                      <td style={{ color: inkFaint, paddingRight: 16, verticalAlign: 'top', padding: '6px 16px 6px 0', width: 140 }}>{k}</td>
                      <td style={{ padding: '6px 0', color: ink }}>{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!res.exif.make && !res.exif.software) && <p style={{ color: inkFaint, fontSize: '0.85rem', marginTop: 8 }}>No camera fields present — typical for generator output and platform-stripped uploads alike.</p>}
            </section>
          )}

          {/* Chain of custody */}
          {res.chain?.length > 0 && (
            <section style={card}>
              <h3 style={h3}>Reconstructed chain of custody</h3>
              <ol style={{ paddingLeft: '1.2rem', color: inkSoft, fontSize: '0.9rem', lineHeight: 1.9 }}>
                {res.chain.map((c, i) => <li key={i}>{c.step}: <b style={{ color: ink }}>{c.by || 'unknown'}</b>{c.at ? ` @ ${c.at}` : ''}</li>)}
              </ol>
            </section>
          )}

          {/* AI-tool signals */}
          {res.aiToolSignals?.length > 0 && (
            <section style={{ ...card, borderColor: ink }}>
              <h3 style={{ ...h3, color: ink }}>⚠ AI-tool signals in metadata</h3>
              <ul style={{ paddingLeft: '1.2rem', color: inkSoft, fontSize: '0.9rem', lineHeight: 1.9, margin: 0 }}>
                {res.aiToolSignals.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </section>
          )}

          <p style={{ color: inkFaint, fontSize: '0.8rem', marginTop: '1.5rem', lineHeight: 1.7 }}>
            Want the full nine-layer forensic verdict instead of just the certificate chain? <Link href="/" style={{ color: ink, textDecoration: 'underline', textUnderlineOffset: 2 }}>Run the image detector →</Link>
          </p>
        </div>
      )}
    </ToolPage>
  )
}
