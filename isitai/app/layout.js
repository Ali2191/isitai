import "./globals.css"

export const metadata = {
  title: 'IsItAI — Free AI Image Detector',
  description: 'Detect AI-generated images instantly. Free, no account needed. 5-layer forensic analysis.',
  keywords: 'AI image detector, detect AI generated images, deepfake detector',
  openGraph: {
    title: 'IsItAI — Free AI Image Detector',
    description: 'Is this image real or AI-generated? Find out in seconds.',
    url: 'https://isitai-gilt.vercel.app',
    siteName: 'IsItAI',
    type: 'website',
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