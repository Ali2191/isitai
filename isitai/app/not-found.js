'use client'
import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', textAlign: 'center', padding: '2rem' }}>
      <div style={{ fontSize: '4rem', fontWeight: 900, background: 'linear-gradient(135deg,#7c3aed,#06b6d4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '1rem' }}>404</div>
      <p style={{ color: '#a1a1aa', marginBottom: '2rem', fontSize: '1rem' }}>This page does not exist.</p>
      <Link href="/" style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)', color: '#fff', padding: '0.75rem 1.8rem', borderRadius: '10px', textDecoration: 'none', fontWeight: 700, fontSize: '0.95rem' }}>
        Back to IsItAI
      </Link>
    </div>
  )
}