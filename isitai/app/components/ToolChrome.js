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
  const products = [
    ['/', 'Images', 'images', 'Single-image forensic analysis with evidence and uncertainty bands.'],
    ['/compare', 'Compare', 'compare', 'Compare an original and suspected edit region by region.'],
    ['/isvideo', 'Video', 'video', 'Sample video and GIF frames for temporal inconsistencies.'],
    ['/isitext', 'Text', 'text', 'Measure AI-associated writing-style signals, not authorship proof.'],
    ['/isitaudio', 'Audio', 'audio', 'Inspect synthetic-audio signals and optional reference consistency.'],
  ]
  const links = [
    ['/bulk-audit', 'Bulk', 'bulk'],
    ['/provenance', 'Provenance', 'provenance'],
    ['/how-to-detect-ai-images', 'Guides', 'guides'],
  ]
  return (
    <nav className="tool-nav" aria-label="Main navigation">
      <style>{`.tool-nav{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid ${line};padding:0 clamp(1rem,4vw,2rem);display:flex;align-items:center;justify-content:space-between;min-height:58px}.tool-nav-links{display:flex;align-items:center;gap:4px;flex-wrap:wrap}.tool-nav-link,.tool-products-trigger{padding:6px 12px;text-decoration:none;font-size:.84rem;color:${inkSoft};background:none;border:1px solid transparent;border-radius:5px;font-family:inherit;cursor:pointer}.tool-nav-link[data-active=true],.tool-products-trigger[data-active=true]{color:${ink};background:${surface};border-color:${line};font-weight:600}.tool-products{position:relative}.tool-products-menu{position:absolute;right:0;top:calc(100% + 8px);width:300px;padding:8px;background:#fff;border:1px solid ${line};border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.1);opacity:0;visibility:hidden;transform:translateY(-4px);transition:opacity .15s,transform .15s,visibility .15s}.tool-products:hover .tool-products-menu,.tool-products:focus-within .tool-products-menu{opacity:1;visibility:visible;transform:translateY(0)}.tool-product{display:block;padding:10px 11px;text-decoration:none;border-radius:5px}.tool-product:hover,.tool-product:focus{background:${surface};outline:none}.tool-product-name{display:block;color:${ink};font-size:.84rem;font-weight:600}.tool-product-description{display:block;color:${inkFaint};font-size:.73rem;line-height:1.4;margin-top:3px}.tool-api{margin-left:4px;border-color:${line}}@media(max-width:760px){.tool-nav{align-items:flex-start;padding-top:10px;padding-bottom:10px}.tool-nav-links{justify-content:flex-end;max-width:calc(100% - 85px)}.tool-nav-link,.tool-products-trigger{padding:5px 7px;font-size:.76rem}.tool-products-menu{position:fixed;top:58px;right:12px;width:min(300px,calc(100vw - 24px))}}`}</style>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
        <Logo size={26} />
        <span style={{ fontWeight: 700, fontSize: '1.05rem', color: ink, letterSpacing: '-0.01em' }}>IsItAI</span>
      </Link>
      <div className="tool-nav-links">
        <div className="tool-products">
          <button className="tool-products-trigger" data-active={products.some(([, , id]) => active === id)} aria-haspopup="true">Products <span aria-hidden="true">⌄</span></button>
          <div className="tool-products-menu">
            {products.map(([href, label, id, description]) => <Link key={id} href={href} className="tool-product">
              <span className="tool-product-name">{label}</span><span className="tool-product-description">{description}</span>
            </Link>)}
          </div>
        </div>
        {links.map(([href, label, id]) => (
          <Link key={id} href={href} className="tool-nav-link" data-active={active === id}>{label}</Link>
        ))}
        <Link href="/api-guide" className="tool-nav-link tool-api">API</Link>
        <a href="https://github.com/Ali2191/isitai" target="_blank" rel="noreferrer" className="tool-nav-link tool-api">GitHub</a>
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
