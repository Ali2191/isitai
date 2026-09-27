// Shared shell + helpers for SEO content pages (server components)
import Link from 'next/link'
import { ToolNav, ToolFooter } from './components/ToolChrome'

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

// Monochrome palette shared with the main app (see app/page.js)
const ink = '#161616'
const border = '#e3e3e3'
const textPrimary = ink
const textMuted = '#8a8a8a'
const textSoft = '#5c5c5c'

export function ContentShell({ children, breadcrumb }) {
  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', color: textPrimary, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>
      <ToolNav active="guides" />
      <main style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(2rem,5vw,4rem) clamp(1rem,4vw,1.5rem)' }}>
        {breadcrumb && (
          <p style={{ fontSize: '0.78rem', color: textMuted, marginBottom: '1.5rem' }}>
            <Link href="/" style={{ color: textMuted, textDecoration: 'none' }}>Home</Link> › {breadcrumb}
          </p>
        )}
        {children}
        <div style={{ marginTop: '3rem', padding: '1.5rem', background: '#fafafa', border: `1px solid ${border}`, borderRadius: '8px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.8rem', fontWeight: 700, fontSize: '1.05rem' }}>Ready to check an image?</p>
          <Link href="/" style={{ display: 'inline-block', background: ink, color: '#fff', padding: '10px 24px', borderRadius: '6px', textDecoration: 'none', fontWeight: 600 }}>Run a free detection — no account needed</Link>
        </div>
      </main>
      <ToolFooter />
    </div>
  )
}

export function H2({ children }) {
  return <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '2.5rem 0 0.8rem', letterSpacing: '-0.02em', color: ink }}>{children}</h2>
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
