// ─── Court-ready evidence pack builder (server-side) ─────────────────────────
// Turns a finished analysis result into a self-contained, printable HTML
// document: verdict, uncertainty band, every signal with its plain-English
// explanation, layer-by-layer breakdown, model ensemble table, file hash and
// methodology appendix. The client's EvidencePack button posts here so the
// document is identical regardless of viewer JS support (archive/print safe).

const LEVEL_LABEL = {
  'likely-real': 'LIKELY CAMERA-ORIGINATED',
  'uncertain': 'INCONCLUSIVE — INSUFFICIENT EVIDENCE',
  'likely-ai': 'LIKELY AI-GENERATED',
  'definitive-ai': 'HIGH-CONFIDENCE AI-GENERATED',
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function signalRows(signals) {
  if (!signals?.length) return '<tr><td colspan="3" style="color:#888">No signals recorded for this layer.</td></tr>'
  return signals.map(s => `<tr>
    <td>${s.suspicious ? '⚠' : '·'} ${esc(s.label)}</td>
    <td>${esc(s.value)}</td>
    <td style="color:#555">${esc(s.why || '')}</td>
  </tr>`).join('')
}

export function buildEvidenceHtml(result, meta = {}) {
  const layers = result.layers || {}
  const v = result.verdict || {}
  const levelLabel = LEVEL_LABEL[v.level] || esc((v.level || 'unknown').toUpperCase())
  const models = (layers.models?.results || []).map(m =>
    `<li>${esc(m.model || m.name)} → AI probability ${(100 * (m.aiScore ?? m.score ?? 0)).toFixed(1)}% (weight ${esc(m.weight)})</li>`).join('') ||
    '<li>No ML ensemble models were available for this analysis — verdict rests on forensic layers only.</li>'
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>IsItAI Forensic Report — ${esc(result.id)}</title>
<style>
 body{font-family:Georgia,'Times New Roman',serif;color:#111;max-width:820px;margin:40px auto;padding:0 24px;line-height:1.55}
 h1{font-size:1.5rem;border-bottom:3px solid #111;padding-bottom:8px}
 .verdict{font-size:1.25rem;font-weight:700;padding:14px 18px;border:2px solid #111;margin:18px 0}
 table{border-collapse:collapse;width:100%;font-size:.92rem;margin:10px 0 22px}
 th,td{border:1px solid #bbb;padding:6px 9px;text-align:left;vertical-align:top}
 th{background:#f0f0f0}
 .meta{color:#555;font-size:.85rem}
 code{font-family:ui-monospace,Menlo,monospace;font-size:.8rem;word-break:break-all}
 section{margin-top:26px}
 @media print{body{margin:0}}
 footer{margin-top:36px;border-top:1px solid #999;padding-top:10px;font-size:.78rem;color:#666}
</style></head><body>
<h1>IsItAI — AI-Image Detection Forensic Report</h1>
<p class="meta">Report generated ${now}${meta.requester ? ` for ${esc(meta.requester)}` : ''}. Analysis performed ${esc(new Date(result.analyzedAt || Date.now()).toISOString())}.</p>

<div class="verdict">${levelLabel}<br><span style="font-size:1rem;font-weight:400">AI-generation likelihood score: <b>${esc(result.score)}/100</b>, uncertainty band ${esc(result.band?.label || `${result.band?.lo}–${result.band?.hi}`)} · confidence: ${esc(result.confidence)}${result.degraded ? ' · <b>REDUCED-EVIDENCE MODE</b>' : ''}</span></div>
${result.degraded ? `<p><b>Caveat:</b> ${esc(result.degradedReason || 'some detection layers were unavailable')}.</p>` : ''}

<section><h2>1. Subject identification</h2>
<table>
<tr><th>SHA-256 of analyzed bytes</th><td><code>${esc(result.sha256)}</code></td></tr>
<tr><th>Public verdict record</th><td><code>https://isitai.app/i/${esc(result.sha256)}</code></td></tr>
<tr><th>Dimensions</th><td>${esc(result.imageDimensions?.width)}×${esc(result.imageDimensions?.height)} px</td></tr>
</table>
<p class="meta">The analyzed image itself was not retained by the service (in-memory processing, results-only logging). This report attests to measurements taken on the byte-sequence identified by the hash above.</p></section>

<section><h2>2. Layer A — Metadata & provenance (EXIF/XMP/C2PA)</h2>
<table><tr><th>Signal</th><th>Value</th><th>Interpretation</th></tr>${signalRows(layers.metadata?.signals)}</table></section>

<section><h2>3. Layer B — Sensor noise (PRNU) & JPEG double-compression</h2>
<table><tr><th>Signal</th><th>Value</th><th>Interpretation</th></tr>${signalRows(layers.pixels?.signals || layers.structure?.signals)}</table></section>

<section><h2>4. Layer C — Anatomical & structural plausibility</h2>
<table><tr><th>Signal</th><th>Value</th><th>Interpretation</th></tr>${signalRows(layers.anatomy?.signals || [])}</table>
${result.saliency?.cells ? `<p>Region-suspicion saliency map computed on a ${result.saliency.grid}×${result.saliency.grid} grid; highest-suspicion regions are listed in the interactive report at <code>/r/${esc(result.id)}</code>.</p>` : ''}</section>

<section><h2>5. Layer D — ML classifier ensemble</h2>
<ul>${models}</ul>
${layers.models?.disagreement ? '<p><b>Note:</b> ensemble members materially disagreed (spread recorded below); treat model evidence as weak.</p>' : ''}</section>

<section><h2>6. Methodology & limitations</h2>
<p>Scores from independent forensic layers are fused with fixed weights; per-band probabilities are recalibrated weekly against user-confirmed ground truth when sample sizes permit. Known limitations: heavy recompression (social-media re-upload) erases sensor-noise evidence; images derived from real photos (img2img, face-swap) may retain camera-like noise; no detector — including this one — should be sole basis for legal or employment decisions. Detector error rates on out-of-distribution data remain material.</p></section>

<footer>IsItAI · isitai.app · transparency report at /benchmark · status at /status · This document is machine-generated evidence summary, not expert testimony.</footer>
</body></html>`
}
