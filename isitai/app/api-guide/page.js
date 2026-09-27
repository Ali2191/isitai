import { ContentShell, H2, P, UL, seo } from '../content'

export const metadata = seo({
  title: 'IsItAI Public API — AI Image Detection Endpoint',
  description: 'Use the IsItAI /api/detect endpoint programmatically: multipart uploads and URL mode, response schema, rate limits, and optional API-key auth.',
  path: '/api-guide',
})

const code = { background: '#fafafa', border: '1px solid #e3e3e3', borderRadius: '8px', padding: '14px 16px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8rem', color: '#161616', overflowX: 'auto', lineHeight: 1.6, whiteSpace: 'pre', display: 'block', marginBottom: '1rem' }

export default function ApiGuide() {
  return (
    <ContentShell breadcrumb="API guide">
      <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)', fontWeight: 900, letterSpacing: '-0.03em', margin: '0 0 1rem', lineHeight: 1.15 }}>IsItAI Public API</h1>
      <P>One endpoint, JSON in / JSON out. No account required; set an <code style={{ color: '#161616' }}>ISITAI_API_KEY</code> server-side to raise rate limits for trusted callers.</P>

      <H2>POST /api/detect</H2>
      <P><strong>Mode 1 — file upload (multipart):</strong></P>
      <code style={code}>{`curl -X POST https://isitai-gilt.vercel.app/api/detect \\
  -F "image=@photo.jpg"`}</code>
      <P><strong>Mode 2 — URL (JSON):</strong></P>
      <code style={code}>{`curl -X POST https://isitai-gilt.vercel.app/api/detect \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com/photo.jpg"}'`}</code>
      <P><strong>Optional API key header:</strong></P>
      <code style={code}>{`-H "x-api-key: YOUR_KEY"   # raises per-IP rate limit`}</code>

      <H2>Response shape</H2>
      <code style={code}>{`{
  "id": "3f9a1c…",              // content hash prefix — reuse via GET /api/detect?id=
  "score": 87,                   // 0-100 probability the image is AI-generated
  "band": { "lo": 72, "hi": 100, "label": "72–100%" },
  "verdict": { "level": "definitive-ai", "emoji": "🤖",
               "color": "#ef4444", "line1": "This image is AI-generated" },
  "confidence": "high",          // high | medium | low
  "degraded": false,             // true => partial evidence, treat as provisional
  "layers": {
    "models":     { available, degraded, combined, results[], disagreement },
    "metadata":   { score, verdict, signals[] },   // EXIF · XMP · C2PA · SynthID
    "dimensions": { score, signals[] },
    "structure":  { score, signals[] },            // JPEG container forensics
    "pixels":     { score, signals[] }             // FFT · texture · symmetry
  },
  "cached": false
}`}</code>
      <P>Every signal object carries <code style={{ color: '#161616' }}>why</code>: a plain-language explanation of what was flagged and its evidentiary weight.</P>

      <H2>Related endpoints</H2>
      <UL items={[
        'GET /api/detect?id=… — fetch a cached result by id (results only, never images).',
        'POST /api/report — create a shareable 7-day report (link: /r/<id>); accepts the same inputs.',
        'POST /api/feedback — send { score, verdict, judgement } to calibrate accuracy.',
        'GET /api/stats — aggregate usage counters (no per-user data).',
      ]} />

      <H2>Limits & rules</H2>
      <UL items={[
        'Anonymous: 12 detections/min per IP (429 + retryAfter when exceeded).',
        'Max file size 20 MB; PNG/JPG/WEBP/GIF/BMP accepted (converted internally).',
        'URL mode rejects private/internal addresses (SSRF protection) and non-image responses.',
        'Images are processed transiently and never stored — results cache for 15 minutes.',
      ]} />
    </ContentShell>
  )
}
