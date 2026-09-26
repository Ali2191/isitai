import StatusClient from './StatusClient'

export const metadata = {
  title: 'Service status & model health — IsItAI',
  description: 'Live pipeline health: ML ensemble availability, latency, cache hit rate, calibration accuracy and degraded-mode notices.',
  alternates: { canonical: '/status' },
}

export default function StatusPage() {
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '40px 20px', color: '#eee', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/" style={{ color: '#8ab4f8' }}>← IsItAI home</a>
      <h1 style={{ marginTop: 16 }}>Service status</h1>
      <p style={{ color: '#aaa' }}>If a detection model drifts or goes down you will see it here first — no silent degradation.</p>
      <StatusClient />
    </main>
  )
}
