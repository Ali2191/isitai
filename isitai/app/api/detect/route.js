import sharp from 'sharp'

export async function POST(request) {
  try {
    const formData = await request.formData()
    const image = formData.get('image')
    if (!image) return Response.json({ error: 'No image provided' }, { status: 400 })

    const key = process.env.HUGGINGFACE_API_KEY
    if (!key) return Response.json({ error: 'API key missing' }, { status: 500 })

    const rawBuffer = Buffer.from(await image.arrayBuffer())

    // ── 1. IMAGE PREPROCESSING ──────────────────────────────────────────
    // Normalize to 224x224 RGB JPEG — matches training resolution of classifiers
    let processedBuffer
    let imageDimensions = { width: 0, height: 0 }
    try {
      const metadata = await sharp(rawBuffer).metadata()
      imageDimensions = { width: metadata.width || 0, height: metadata.height || 0 }

      processedBuffer = await sharp(rawBuffer)
        .resize(224, 224, { fit: 'cover', position: 'centre' })
        .removeAlpha()
        .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
        .toBuffer()
    } catch (e) {
      console.log('Sharp preprocessing failed, using raw buffer:', e.message)
      processedBuffer = rawBuffer
    }

    // ── 2. IMAGE DIMENSION HEURISTICS ───────────────────────────────────
    // AI generators produce specific standard sizes. Real cameras produce irregular sizes.
    const dimensionScore = analyzeDimensions(imageDimensions.width, imageDimensions.height)

    // ── 3. RUN AI MODELS ────────────────────────────────────────────────
    const models = [
      { name: 'umm-maybe/AI-image-detector', weight: 0.30 },
      { name: 'Organika/sdxl-detector', weight: 0.20 },
      { name: 'haywoodsloan/ai-image-detector-deploy', weight: 0.50 },
    ]

    const results = await Promise.allSettled(
      models.map(async (model) => {
        const res = await fetch(
          `https://router.huggingface.co/hf-inference/models/${model.name}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'image/jpeg' },
            body: processedBuffer,
          }
        )
        const text = await res.text()
        console.log(`Model ${model.name}:`, text)
        let data
        try { data = JSON.parse(text) } catch { throw new Error(`Invalid JSON: ${text.slice(0, 80)}`) }
        if (data.error) throw new Error(data.error)
        if (!Array.isArray(data)) throw new Error('Unexpected format')

        const aiEntry = data.find(d =>
          d.label?.toLowerCase().includes('artificial') ||
          d.label?.toLowerCase().includes('fake') ||
          d.label?.toLowerCase().includes('ai')
        )
        if (!aiEntry) throw new Error('No AI label found')
        return { name: model.name, weight: model.weight, aiScore: Math.round(aiEntry.score * 100) }
      })
    )

    const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value)
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason?.message)

    if (successful.length === 0) {
      return Response.json({ error: 'All models failed', details: failed }, { status: 500 })
    }

    // ── 4. CONFIDENCE-WEIGHTED DISAGREEMENT HANDLING ────────────────────
    const scores = successful.map(m => m.aiScore)
    const maxScore = Math.max(...scores)
    const minScore = Math.min(...scores)
    const spread = maxScore - minScore
    const disagreement = spread > 25

    // When models strongly disagree, boost haywoodsloan weight to 70%
    // since it consistently has the highest sensitivity on AI images
    let adjustedModels = [...successful]
    if (disagreement && spread > 30) {
      const haywood = adjustedModels.find(m => m.name.includes('haywoodsloan'))
      if (haywood) {
        const othersWeight = 0.30
        const otherModels = adjustedModels.filter(m => !m.name.includes('haywoodsloan'))
        const perOtherWeight = otherModels.length > 0 ? othersWeight / otherModels.length : 0
        adjustedModels = adjustedModels.map(m => ({
          ...m,
          weight: m.name.includes('haywoodsloan') ? 0.70 : perOtherWeight,
          weightAdjusted: m.name.includes('haywoodsloan')
        }))
        console.log('Disagreement detected — boosted haywoodsloan to 70%')
      }
    }

    // Normalize weights from successful models
    const totalWeight = adjustedModels.reduce((sum, m) => sum + m.weight, 0)
    const modelCombined = Math.round(
      adjustedModels.reduce((sum, m) => sum + (m.aiScore * (m.weight / totalWeight)), 0)
    )

    // Standard deviation for confidence scoring
    const mean = modelCombined
    const stdDev = Math.sqrt(scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length)
    const confidence = stdDev < 8 ? 'high' : stdDev < 20 ? 'medium' : 'low'

    return Response.json({
      combined: modelCombined,
      modelResults: successful.map(m => ({
        ...m,
        weight: adjustedModels.find(a => a.name === m.name)?.weight || m.weight,
        weightAdjusted: adjustedModels.find(a => a.name === m.name)?.weightAdjusted || false
      })),
      disagreement,
      disagreementSpread: spread,
      confidence,
      dimensionScore,
      imageDimensions,
      modelsUsed: successful.length,
      failedModels: failed
    })
  } catch (error) {
    console.error('Route error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

// ── DIMENSION HEURISTICS ────────────────────────────────────────────────────
function analyzeDimensions(width, height) {
  if (!width || !height) return { score: 0, signals: [], confidence: 'none' }

  const signals = []
  let suspicionScore = 0

  // Known AI generator output sizes
  const aiSizes = [
    { w: 512, h: 512, label: 'SD 1.x standard', confidence: 'high' },
    { w: 768, h: 768, label: 'SD 1.x high-res', confidence: 'high' },
    { w: 1024, h: 1024, label: 'SDXL / DALL-E square', confidence: 'high' },
    { w: 1024, h: 1792, label: 'DALL-E 3 portrait', confidence: 'high' },
    { w: 1792, h: 1024, label: 'DALL-E 3 landscape', confidence: 'high' },
    { w: 1344, h: 768, label: 'Midjourney landscape', confidence: 'high' },
    { w: 768, h: 1344, label: 'Midjourney portrait', confidence: 'high' },
    { w: 1216, h: 832, label: 'Midjourney wide', confidence: 'medium' },
    { w: 832, h: 1216, label: 'Midjourney tall', confidence: 'medium' },
    { w: 640, h: 480, label: 'GAN output', confidence: 'medium' },
    { w: 256, h: 256, label: 'Early GAN output', confidence: 'medium' },
    { w: 512, h: 768, label: 'SD portrait', confidence: 'medium' },
    { w: 768, h: 512, label: 'SD landscape', confidence: 'medium' },
  ]

  // Check exact match
  const exactMatch = aiSizes.find(s => s.w === width && s.h === height)
  if (exactMatch) {
    signals.push({ label: `Size matches ${exactMatch.label} (${width}×${height})`, suspicious: true })
    suspicionScore += exactMatch.confidence === 'high' ? 55 : 35
  } else {
    // Check if dimensions are powers of 2 or multiples of 64/128 (very common in AI)
    const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0
    const isMult64 = (n) => n % 64 === 0
    const isMult128 = (n) => n % 128 === 0

    if (isMult128(width) && isMult128(height)) {
      signals.push({ label: `Dimensions are multiples of 128 (${width}×${height})`, suspicious: true })
      suspicionScore += 20
    } else if (isMult64(width) && isMult64(height)) {
      signals.push({ label: `Dimensions are multiples of 64 (${width}×${height})`, suspicious: true })
      suspicionScore += 12
    } else if (isPow2(width) && isPow2(height)) {
      signals.push({ label: `Power-of-2 dimensions detected (${width}×${height})`, suspicious: true })
      suspicionScore += 18
    } else {
      // Irregular dimensions = real camera
      signals.push({ label: `Irregular dimensions — likely real camera (${width}×${height})`, suspicious: false })
      suspicionScore -= 10
    }

    // Check aspect ratio
    const ratio = width / height
    const commonAIRatios = [1.0, 1.5, 0.667, 1.778, 0.5625, 1.333, 0.75]
    const isCommonAIRatio = commonAIRatios.some(r => Math.abs(ratio - r) < 0.02)
    if (isCommonAIRatio && !exactMatch) {
      signals.push({ label: `Aspect ratio matches common AI output`, suspicious: true })
      suspicionScore += 8
    }
  }

  // Very high resolution photos from real cameras
  if (width * height > 12000000) { // > 12 megapixels
    signals.push({ label: `High-res ${Math.round(width * height / 1000000)}MP — typical real camera`, suspicious: false })
    suspicionScore -= 15
  }

  return {
    score: Math.max(0, Math.min(90, suspicionScore)),
    signals,
    confidence: exactMatch ? 'high' : suspicionScore > 20 ? 'medium' : 'low',
    dimensions: `${width}×${height}`
  }
}