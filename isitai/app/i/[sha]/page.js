import { getVerdictHistory } from '../../../lib/registry'
import { ToolNav, ToolFooter } from '../../components/ToolChrome'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public reproducible-verdict page: /i/<sha256>
// Shows every analysis ever run on these exact bytes — never the image itself.

function fmt(ts) { return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' }

export async function generateMetadata({ params }) {
  const { sha } = await params
  return {
    title: `Verdict history ${sha?.slice(0, 12)}… — IsItAI`,
    description: 'Public, reproducible AI-detection verdict history for this exact file hash.',
  }
}

const cell = { padding: '10px', borderBottom: '1px solid #e3e3e3' }

export default async function ShaPage({ params }) {
  const { sha } = await params
  const valid = typeof sha === 'string' && /^[a-f0-9]{64}$/i.test(sha)
  let history = null
  if (valid) { try { history = await getVerdictHistory(sha.toLowerCase()) } catch { history = null } }

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#161616', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>
      <ToolNav />
      <main style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(2rem,5vw,4rem) 20px' }}>
        <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.9rem' }}>Public record</p>
        <h1 style={{ margin: 0, fontSize: 'clamp(1.7rem,4.5vw,2.6rem)', fontWeight: 700 }}>Reproducible verdict record</h1>
      {!valid && <p>Invalid hash — expected a 64-char SHA-256 hex digest.</p>}
      {valid && !history?.count && (
        <p>No public verdicts recorded for this hash yet. Analyze the file once and its verdict summary will appear here permanently (90-day window).</p>
      )}
      {valid && history?.count > 0 && (
        <>
          <p style={{ background: '#fafafa', border: '1px solid #e3e3e3', borderRadius: 8, padding: 16 }}>
            This exact byte-sequence (SHA-256 <code style={{ wordBreak: 'break-all', color: '#161616' }}>{sha}</code>)
            has been analyzed <b>{history.count}×</b>.
            Previous verdicts agree <b>{Math.round(history.agreementPct ?? 0)}%</b> of the time{history.unanimous ? ' — unanimous.' : '.'}
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16, fontSize: 14 }}>
            <thead><tr style={{ textAlign: 'left', color: '#5c5c5c' }}>
              <th style={cell}>When</th><th style={cell}>Score</th><th style={cell}>Verdict</th><th style={cell}>Confidence</th>
            </tr></thead>
            <tbody>
              {(history.entries || []).map((e, i) => (
                <tr key={i}>
                  <td style={cell}>{fmt(e.at)}</td>
                  <td style={cell}>{e.score}/100</td>
                  <td style={cell}>{e.verdict}</td>
                  <td style={cell}>{e.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p style={{ color: '#8a8a8a', fontSize: 13, marginTop: 32 }}>
        Only analysis results are stored — never the image itself. Privacy guarantee: isitai discards all uploads after processing.
      </p>
      </main>
      <ToolFooter />
    </div>
  )
}
