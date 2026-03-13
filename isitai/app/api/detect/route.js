export async function POST(request) {
  try {
    const formData = await request.formData()
    const image = formData.get('image')
    if (!image) return Response.json({ error: 'No image provided' }, { status: 400 })

    const buffer = Buffer.from(await image.arrayBuffer())
    const key = process.env.HUGGINGFACE_API_KEY

    if (!key) return Response.json({ error: 'API key missing' }, { status: 500 })

    const models = [
      { name: 'umm-maybe/AI-image-detector', weight: 0.25 },
      { name: 'Organika/sdxl-detector', weight: 0.25 },
      { name: 'haywoodsloan/ai-image-detector-deploy', weight: 0.50 },
    ]

    const results = await Promise.allSettled(
      models.map(async (model) => {
        const res = await fetch(
          `https://router.huggingface.co/hf-inference/models/${model.name}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': image.type || 'image/jpeg',
            },
            body: buffer,
          }
        )

        const text = await res.text()
        console.log(`Model ${model.name} response:`, text)

        let data
        try { data = JSON.parse(text) }
        catch { throw new Error(`Invalid response: ${text.slice(0, 100)}`) }

        if (data.error) throw new Error(data.error)
        if (!Array.isArray(data)) throw new Error(`Unexpected format`)

        const aiEntry = data.find(d =>
          d.label?.toLowerCase().includes('artificial') ||
          d.label?.toLowerCase().includes('fake') ||
          d.label?.toLowerCase().includes('ai')
        )

        if (!aiEntry) throw new Error(`No AI label found in response`)
        return { name: model.name, weight: model.weight, aiScore: Math.round(aiEntry.score * 100) }
      })
    )

    const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value)
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason?.message)

    if (successful.length === 0) {
      return Response.json({ error: 'All models failed', details: failed }, { status: 500 })
    }

    const totalWeight = successful.reduce((sum, m) => sum + m.weight, 0)
    const combined = Math.round(
      successful.reduce((sum, m) => sum + (m.aiScore * m.weight), 0) / totalWeight
    )
    const scores = successful.map(m => m.aiScore)
    const disagreement = Math.max(...scores) - Math.min(...scores) > 25

    return Response.json({ combined, modelResults: successful, disagreement, modelsUsed: successful.length, failedModels: failed })

  } catch (error) {
    console.error('Route error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}