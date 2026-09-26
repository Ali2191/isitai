'use client'
// Bulk audit now shares the exact same UI shell as the image/text/audio
// detectors (SiblingTool): white editorial theme, sticky navbar, verdict-card
// results table, session history and cross-links. No API key required —
// internal usage is protected by per-IP rate limiting only.
import SiblingTool from '../components/SiblingTool'

export default function BulkClient() {
  return (
    <SiblingTool
      kind="bulk"
      api="/api/bulk"
      title="Bulk audit — score up to 50 images at once"
      intro="For journalists and trust-&-safety teams: paste a list of image URLs (one per line). Every URL runs through the full nine-layer forensic pipeline in parallel and comes back with a score, verdict, top signals and a permanent SHA-256 permalink. Export the whole run as CSV for your audit trail."
      placeholder={'https://example.com/photo1.jpg\nhttps://example.com/suspect.png\nhttps://nypost.com/.../breaking-photo.jpeg'}
    />
  )
}
