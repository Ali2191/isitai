import ProvenanceClient from './ProvenanceClient'

export const metadata = {
  title: 'C2PA / Content Credentials Viewer — IsItAI',
  description: 'Upload any image to read its full provenance certificate chain: C2PA manifest, EXIF capture history, editing software and AI-tool signatures. The consumer-friendly Content Credentials viewer.',
  alternates: { canonical: '/provenance' },
}

export default function ProvenancePage() {
  return <ProvenanceClient />
}
