import "./globals.css"

export const metadata = {
  title: 'IsItAI — Free AI Image Detector',
  description: 'Detect AI-generated images instantly. Free, no account needed. 5-layer forensic analysis including AI models, EXIF metadata, FFT frequency analysis, and face symmetry detection.',
  keywords: 'AI image detector, detect AI generated images, AI or real, image forensics, deepfake detector',
  openGraph: {
    title: 'IsItAI — Free AI Image Detector',
    description: 'Is this image real or AI-generated? Find out in seconds with our free 5-layer forensic detection system.',
    url: 'https://isitai-gilt.vercel.app',
    siteName: 'IsItAI',
    type: 'website',
  },
  // Phase 4: Replace content with your actual Google Search Console verification code
  // Get this from: search.google.com/search-console → Add property → HTML tag method
  verification: {
    google: <meta name="google-site-verification" content="RSWuLAF6WEDvVp9E-EbQHJ7sUHb5UTsp6XOgsLlvgPs" />
  },
  robots: {
    index: true,
    follow: true,
  }
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#0a0a0a' }}>{children}</body>
    </html>
  )
}