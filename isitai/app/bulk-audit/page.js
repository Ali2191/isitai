import BulkClient from './BulkClient'

export const metadata = {
  title: 'Bulk audit for newsrooms & moderation teams — IsItAI',
  description: 'Upload a CSV of image URLs, get scored verdicts back as JSON or CSV with permalinks and an audit log. Team API key required.',
  alternates: { canonical: '/bulk-audit' },
}

export default function BulkAuditPage() {
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '40px 20px', color: '#eee', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/" style={{ color: '#8ab4f8' }}>← IsItAI home</a>
      <h1 style={{ marginTop: 16 }}>Bulk audit</h1>
      <p style={{ color: '#aaa', lineHeight: 1.6 }}>
        For journalists and trust-&-safety teams: paste or upload a CSV of image URLs (one per line).
        We audit up to 50 URLs in parallel and export JSON/CSV with per-file SHA-256 permalinks.
        Runs require a team API key and are recorded in your org&apos;s audit log.
      </p>
      <BulkClient />
    </main>
  )
}
