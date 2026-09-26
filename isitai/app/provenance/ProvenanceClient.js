'use client'
import { useState } from 'react'

const box = { background: '#151515', border: '1px solid #2a2a2a', borderRadius: 12, padding: 20, marginTop: 20 }
const chip = (ok) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: ok ? '#123b1e' : '#3b2412', color: ok ? '#4ade80' : '#fb923c' })

export default function ProvenanceClient() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [res, setRes] = useState(null)
  const [name, setName] = useState('')

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
    <div>
      <label style={box}>
        <div style={{ textAlign: 'center', padding: 20, cursor: 'pointer' }}>
          {busy ? 'Reading certificate chain…' : name ? `Re-select file (current: ${name})` : 'Click to choose an image file'}
        </div>
        <input type="file" accept="image/*,.tif,.tiff" hidden onChange={e => onFile(e.target.files?.[0])} />
      </label>
      {err && <p style={{ color: '#f87171' }}>{err}</p>}
      {res && (
        <div>
          <div style={box}>
            <h3 style={{ marginTop: 0 }}>File fingerprint</h3>
            <p style={{ wordBreak: 'break-all', color: '#9cdcfe', fontSize: 13 }}>SHA-256: {res.sha256}</p>
            <p style={{ color: '#888', fontSize: 13 }}>{res.fileName} · {(res.sizeBytes / 1024).toFixed(1)} KB · read {res.detectedAt}</p>
            <p style={{ fontSize: 13 }}><a style={{ color: '#8ab4f8' }} href={`/i/${res.sha256}`}>View public verdict history for this exact file →</a></p>
          </div>
          <div style={box}>
            <h3 style={{ marginTop: 0 }}>C2PA Content Credentials <span style={chip(res.c2pa?.present)}>{res.c2pa?.present ? 'manifest found' : 'no manifest'}</span></h3>
            {res.c2pa?.present ? (
              <>
                <p style={{ color: '#aaa', fontSize: 13 }}>{res.c2pa.note}</p>
                {res.c2pa.generator && <p><b>Generator:</b> {res.c2pa.generator}</p>}
                {res.c2pa.title && <p><b>Title:</b> {res.c2pa.title}</p>}
                {res.c2pa.instanceId && <p style={{ wordBreak: 'break-all' }}><b>Instance ID:</b> {res.c2pa.instanceId}</p>}
                {res.c2pa.assertions?.length > 0 && <p><b>Assertions:</b> {res.c2pa.assertions.join(', ')}</p>}
              </>
            ) : (
              <p style={{ color: '#aaa' }}>This file carries no C2PA manifest. Most photos on social media have been stripped of credentials by platforms — absence does not prove anything about authenticity.</p>
            )}
          </div>
          {res.exif && (
            <div style={box}>
              <h3 style={{ marginTop: 0 }}>Camera &amp; edit history (EXIF/XMP)</h3>
              <table style={{ fontSize: 14, borderCollapse: 'collapse' }}>
                <tbody>
                  {[['Make', res.exif.make], ['Model', res.exif.model], ['Lens', res.exif.lensModel], ['Software', res.exif.software], ['Created', res.exif.createTime], ['Modified', res.exif.modifyTime], ['Artist', res.exif.artist], ['Copyright', res.exif.copyright], ['GPS embedded', res.exif.gpsPresent ? 'yes (hidden here for privacy)' : 'no']].filter(([, v]) => v != null).map(([k, v]) => (
                    <tr key={k}><td style={{ color: '#888', paddingRight: 16, verticalAlign: 'top' }}>{k}</td><td>{String(v)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {res.chain?.length > 0 && (
            <div style={box}>
              <h3 style={{ marginTop: 0 }}>Reconstructed chain of custody</h3>
              <ol>{res.chain.map((c, i) => <li key={i}>{c.step}: <b>{c.by || 'unknown'}</b>{c.at ? ` @ ${c.at}` : ''}</li>)}</ol>
            </div>
          )}
          {res.aiToolSignals?.length > 0 && (
            <div style={{ ...box, borderColor: '#7c2d12' }}>
              <h3 style={{ marginTop: 0, color: '#fb923c' }}>⚠️ AI-tool signals in metadata</h3>
              <ul>{res.aiToolSignals.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
