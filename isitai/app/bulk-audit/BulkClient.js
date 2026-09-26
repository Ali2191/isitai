'use client'
import { useState } from 'react'

const box = { background: '#151515', border: '1px solid #2a2a2a', borderRadius: 12, padding: 20, marginTop: 20 }
const td = { padding: '6px 10px', borderBottom: '1px solid #1d1d1d', fontSize: 13 }

export default function BulkClient() {
  const [csv, setCsv] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)

  async function run(format) {
    setBusy(true); setErr(null); setRes(null)
    try {
      const r = await fetch('/api/bulk' + (format === 'csv' ? '?format=csv' : ''), {
        method: 'POST', headers: { 'Content-Type': 'text/csv', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: csv,
      })
      if (format === 'csv') {
        if (!r.ok) throw new Error((await r.json()).error || 'failed')
        const blob = await r.blob()
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'isitai-bulk-audit.csv'; a.click()
      } else {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
        setRes(j)
      }
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={8} placeholder={'https://example.com/photo1.jpg\nhttps://example.com/suspect.png'} style={{ width: '100%', boxSizing: 'border-box', background: '#111', color: '#eee', border: '1px solid #333', borderRadius: 10, padding: 14, fontFamily: 'monospace', fontSize: 13 }} />
      <input value={key} onChange={e => setKey(e.target.value)} type="password" placeholder="Team API key (Bearer)" style={{ marginTop: 10, width: '100%', boxSizing: 'border-box', background: '#111', color: '#eee', border: '1px solid #333', borderRadius: 10, padding: 12 }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button onClick={() => run('json')} disabled={busy || !csv.trim()} style={{ padding: '12px 22px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{busy ? 'Auditing…' : 'Run audit (JSON)'}</button>
        <button onClick={() => run('csv')} disabled={busy || !csv.trim()} style={{ padding: '12px 22px', borderRadius: 10, border: '1px solid #333', background: 'transparent', color: '#eee', cursor: 'pointer' }}>Export CSV</button>
      </div>
      {err && <p style={{ color: '#f87171' }}>{err}</p>}
      {res && (
        <div style={box}>
          <h3 style={{ marginTop: 0 }}>{res.count} URLs audited</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', color: '#888' }}><th style={td}>URL</th><th style={td}>Score</th><th style={td}>Verdict</th><th style={td}>Top signals</th><th style={td}>Permalink</th></tr></thead>
            <tbody>{res.rows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.url}>{r.error ? <span style={{ color: '#f87171' }}>{r.error}</span> : r.url}</td>
                <td style={td}>{r.score ?? '—'}</td><td style={td}>{r.verdict || '—'}</td>
                <td style={td}>{(r.topSignals || []).join('; ')}</td>
                <td style={td}>{r.permalink ? <a href={r.permalink} style={{ color: '#8ab4f8' }}>view</a> : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
