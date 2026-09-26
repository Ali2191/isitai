'use client'
import { useEffect, useState } from 'react'

const box = { background: '#151515', border: '1px solid #2a2a2a', borderRadius: 12, padding: 20, marginTop: 20 }
const th = { textAlign: 'left', color: '#888', padding: '6px 10px', borderBottom: '1px solid #222' }
const td = { padding: '6px 10px', borderBottom: '1px solid #1d1d1d' }

function Row({ name, m }) {
  if (!m) return <tr><td style={td}>{name}</td><td style={td} colSpan={6}>no data</td></tr>
  return (
    <tr>
      <td style={td}>{name}</td>
      <td style={td}>{m.n}</td>
      <td style={td}><b>{m.accuracyPct}%</b></td>
      <td style={td}>{m.precisionPct != null ? m.precisionPct + '%' : '—'}</td>
      <td style={td}>{m.recallPct}%</td>
      <td style={td}>{m.auc}</td>
      <td style={td}>{m.confusion.tp}/{m.confusion.fp}/{m.confusion.fn}/{m.confusion.tn}</td>
    </tr>
  )
}

export default function BenchmarkClient() {
  const [d, setD] = useState(null)
  useEffect(() => { fetch('/api/benchmark').then(r => r.json()).then(setD).catch(() => setD({ note: 'benchmark API unreachable' })) }, [])
  if (!d) return <p style={box}>Loading benchmark…</p>
  const sets = Object.entries(d.datasets || {})
  return (
    <div>
      {d.note && <div style={{ ...box, borderColor: '#7c5a12', color: '#fbbf24' }}>{d.note}</div>}
      <div style={box}>
        <h3 style={{ marginTop: 0 }}>Results {d.generatedAt ? `(generated ${new Date(d.generatedAt).toLocaleString()})` : ''}</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr><th style={th}>Dataset</th><th style={th}>Samples</th><th style={th}>Accuracy</th><th style={th}>Precision (AI)</th><th style={th}>Recall (AI)</th><th style={th}>ROC-AUC</th><th style={th}>TP/FP/FN/TN</th></tr></thead>
          <tbody>
            {sets.map(([k, m]) => <Row key={k} name={k} m={m} />)}
            <Row name="Overall" m={d.overall} />
          </tbody>
        </table>
      </div>
      <div style={box}>
        <h3 style={{ marginTop: 0 }}>Methodology</h3>
        <ul style={{ color: '#aaa', lineHeight: 1.8 }}>
          <li>Reference sets: DiffusionDB (SDXL/Midjourney outputs), GenImage (diffusion + GAN, balanced crops), WildRF (in-the-wild social media photos).</li>
          <li>Every sample passes through the identical production fusion pipeline (EXIF/C2PA · PRNU/double-compression · JPEG structure · anatomy · saliency · ML ensemble when configured).</li>
          <li>Decision threshold fixed at score ≥ 50; AUC is threshold-free (Mann–Whitney U).</li>
          <li>We store only labels and scores — never dataset pixels — to respect redistribution licenses.</li>
          <li>Competitor APIs are benchmarked on the same held-out samples; deltas published in the changelog.</li>
        </ul>
      </div>
    </div>
  )
}
