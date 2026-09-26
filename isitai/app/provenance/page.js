import ProvenanceClient from './ProvenanceClient'

export const metadata = {
  title: 'C2PA / Content Credentials Viewer — IsItAI',
  description: 'Upload any image to read its full provenance certificate chain: C2PA manifest, EXIF capture history, editing software and AI-tool signatures. The consumer-friendly Content Credentials viewer.',
  alternates: { canonical: '/provenance' },
}

export default function ProvenancePage() {
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '40px 20px', color: '#eee', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/" style={{ color: '#8ab4f8' }}>← IsItAI home</a>
      <h1 style={{ marginTop: 16 }}>Provenance wallet — Content Credentials viewer</h1>
      <p style={{ color: '#aaa', lineHeight: 1.6 }}>
        Who created this file? What edits were made? C2PA “Content Credentials” embed that answer inside the image —
        but almost no tool lets normal people read them. Upload a photo (JPEG/PNG/WebP) and we parse the certificate
        chain plus classic EXIF/XMP history. Your file is analyzed in memory and discarded — nothing is stored or logged.
      </p>
      <ProvenanceClient />
    </main>
  )
}
