'use client'
import { ToolNav, ToolFooter } from '../components/ToolChrome'

export default function Privacy() {
  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#161616', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>
      <ToolNav />
      <main style={{ maxWidth: '760px', margin: '0 auto', padding: 'clamp(2rem,5vw,4rem) clamp(1rem,4vw,1.5rem)' }}>
        <div style={{ marginBottom: '3rem' }}>
          <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.9rem' }}>Legal</p>
          <h1 style={{ fontSize: 'clamp(1.7rem,4.5vw,2.6rem)', fontWeight: 700, margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>Privacy Policy</h1>
          <p style={{ color: '#8a8a8a', margin: 0 }}>Last updated: March 2025</p>
        </div>

        {[
          { title: 'Overview', content: 'IsItAI is built with privacy as a default, not an afterthought. We do not require you to create an account, we do not sell your data, and we do not store the images you upload. This policy explains exactly what we do — and do not — collect when you use our service.' },
          { title: 'Images you upload', content: 'When you upload an image for detection, it is sent to our server solely to run the forensic analysis. The image is processed in memory and immediately discarded after the result is returned. We do not save, store, index, or share your images in any form. Your images are never stored on our servers.' },
          { title: 'Information we collect', content: 'We collect minimal technical data to keep the service running reliably. This includes your approximate IP address (used for rate limiting to prevent abuse), the timestamp of your request, and basic technical metadata like browser type and operating system. We do not collect your name, email, or any personally identifiable information unless you voluntarily contact us.' },
          { title: 'Cookies and analytics', content: 'We use no third-party advertising cookies. We may use basic, privacy-respecting analytics to understand aggregate usage patterns — for example, how many images are analyzed per day. This data is aggregated and never linked to individual users. You can disable cookies in your browser settings without affecting the core functionality of the app.' },
          { title: 'Third-party services', content: 'IsItAI uses Hugging Face Inference API to run AI model analysis on uploaded images. Image data is transmitted to Hugging Face servers during processing according to their privacy policy. We use Vercel for hosting, which may collect standard web server logs. We do not use any advertising networks, social media trackers, or data brokers.' },
          { title: 'Data retention', content: 'We do not retain image data. Server logs (IP addresses, timestamps) are retained for a maximum of 30 days for security and abuse prevention purposes, then automatically deleted. We do not build profiles, track behavior over time, or associate requests across sessions.' },
          { title: 'Your rights', content: 'Since we do not store personal data linked to individuals, most data subject requests do not apply. If you believe we hold data about you, or if you have any privacy concern, contact us at ' + (process.env.PRIVACY_EMAIL || 'privacy@isitai.app') + ' and we will respond within 5 business days.' },
          { title: 'Children', content: 'IsItAI is not directed at children under 13. We do not knowingly collect information from children. If you are a parent or guardian and believe your child has submitted information through our service, contact us and we will promptly address it.' },
          { title: 'Changes to this policy', content: 'We may update this policy as the service evolves. Changes will be posted on this page with an updated date. Continued use of the service after changes constitutes acceptance of the updated policy.' },
          { title: 'Contact', content: 'Questions about this policy? Email us at ' + (process.env.PRIVACY_EMAIL || 'privacy@isitai.app') + '. We are committed to being transparent and responsive about how we handle your data.' },
        ].map((section, i) => (
          <div key={i} style={{ marginBottom: '2.5rem', paddingBottom: '2.5rem', borderBottom: i < 9 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.75rem' }}>{section.title}</h2>
            <p style={{ color: '#5c5c5c', lineHeight: 1.8, margin: 0, fontSize: '0.95rem' }}>{section.content}</p>
          </div>
        ))}
      </main>
      <ToolFooter />
    </div>
  )
}