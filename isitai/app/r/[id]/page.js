'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function ReportPage({ params }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const resolved = typeof params === 'object' && params !== null ? (params.id ?? null) : params

  useEffect(() => {
    if (!resolved) return
    let cancelled = false
    fetch(`/api/report/${encodeURIComponent(resolved)}`)
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'Report unavailable')
        if (!cancelled) setData(j)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [resolved])

  const bg = '#0a0a0a', text = '#f4f4f5', muted = '#a1a1aa', border = 'rgba(255,255,255,0.1)'

  return (
    <main style={{ minHeight: '100vh', background: bg, color: text, fontFamily: 'system-ui, sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <Link href="/" style={{ color: '#7c3aed', textDecoration: 'none', fontWeight: 700, fontSize: 18 }}>🔍 IsItAI</Link>
          <span style={{ color: muted, fontSize: 13 }}>Shareable forensic report</span>
        </header>

        {loading && <p style={{ color: muted }}>Loading report…</p>}
        {error && (
          <section style={{ border: `1px solid ${border}`, borderRadius: 16, padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 40 }}>🕳️</p>
            <h1 style={{ fontSize: 22, margin: '8px 0' }}>Report not found</h1>
            <p style={{ color: muted }}>{error}</p>
            <p style={{ color: muted, fontSize: 13 }}>Reports expire after 7 days to protect privacy.</p>
            <Link href="/" style={{ display: 'inline-block', marginTop: 16, background: '#7c3aed', color: 'white', padding: '10px 20px', borderRadius: 10, textDecoration: 'none', fontWeight: 600 }}>Run your own analysis</Link>
          </section>
        )}

        {data && (
          <>
            <section aria-label="Verdict" style={{ border: `1px solid ${border}`, background: data.verdict?.color + '14', borderRadius: 20, padding: 32, textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 56 }}>{data.verdict?.emoji}</div>
              <h1 style={{ fontSize: 26, margin: '12px 0 4px', color: data.verdict?.color }}>{data.verdict?.line1}</h1>
              <p style={{ color: muted, margin: 0 }}>AI probability: <strong style={{ color: text }}>{data.score}%</strong> · uncertainty band <strong style={{ color: text }}>{data.band?.label}</strong></p>
              <p style={{ color: muted, fontSize: 13, marginTop: 12 }}>Analyzed {new Date(data.analyzedAt).toLocaleString()} · confidence {data.confidence}{data.degraded ? ' (models partially degraded)' : ''}</p>
            </section>

            <section style={{ border: `1px solid ${border}`, borderRadius: 16, padding: 24, marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, marginTop: 0 }}>Detection models</h2>
              {data.layers?.models?.available ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {(data.layers.models.results || []).map(m => (
                    <li key={m.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${border}`, fontSize: 14 }}>
                      <span>{m.shortName} <span style={{ color: muted }}>(weight {Math.round((m.weight || 0) * 100)}%)</span></span>
                      <strong style={{ color: m.aiScore >= 60 ? '#ef4444' : '#22c55e' }}>{m.aiScore}% AI</strong>
                    </li>
                  ))}
                </ul>
              ) : <p style={{ color: muted, fontSize: 14 }}>Models were unavailable at analysis time — heuristics-only verdict.</p>}
            </section>

            {data.animated && (
              <section style={{ border: `1px solid ${border}`, borderRadius: 16, padding: 24, marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, marginTop: 0 }}>Temporal analysis — animated GIF / video keyframes</h2>
                <p style={{ color: muted, fontSize: 14, margin: '0 0 10px' }}>
                  {data.perFrame?.length || 0} of {data.temporal ? 'the sampled' : '?'} frames analyzed frame-by-frame. Noise-floor spread {(data.temporal?.noiseSpread ?? 0).toFixed(3)}, texture spread {(data.temporal?.textureSpread ?? 0).toFixed(3)}, luminance drift {(data.temporal?.meanLumDrift ?? 0).toFixed(3)}.
                </p>
                <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 48, marginBottom: 10 }}>
                  {(data.perFrame || []).map((f, i) => (
                    <div key={i} title={`Frame ${i + 1}: ${f.score}% AI`} style={{ flex: 1, height: `${Math.max(4, f.score)}%`, background: f.score >= 55 ? '#ef4444' : '#52525b', borderRadius: 2 }} />
                  ))}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {(data.layers?.pixels?.signals || []).slice(0, 10).map((s, i) => (
                    <li key={i} style={{ padding: '6px 0', fontSize: 14, color: s.suspicious ? '#fda4af' : '#86efac' }}>{s.suspicious ? '⚠︎' : '✓'} {s.label}</li>
                  ))}
                </ul>
              </section>
            )}

            {data.saliency?.cells?.length > 0 && (
              <section style={{ border: `1px solid ${border}`, borderRadius: 16, padding: 24, marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, marginTop: 0 }}>Region suspicion map</h2>
                <p style={{ color: muted, fontSize: 13, margin: '0 0 10px' }}>Where in the frame the forensic evidence concentrates ({data.saliency.grid}×{data.saliency.grid} regions — the image itself is never shared).</p>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.saliency.grid},1fr)`, gap: 3, maxWidth: 260 }}>
                  {data.saliency.cells.map((val, i) => (
                    <div key={i} title={`Region ${i + 1}: ${(val * 100).toFixed(0)}% suspicion`}
                      style={{ aspectRatio: '1', borderRadius: 3, background: val >= 0.66 ? '#ef4444' : val >= 0.4 ? '#f59e0b' : val >= 0.2 ? '#3f3f46' : '#1c1c1e' }} />
                  ))}
                </div>
              </section>
            )}

            {[['Metadata & provenance', data.layers?.metadata], ['Dimensions', data.layers?.dimensions], ['File structure', data.layers?.structure], ['Pixel forensics', data.layers?.pixels], ['Sensor noise (PRNU) & compression', data.layers?.noise], ['Anatomy checks', data.layers?.anatomy]].map(([title, layer]) => (
              <section key={title} style={{ border: `1px solid ${border}`, borderRadius: 16, padding: 24, marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, marginTop: 0 }}>{title} <span style={{ color: muted, fontWeight: 400, fontSize: 13 }}>· score {layer?.score ?? '—'}</span></h2>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {(layer?.signals || []).slice(0, 10).map((s, i) => (
                    <li key={i} style={{ padding: '6px 0', fontSize: 14, color: s.suspicious ? '#fda4af' : '#86efac' }}>
                      {s.suspicious ? '⚠︎' : '✓'} {s.label}
                      {s.why && <div style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{s.why}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <p style={{ color: muted, fontSize: 12.5, textAlign: 'center' }}>{data.privacy}</p>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Link href="/" style={{ background: '#7c3aed', color: 'white', padding: '10px 20px', borderRadius: 10, textDecoration: 'none', fontWeight: 600 }}>Check an image yourself →</Link>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
