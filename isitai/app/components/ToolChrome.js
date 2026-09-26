'use client'
import Link from 'next/link'

// ─── Shared page chrome for every IsItAI tool page (provenance, bulk audit,
//     text, audio…). Single source of truth so all pages look identical to the
//     image detector: same navbar, eyebrow label, typography and hairlines. ──

export const ink = '#161616'
export const inkSoft = '#5c5c5c'
export const inkFaint = '#8a8a8a'
export const line = '#e3e3e3'
export const surface = '#fafafa'

const Logo = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect width="32" height="32" rx="6" fill="#161616" />
    <circle cx="14.5" cy="14.5" r="6" fill="none" stroke="white" strokeWidth="2" />
    <line x1="19" y1="19" x2="24" y2="24" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
)

export function ToolNav({ active }) {
  const links = [
    ['/', 'Images', 'images'],
    ['/isitext', 'Text', 'text'],
    ['/isitaudio', 'Audio', 'audio'],
    ['/bulk-audit', 'Bulk', 'bulk'],
    ['/provenance', 'Provenance', 'provenance'],
    ['/how-to-detect-ai-images', 'Guides', 'guides'],
  ]
  return (
    <nav aria-label="Main navigation" style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${line}`, padding: '0 clamp(1rem,4vw,2rem)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '58px' }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
        <Logo size={26} />
        <span style={{ fontWeight: 700, fontSize: '1.05rem', color: ink, letterSpacing: '-0.01em' }}>IsItAI</span>
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {links.map(([href, label, id]) => (
          <Link key={id} href={href} style={{
            padding: '6px 12px', textDecoration: 'none', fontSize: '0.84rem',
            color: active === id ? ink : inkSoft,
            background: active === id ? surface : 'none',
            border: `1px solid ${active === id ? line : 'transparent'}`,
            borderRadius: 5, fontWeight: active === id ? 600 : 400,
          }}>{label}</Link>
        ))}
        <Link href="/api-guide" style={{ marginLeft: 4, padding: '6px 12px', color: inkSoft, textDecoration: 'none', fontSize: '0.84rem', border: `1px solid ${line}`, borderRadius: 5 }}>API</Link>
      </div>
    </nav>
  )
}

export function ToolFooter() {
  return (
    <footer style={{ borderTop: `1px solid ${line}`, marginTop: '4rem', padding: '2rem clamp(1rem,4vw,2rem)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <p style={{ color: inkFaint, margin: 0, fontSize: '0.78rem' }}>© 2026 IsItAI · Built with Next.js · Powered by Hugging Face</p>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Link href="/privacy" style={{ color: inkSoft, fontSize: '0.78rem', textDecoration: 'none' }}>Privacy</Link>
          <Link href="/terms" style={{ color: inkSoft, fontSize: '0.78rem', textDecoration: 'none' }}>Terms</Link>
          <a href="https://github.com/Ali2191/isitai" target="_blank" rel="noreferrer" style={{ color: inkSoft, fontSize: '0.78rem', textDecoration: 'underline', textUnderlineOffset: 2 }}>Source on GitHub</a>
        </div>
      </div>
    </footer>
  )
}

export default function ToolPage({ eyebrow, title, intro, children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: ink, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0 } button, a { font-family: inherit } :focus-visible { outline: 2px solid #161616; outline-offset: 2px; border-radius: 2px } ::selection { background: #161616; color: #fff }`}</style>
      <ToolNav />
      <main style={{ maxWidth: 860, margin: '0 auto', padding: 'clamp(2rem,5vw,3.5rem) clamp(1rem,4vw,2rem)' }}>
        <p style={{ fontSize: '0.8rem', fontWeight: 600, color: inkFaint, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.9rem' }}>{eyebrow}</p>
        <h1 style={{ fontSize: 'clamp(1.7rem,4.5vw,2.6rem)', fontWeight: 700, margin: '0 0 0.8rem', lineHeight: 1.15, letterSpacing: '-0.02em' }}>{title}</h1>
        <p style={{ color: inkSoft, fontSize: '1rem', lineHeight: 1.75, maxWidth: 640, margin: '0 0 2rem' }}>{intro}</p>
        {children}
      </main>
      <ToolFooter />
    </div>
  )
}
