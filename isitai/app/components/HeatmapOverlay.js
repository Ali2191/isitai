'use client'

import { useState } from 'react'

// ─── Zoom-into-flagged-region heatmap overlay ────────────────────────────────
// Draws the 8×8 saliency grid (result.saliency.cells, row-major, values 0–1)
// on top of the analyzed image preview, plus anatomy boxes
// (result.layers.anatomy.boxes, normalized x/y/w/h + severity). Clicking a
// flagged cell or box zooms the preview into that region ("zoom into flagged
// region" inspection mode).
export default function HeatmapOverlay({ src, result, maxShow = 320, alt = 'Analyzed image with suspicion heatmap' }) {
  const [focus, setFocus] = useState(null) // {x,y,w,h,label}
  const [show, setShow] = useState(true)

  const saliency = result?.saliency
  const anatomyBoxes = result?.layers?.anatomy?.boxes || []
  const hasOverlay = !!saliency?.cells?.length || anatomyBoxes.length > 0
  if (!src || !hasOverlay) return null

  const G = saliency?.grid || 8
  const cells = saliency?.cells || []
  const vmark = v => (v >= 0.66 ? 'high' : v >= 0.4 ? 'med' : 'low')

  const zoomStyle = focus
    ? {
        position: 'absolute', inset: 0, backgroundImage: `url(${src})`,
        backgroundSize: `${100 / Math.max(focus.w, 0.05)}% ${100 / Math.max(focus.h, 0.05)}%`,
        backgroundPosition: `${(focus.x / Math.max(1 - focus.w, 0.001)) * 100}% ${(focus.y / Math.max(1 - focus.h, 0.001)) * 100}%`,
      }
    : { position: 'absolute', inset: 0, backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center' }

  return (
    <div style={{ marginTop: 10, border: '1px solid #e3e3e3', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: '#fafafa', borderBottom: '1px solid #e3e3e3', fontSize: '0.72rem', color: '#5c5c5c', gap: 8, flexWrap: 'wrap' }}>
        <span><strong style={{ color: '#161616' }}>Where it looks synthetic</strong> — region-level suspicion map{focus ? ` · zoomed: ${focus.label}` : ''}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {focus && <button onClick={() => setFocus(null)} style={btn}>Reset zoom</button>}
          <button onClick={() => setShow(s => !s)} style={btn}>{show ? 'Hide heatmap' : 'Show heatmap'}</button>
        </span>
      </div>

      <div style={{ position: 'relative', width: '100%', maxHeight: maxShow, aspectRatio: '4 / 3' }} role="img" aria-label={alt}>
        <div style={zoomStyle} />
        {show && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${G},1fr)`, gridTemplateRows: `repeat(${G},1fr)` }}>
            {Array.from({ length: G * G }, (_, i) => {
              const v = cells[i] ?? 0
              return (
                <button
                  key={i}
                  title={`Region suspicion ${(v * 100).toFixed(0)}% — click to zoom`}
                  onClick={() => setFocus({ x: (i % G) / G, y: Math.floor(i / G) / G, w: 1 / G, h: 1 / G, label: `cell ${(i % G) + 1},${Math.floor(i / G) + 1} (${Math.round(v * 100)}%)` })}
                  style={{ border: 0, padding: 0, cursor: 'zoom-in', background: v >= 0.4 ? `rgba(239,68,68,${Math.min(0.62, 0.12 + v * 0.5)})` : v >= 0.2 ? `rgba(234,179,8,${Math.min(0.4, v * 0.9)})` : 'transparent' }}
                />
              )
            })}
          </div>
        )}
        {show && anatomyBoxes.map((b, i) => (
          <button
            key={`a${i}`}
            title={`${b.label || 'anomaly'} — click to zoom`}
            onClick={() => setFocus({ ...b, label: b.label || 'anomaly' })}
            style={{ position: 'absolute', left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, border: `2px solid rgba(239,68,68,${0.5 + 0.5 * (b.severity ?? 0.5)})`, borderRadius: 4, background: 'rgba(239,68,68,0.08)', cursor: 'zoom-in', padding: 0 }}
          >
            <span style={{ position: 'absolute', top: -8, left: 2, fontSize: '0.58rem', background: '#ef4444', color: '#fff', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>{b.label}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', padding: '8px 10px', borderTop: '1px solid #e3e3e3', fontSize: '0.7rem', color: '#8a8a8a' }}>
        <Legend color="rgba(239,68,68,0.6)" text="high suspicion" />
        <Legend color="rgba(234,179,8,0.45)" text="moderate" />
        <Legend color="#ef4444" text="anatomy flag" outline />
        {(saliency?.flagged || []).slice(0, 3).map((f, i) => (
          <button key={i} onClick={() => setFocus({ ...f, label: f.where })} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#161616', textDecoration: 'underline dotted', cursor: 'pointer' }}>
            {f.where}: {Math.round(f.value * 100)}% ({vmark(f.value)})
          </button>
        ))}
      </div>
    </div>
  )
}

function Legend({ color, text, outline }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: outline ? 'transparent' : color, border: outline ? `2px solid ${color}` : 'none', display: 'inline-block' }} />{text}
    </span>
  )
}

const btn = { background: '#fff', border: '1px solid #d0d0d0', borderRadius: 4, padding: '2px 8px', fontSize: '0.68rem', color: '#161616', cursor: 'pointer', fontFamily: 'inherit' }
