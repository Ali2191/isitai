import sharp from 'sharp'

export async function POST(request) {
  try {
    const formData = await request.formData()
    const image = formData.get('image')
    if (!image) return Response.json({ error: 'No image provided' }, { status: 400 })

    const key = process.env.HUGGINGFACE_API_KEY
    if (!key) return Response.json({ error: 'API key missing' }, { status: 500 })

    const rawBuffer = Buffer.from(await image.arrayBuffer())

    // Get dimensions ONLY — do NOT resize before sending to HF
    // Critical fix: HF inference API handles all preprocessing internally.
    // Pre-resizing with Sharp was causing result discrepancy vs HF playground.
    let imageDimensions = { width: 0, height: 0 }
    let sendBuffer = rawBuffer
    const mimeType = image.type || 'image/jpeg'

    try {
      const metadata = await sharp(rawBuffer).metadata()
      imageDimensions = { width: metadata.width || 0, height: metadata.height || 0 }

      // Only convert format if needed — no resize, no crop, no distortion
      if (metadata.format && !['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format)) {
        sendBuffer = await sharp(rawBuffer).jpeg({ quality: 92 }).toBuffer()
      }
    } catch (e) {
      sendBuffer = rawBuffer
    }

    const dimensionScore = analyzeDimensions(imageDimensions.width, imageDimensions.height)

    // Phase 1: Top 2 models only — sdxl-detector removed
    // haywoodsloan: 60% weight — highest sensitivity on modern AI outputs
    // umm-maybe: 40% weight — strong GAN + diverse generator coverage
    const models = [
      { name: 'umm-maybe/AI-image-detector', weight: 0.40 },
      { name: 'haywoodsloan/ai-image-detector-deploy', weight: 0.60 },
    ]

    const results = await Promise.allSettled(
      models.map(async (model) => {
        const res = await fetch(
          `https://router.huggingface.co/hf-inference/models/${model.name}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              // Send as original mime type — HF handles its own normalization
              'Content-Type': mimeType,
            },
            body: sendBuffer,
          }
        )

        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`HTTP ${res.status}: ${errText.slice(0, 120)}`)
        }

        const text = await res.text()
        let data
        try { data = JSON.parse(text) }
        catch { throw new Error(`Non-JSON response: ${text.slice(0, 80)}`) }

        if (data.error) throw new Error(data.error)
        if (!Array.isArray(data)) throw new Error(`Unexpected response format`)

        // Normalize label detection — handles both model label conventions
        const aiEntry = data.find(d => {
          const label = (d.label || '').toLowerCase()
          return label.includes('artificial') ||
                 label.includes('fake') ||
                 label.includes('ai') ||
                 label === 'ai-generated' ||
                 label === 'generated'
        })

        if (!aiEntry) throw new Error(`No AI label in: ${data.map(d => d.label).join(', ')}`)
        return {
          name: model.name,
          shortName: model.name.split('/')[1],
          weight: model.weight,
          aiScore: Math.round(aiEntry.score * 100),
          rawLabels: data.map(d => ({ label: d.label, score: Math.round(d.score * 100) }))
        }
      })
    )

    const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value)
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason?.message)

    if (successful.length === 0) {
      return Response.json({
        error: 'All models failed — they may be cold-starting',
        details: failed
      }, { status: 500 })
    }

    // Disagreement-aware weighting
    const scores = successful.map(m => m.aiScore)
    const spread = successful.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0
    const disagreement = spread > 25

    let adjustedModels = [...successful]

    if (disagreement && spread > 35 && successful.length > 1) {
      // Boost haywoodsloan when disagreement is strong — it has highest sensitivity
      adjustedModels = adjustedModels.map(m => ({
        ...m,
        effectiveWeight: m.name.includes('haywoodsloan') ? 0.75 : 0.25,
        weightAdjusted: m.name.includes('haywoodsloan'),
      }))
    } else {
      adjustedModels = adjustedModels.map(m => ({ ...m, effectiveWeight: m.weight, weightAdjusted: false }))
    }

    const totalWeight = adjustedModels.reduce((s, m) => s + m.effectiveWeight, 0)
    const modelCombined = Math.round(
      adjustedModels.reduce((s, m) => s + (m.aiScore * (m.effectiveWeight / totalWeight)), 0)
    )

    // Confidence: lower when models disagree strongly
    const mean = modelCombined
    const variance = successful.reduce((s, m) => s + Math.pow(m.aiScore - mean, 2), 0) / successful.length
    const stdDev = Math.sqrt(variance)
    const confidence = stdDev < 8 ? 'high' : stdDev < 22 ? 'medium' : 'low'

    return Response.json({
      combined: modelCombined,
      modelResults: adjustedModels.map(m => ({
        name: m.name,
        shortName: m.shortName,
        weight: m.effectiveWeight,
        weightAdjusted: m.weightAdjusted,
        aiScore: m.aiScore,
      })),
      disagreement,
      disagreementSpread: spread,
      confidence,
      dimensionScore,
      imageDimensions,
      modelsUsed: successful.length,
      failedModels: failed,
    })

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}

function analyzeDimensions(width, height) {
  if (!width || !height) return { score: 0, signals: [], confidence: 'none' }
  const signals = []
  let suspicionScore = 0

  const aiSizes = [
    { w: 512, h: 512, label: 'SD 1.x standard', c: 'high' },
    { w: 768, h: 768, label: 'SD high-res', c: 'high' },
    { w: 1024, h: 1024, label: 'SDXL / DALL-E square', c: 'high' },
    { w: 1024, h: 1792, label: 'DALL-E 3 portrait', c: 'high' },
    { w: 1792, h: 1024, label: 'DALL-E 3 landscape', c: 'high' },
    { w: 1344, h: 768, label: 'Midjourney landscape', c: 'high' },
    { w: 768, h: 1344, label: 'Midjourney portrait', c: 'high' },
    { w: 1216, h: 832, label: 'Midjourney wide', c: 'medium' },
    { w: 832, h: 1216, label: 'Midjourney tall', c: 'medium' },
    { w: 512, h: 768, label: 'SD portrait', c: 'medium' },
    { w: 768, h: 512, label: 'SD landscape', c: 'medium' },
  ]

  const exactMatch = aiSizes.find(s => s.w === width && s.h === height)
  if (exactMatch) {
    signals.push({ label: `Exact match: ${exactMatch.label} (${width}×${height})`, suspicious: true })
    suspicionScore += exactMatch.c === 'high' ? 55 : 35
  } else {
    const isMult128 = n => n % 128 === 0
    const isMult64 = n => n % 64 === 0
    if (isMult128(width) && isMult128(height)) {
      signals.push({ label: `Multiples of 128 — common AI output size`, suspicious: true })
      suspicionScore += 20
    } else if (isMult64(width) && isMult64(height)) {
      signals.push({ label: `Multiples of 64 — possible AI output`, suspicious: true })
      suspicionScore += 10
    } else {
      signals.push({ label: `Irregular dimensions — real camera pattern (${width}×${height})`, suspicious: false })
      suspicionScore -= 8
    }
  }

  if (width * height > 12_000_000) {
    signals.push({ label: `${Math.round(width * height / 1_000_000)}MP — high-res camera photo`, suspicious: false })
    suspicionScore -= 12
  }

  return {
    score: Math.max(0, Math.min(90, suspicionScore)),
    signals,
    confidence: exactMatch ? 'high' : suspicionScore > 15 ? 'medium' : 'low',
    dimensions: `${width}×${height}`
  }
}