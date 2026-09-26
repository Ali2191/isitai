'use client'
// ─── Signal chip with plain-language explanation tooltip ─────────────────────
// Shared by the image results UI (app/page.js) and the text/audio tool pages.
import { useState } from 'react'

export default function SignalChip({ s }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => s.why && setOpen(o => !o)} aria-expanded={open ? 'true' : 'false'}
        style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: '4px', background: s.suspicious ? '#161616' : '#ffffff', color: s.suspicious ? '#ffffff' : '#5c5c5c', border: `1px solid ${s.suspicious ? '#161616' : '#d6d6d6'}`, fontWeight: 500, cursor: s.why ? 'pointer' : 'default', fontFamily: 'inherit', textAlign: 'left' }}>
        {s.suspicious ? '! ' : ''}{s.label}
      </button>
      {open && s.why && (
        <span role="tooltip" style={{ position: 'absolute', zIndex: 30, top: '110%', left: 0, width: 'min(260px, 70vw)', background: '#161616', border: '1px solid #161616', borderRadius: 6, padding: '10px 12px', fontSize: '0.72rem', color: '#f2f2f2', lineHeight: 1.55, boxShadow: '0 6px 20px rgba(0,0,0,0.18)', display: 'block', textAlign: 'left' }}>
          {s.why}
        </span>
      )}
    </span>
  )
}
