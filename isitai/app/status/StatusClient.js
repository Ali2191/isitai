'use client'
import { useEffect, useState } from 'react'

const box = { background: '#151515', border: '1px solid #2a2a2a', borderRadius: 12, padding: 20, marginTop: 20 }
const dot = ok => ({ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: ok ? '#4ade80' : '#fb923c', marginRight: 8 })

export default function StatusClient() {
  const [s, setS] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => fetch('/api/status').then(r => r.json()).then(setS).catch(e => setErr(String(e)))
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [])

  if (err) return <p style={{ color: '#f87171' }}>{err}</p>
  if (!s) return <p>Loading status…</p>
  const eps = Object.entries(s.metrics?.endpoints || {})
  return (
    <div>
      <div style={box}>
        <h3 style={{ margin: 0 }}><span style={dot(s.overall === 'operational')} />Overall: {s.overall}</h3>
        {s.notice && <p style={{ color: '#fb923c' }}>{s.notice}</p>}
        <p style={{ color: '#888', fontSize: 13 }}>Updated {s.time} · uptime (this instance) {s.metrics.uptimeSec}s</p>
      </div>
      <div style={box}>
        <h3 style={{ marginTop: 0 }}>Pipeline components</h3>
        <ul style={{ lineHeight: 1.9 }}>
          <li><span style={dot(s.components.hfInference.enabled)} />Hugging Face ensemble {s.components.hfInference.enabled ? `(${s.components.hfInference.models} models)` : '(not configured)'}</li>
          <li><span style={dot(s.components.selfHostedWorker.enabled)} />Self-hosted worker {s.components.selfHostedWorker.enabled ? `(${s.components.selfHostedWorker.url})` : '(not configured)'}</li>
          <li><span style={dot(s.components.ffmpeg.available)} />Video keyframe extraction (ffmpeg)</li>
          <li><span style={dot(true)} />Forensic core: PRNU · JPEG double-compression · anatomy · saliency (always on)</li>
        </ul>
      </div>
      <div style={box}>
        <h3 style={{ marginTop: 0 }}>Accuracy & trust</h3>
        <p>{s.accuracyLast30d?.samples ? <>Last 30 days: <b>{s.accuracyLast30d.agreementPct}% agreement</b> with user-confirmed ground truth ({s.accuracyLast30d.samples} samples).</> : 'Not enough feedback samples yet to publish an agreement figure.'}</p>
        <p>{s.registry ? <>{s.registry.uniqueImages.toLocaleString()} unique images indexed · {s.registry.totalAnalyses.toLocaleString()} total analyses · {s.registry.cacheHitsSaved.toLocaleString()} repeat-computations saved by the verdict registry.</> : 'Registry stats unavailable.'}</p>
        <p style={{ color: '#888', fontSize: 13 }}>{s.calibration ? `Threshold calibration published ${new Date(s.calibration.publishedAt).toLocaleDateString()} (${s.calibration.buckets} score buckets).` : 'No calibration published yet — raw fusion thresholds in use.'}</p>
      </div>
      {eps.length > 0 && (
        <div style={box}>
          <h3 style={{ marginTop: 0 }}>Endpoint metrics (this instance)</h3>
          <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', color: '#888' }}><th>Endpoint</th><th>Calls</th><th>Errors</th><th>p-EWMA latency</th></tr></thead>
            <tbody>{eps.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v.count}</td><td>{v.errors}</td><td>{v.ewmaLatencyMs} ms</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
