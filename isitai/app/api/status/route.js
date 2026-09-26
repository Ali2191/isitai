import { getActiveCalibration, getCalibrationStats } from '../../../lib/calibration'
import { registryStats } from '../../../lib/registry'
import { snapshot } from '../../../lib/metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/status — machine-readable health feed consumed by /status page.
export async function GET() {
  const modelsConfigured = !!(process.env.HUGGINGFACE_API_KEY || process.env.MODEL_WORKER_URL)
  let calibration = null, accuracy = null, registry = null
  try { calibration = await getActiveCalibration() } catch { /* optional */ }
  try { accuracy = await getCalibrationStats() } catch { /* optional */ }
  try { registry = await registryStats() } catch { /* optional */ }
  return Response.json({
    service: 'IsItAI',
    version: '1.2.0',
    time: new Date().toISOString(),
    overall: modelsConfigured ? 'operational' : 'degraded',
    notice: modelsConfigured ? null
      : 'ML ensemble keys not configured on this instance — forensic-only mode (EXIF/C2PA, PRNU, JPEG structure, anatomy, saliency still fully active).',
    components: {
      hfInference: { enabled: !!process.env.HUGGINGFACE_API_KEY, models: (process.env.DETECT_MODELS || 'ufal-mutual-fs/audiotext_detection,umit58/deep-or-not-deep').split(',').filter(Boolean).length },
      selfHostedWorker: { enabled: !!process.env.MODEL_WORKER_URL, url: process.env.MODEL_WORKER_URL ? new URL(process.env.MODEL_WORKER_URL).host : null },
      ffmpeg: { available: process.env.FFMPEG_AVAILABLE === '1' },
      persistence: { dataDirWritable: true, note: 'verdicts + feedback stored as JSONL under DATA_DIR' },
    },
    calibration: calibration ? { publishedAt: calibration.publishedAt, buckets: calibration.buckets?.length ?? 0 } : null,
    accuracyLast30d: accuracy ? { agreementPct: accuracy.agreementPct, samples: accuracy.samples } : null,
    registry,
    metrics: snapshot(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
