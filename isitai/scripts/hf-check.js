#!/usr/bin/env node
// scripts/hf-check.js — verify the HuggingFace API key and image-model wiring.
// Usage:  node scripts/hf-check.js            (uses env / .env.local)
//         HF_KEY=hf_xxx node scripts/hf-check.js   (test a key without persisting it)
const fs = require('fs')
const path = require('path')

// minimal .env.local loader (no dotenv dependency)
for (const f of ['.env.local', '.env']) {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', f), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
}

const KEY = process.env.HF_KEY || process.env.HUGGINGFACE_API_KEY || ''

async function main() {
  if (!KEY) {
    console.log('❌ HUGGINGFACE_API_KEY is NOT set in this environment.')
    console.log('   → The site is running forensic-only mode; no HF models are being called.')
    console.log('   Fix: add HUGGINGFACE_API_KEY=hf_... to .env.local (dev) or Vercel project env vars (prod),')
    console.log('        then restart the server and check /api/status → hfInference.enabled should be true.')
    process.exit(2)
  }
  console.log(`Key present (${KEY.slice(0, 3)}…, length ${KEY.length}). Validating…\n`)

  // 1) Key validity via whoami
  const me = await fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${KEY}` } })
  if (!me.ok) {
    console.log(`❌ Key REJECTED by HuggingFace — whoami returned HTTP ${me.status}: ${(await me.text()).slice(0, 160)}`)
    console.log('   → The key is invalid, revoked, or lacks read scope. Models will never be called successfully.')
    process.exit(1)
  }
  const who = await me.json()
  console.log(`✅ Key VALID — authenticated as "${who.name}"${who.plan ? ` (plan: ${who.plan})` : ''}\n`)

  // 2) Model calls — same endpoint + payload the app uses (lib/analyze.js callHfModel)
  let jpegBuf
  try {
    const sharp = require('sharp')
    jpegBuf = await sharp({ create: { width: 224, height: 224, channels: 3, background: { r: 128, g: 90, b: 40 } } }).jpeg().toBuffer()
  } catch {
    const sample = path.join(__dirname, '..', 'public', 'sample-real.jpg')
    jpegBuf = fs.existsSync(sample) ? fs.readFileSync(sample) : null
  }
  if (!jpegBuf) { console.log('⚠️  No test JPEG available; skipping model calls.'); process.exit(0) }

  const MODELS = (process.env.DETECT_MODELS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
  const models = MODELS.length ? MODELS : [
    'umm-maybe/AI-image-detector',
    'haywoodsloan/ai-image-detector-deploy',
    'umitkaya/deepfake-detector-all-ViT',
    'shunk0211/deepfake-detection-multimodal',
  ]

  let okCount = 0
  for (const name of models) {
    const url = `https://router.huggingface.co/hf-inference/models/${name}`
    const t0 = Date.now()
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'image/jpeg' },
        body: jpegBuf,
      })
      const text = await res.text()
      const ms = Date.now() - t0
      if (!res.ok) {
        console.log(`❌ ${name} — HTTP ${res.status} (${ms}ms): ${text.slice(0, 140)}`)
        continue
      }
      const data = JSON.parse(text)
      if (!Array.isArray(data)) { console.log(`⚠️  ${name} — unexpected format: ${text.slice(0, 100)}`); continue }
      const aiEntry = data.find(d => /artificial|fake|ai|generated|deepfake|positive/i.test(d.label || ''))
      console.log(`✅ ${name} — ${ms}ms — labels: ${data.map(d => `${d.label}:${(d.score * 100).toFixed(1)}`).join(', ')}`)
      if (!aiEntry) console.log(`   ⚠️  app's label-matching would FAIL on this response (no AI-like label found)`)
      else okCount++
    } catch (e) {
      console.log(`❌ ${name} — error: ${String(e.message).slice(0, 140)}`)
    }
  }
  console.log(`\nSummary: ${okCount}/${models.length} image models responded with an app-parseable AI label.`)
  process.exit(okCount > 0 ? 0 : 1)
}
main()
