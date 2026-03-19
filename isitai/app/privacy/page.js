'use client'
import Link from 'next/link'

export default function Privacy() {
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <nav style={{ borderBottom: '1px solid rgba(0,0,0,0.08)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(20px)', position: 'sticky', top: 0, zIndex: 100 }}>
        <Link href="/" style={{ fontWeight: 900, fontSize: '1.2rem', background: 'linear-gradient(135deg, #6366f1, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', textDecoration: 'none' }}>IsItAI</Link>
        <Link href="/" style={{ fontSize: '0.88rem', color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>← Back to app</Link>
      </nav>
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '4rem 1.5rem' }}>
        <div style={{ marginBottom: '3rem' }}>
          <div style={{ display: 'inline-block', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '20px', padding: '4px 14px', fontSize: '0.8rem', color: '#6366f1', marginBottom: '1rem', fontWeight: 500 }}>Legal</div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 900, margin: '0 0 0.5rem', letterSpacing: '-0.02em', color: '#0f172a' }}>Privacy Policy</h1>
          <p style={{ color: '#94a3b8', margin: 0 }}>Last updated: March 2025</p>
        </div>

        {[
          { title: 'Overview', content: 'IsItAI is built with privacy as a default, not an afterthought. We do not require you to create an account, we do not sell your data, and we do not store the images you upload. This policy explains exactly what we do — and do not — collect when you use our service.' },
          { title: 'Images you upload', content: 'When you upload an image for detection, it is sent to our server solely to run the forensic analysis. The image is processed in memory and immediately discarded after the result is returned. We do not save, store, index, or share your images in any form. Your images are never stored on our servers.' },
          { title: 'Information we collect', content: 'We collect minimal technical data to keep the service running reliably. This includes your approximate IP address (used for rate limiting to prevent abuse), the timestamp of your request, and basic technical metadata like browser type and operating system. We do not collect your name, email, or any personally identifiable information unless you voluntarily contact us.' },
          { title: 'Cookies and analytics', content: 'We use no third-party advertising cookies. We may use basic, privacy-respecting analytics to understand aggregate usage patterns — for example, how many images are analyzed per day. This data is aggregated and never linked to individual users. You can disable cookies in your browser settings without affecting the core functionality of the app.' },
          { title: 'Third-party services', content: 'IsItAI uses Hugging Face Inference API to run AI model analysis on uploaded images. Image data is transmitted to Hugging Face servers during processing according to their privacy policy. We use Vercel for hosting, which may collect standard web server logs. We do not use any advertising networks, social media trackers, or data brokers.' },
          { title: 'Data retention', content: 'We do not retain image data. Server logs (IP addresses, timestamps) are retained for a maximum of 30 days for security and abuse prevention purposes, then automatically deleted. We do not build profiles, track behavior over time, or associate requests across sessions.' },
          { title: 'Your rights', content: 'Since we do not store personal data linked to individuals, most data subject requests do not apply. If you believe we hold data about you, or if you have any privacy concern, contact us at privacy@isitai.app and we will respond within 5 business days.' },
          { title: 'Children', content: 'IsItAI is not directed at children under 13. We do not knowingly collect information from children. If you are a parent or guardian and believe your child has submitted information through our service, contact us and we will promptly address it.' },
          { title: 'Changes to this policy', content: 'We may update this policy as the service evolves. Changes will be posted on this page with an updated date. Continued use of the service after changes constitutes acceptance of the updated policy.' },
          { title: 'Contact', content: 'Questions about this policy? Email us at privacy@isitai.app. We are committed to being transparent and responsive about how we handle your data.' },
        ].map((section, i) => (
          <div key={i} style={{ marginBottom: '2.5rem', paddingBottom: '2.5rem', borderBottom: i < 9 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.75rem', color: '#0f172a' }}>{section.title}</h2>
            <p style={{ color: '#475569', lineHeight: 1.8, margin: 0, fontSize: '0.95rem' }}>{section.content}</p>
          </div>
        ))}
      </div>
    </div>
  )
}