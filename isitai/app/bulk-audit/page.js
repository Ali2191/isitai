import BulkClient from './BulkClient'

export const metadata = {
  title: 'Bulk audit for newsrooms & moderation teams — IsItAI',
  description: 'Paste a list of image URLs, get scored verdicts back as JSON or CSV with permalinks and an audit log. No API key required.',
  alternates: { canonical: '/bulk-audit' },
}

// The page chrome (navbar, headings, results) lives inside SiblingTool so the
// bulk auditor looks identical to the image/text/audio detectors.
export default function BulkAuditPage() {
  return <BulkClient />
}
