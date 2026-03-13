export async function POST(request) {
  try {
    const formData = await request.formData()
    const image = formData.get('image')
    if (!image) return Response.json({ error: 'No image provided' }, { status: 400 })

    const buffer = Buffer.from(await image.arrayBuffer())
    const key = process.env.HUGGINGFACE_API_KEY
    if (!key) return Response.json({ error: 'API key missing' }, { status: 500 })

    // Weights based on observed performance
    // haywoodsloan consistently scores AI images highest → 50%
    // umm-maybe good general detector → 30%
    // Organika/sdxl weaker on non-SDXL images → 20%
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
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': image.type || 'image/jpeg' },
            body: buffer,
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

    // Redistribute weights from failed models proportionally
    const totalWeight = successful.reduce((sum, m) => sum + m.weight, 0)
    const combined = Math.round(
      successful.reduce((sum, m) => sum + (m.aiScore * (m.weight / totalWeight)), 0)
    )

    const scores = successful.map(m => m.aiScore)
    const disagreement = Math.max(...scores) - Math.min(...scores) > 25

    // Confidence level based on model agreement
    const stdDev = Math.sqrt(scores.reduce((sum, s) => sum + Math.pow(s - combined, 2), 0) / scores.length)
    const confidence = stdDev < 10 ? 'high' : stdDev < 25 ? 'medium' : 'low'

    return Response.json({
      combined,
      modelResults: successful,
      disagreement,
      confidence,
      modelsUsed: successful.length,
      failedModels: failed
    })
  } catch (error) {
    console.error('Route error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}