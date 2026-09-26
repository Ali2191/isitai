// Shared shell + helpers for SEO content pages (server components)
import Link from 'next/link'

export const SITE = 'https://isitai-gilt.vercel.app'

export function seo({ title, description, path }) {
  return {
    title,
    description,
    alternates: { canonical: `${SITE}${path}` },
    openGraph: { title, description, url: `${SITE}${path}`, siteName: 'IsItAI', type: 'article' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

const accent = '#7c3aed'
const accentCyan = '#06b6d4'
const border = 'rgba(255,255,255,0.08)'
const textPrimary = '#f4f4f5'
const textMuted = '#71717a'
const textSoft = '#a1a1aa'

export function ContentShell({ children, breadcrumb }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: textPrimary, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <nav aria-label="Main navigation" style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(10,10,10,0.9)', backdropFilter: 'blur(20px)', borderBottom: `1px solid ${border}`, padding: '0 clamp(1rem,4vw,2rem)', height: '58px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" style={{ fontWeight: 800, fontSize: '1.05rem', background: `linear-gradient(135deg,${accent},${accentCyan})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', textDecoration: 'none' }}>🔍 IsItAI</Link>
        <Link href="/" style={{ color: accent, textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600 }}>Try the free detector →</Link>
      </nav>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(2rem,5vw,4rem) clamp(1rem,4vw,1.5rem)' }}>
        {breadcrumb && (
          <p style={{ fontSize: '0.78rem', color: textMuted, marginBottom: '1.5rem' }}>
            <Link href="/" style={{ color: textMuted, textDecoration: 'none' }}>Home</Link> › {breadcrumb}
          </p>
        )}
        {children}
        <div style={{ marginTop: '3rem', padding: '1.5rem', background: `${accent}0d`, border: `1px solid ${accent}30`, borderRadius: '16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.8rem', fontWeight: 700, fontSize: '1.05rem' }}>Ready to check an image?</p>
          <Link href="/" style={{ display: 'inline-block', background: `linear-gradient(135deg,${accent},${accentCyan})`, color: '#fff', padding: '10px 24px', borderRadius: '10px', textDecoration: 'none', fontWeight: 700 }}>Run a free detection — no account needed</Link>
        </div>
      </main>
      <footer style={{ borderTop: `1px solid ${border}`, padding: '1.5rem clamp(1rem,4vw,2rem)', textAlign: 'center' }}>
        <p style={{ color: textMuted, fontSize: '0.78rem', margin: 0 }}>© 2026 IsItAI · <Link href="/privacy" style={{ color: textMuted }}>Privacy</Link> · <Link href="/terms" style={{ color: textMuted }}>Terms</Link></p>
      </footer>
    </div>
  )
}

export function H2({ children }) {
  return <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '2.5rem 0 0.8rem', letterSpacing: '-0.02em' }}>{children}</h2>
}
export function P({ children }) {
  return <p style={{ color: textSoft, lineHeight: 1.85, fontSize: '0.98rem', margin: '0 0 1rem' }}>{children}</p>
}
export function UL({ items }) {
  return (
    <ul style={{ margin: '0 0 1.2rem', paddingLeft: '1.2rem', color: textSoft, lineHeight: 1.8, fontSize: '0.95rem' }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: '0.4rem' }}>{it}</li>)}
    </ul>
  )
}
