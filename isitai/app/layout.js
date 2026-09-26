import "./globals.css"

export const metadata = {
  metadataBase: new URL('https://isitai-gilt.vercel.app'),
  title: 'IsItAI — Free AI Image Detector',
  description: 'Detect AI-generated images instantly. Free, no account needed. Multi-layer forensic analysis (EXIF · C2PA · SynthID · FFT · ML ensemble) with plain-English verdicts and honest uncertainty bands.',
  keywords: 'AI image detector, detect AI generated images, deepfake detector, Midjourney detector, DALL-E detector, C2PA verification, is this image AI',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'IsItAI — Free AI Image Detector',
    description: 'Is this image real or AI-generated? Plain-English verdicts with uncertainty bands, in seconds.',
    url: 'https://isitai-gilt.vercel.app',
    siteName: 'IsItAI',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'IsItAI — Free AI Image Detector',
    description: 'Is this image real or AI-generated? Find out in seconds — free, no account.',
  },
  robots: { index: true, follow: true }
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
       <meta name="google-site-verification" content="RSWuLAF6WEDvVp9E-EbQHJ7sUHb5UTsp6XOgsLlvgPs" />      </head>
      <body style={{ margin: 0, padding: 0, background: '#0a0a0a' }}>{children}</body>
    </html>
  )
}