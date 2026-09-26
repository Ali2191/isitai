import { ContentShell, H2, P, UL, seo } from '../content'

export const metadata = seo({
  title: 'Midjourney vs DALL-E vs Flux vs SD: Telling AI Images Apart',
  description: 'How images from Midjourney, DALL-E 3, Flux, and Stable Diffusion differ forensically — canvas sizes, metadata signatures, watermark behavior — and how to detect each.',
  path: '/midjourney-vs-dalle-detector',
})

export default function GeneratorComparison() {
  return (
    <ContentShell breadcrumb="Generator fingerprint guide">
      <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)', fontWeight: 900, letterSpacing: '-0.03em', margin: '0 0 1rem', lineHeight: 1.15 }}>Midjourney vs DALL·E vs Flux vs Stable Diffusion: Forensic Fingerprints</h1>
      <P>Sometimes the question isn't "real or AI?" but "which AI made this?" Each major generator leaves a distinct forensic trail. Knowing them helps journalists attribute leaks, artists spot style theft, and anyone sanity-check a detection result.</P>

      <H2>Canvas sizes</H2>
      <UL items={[
        'Midjourney: 1024×1024, 1344×768 / 768×1344 (v5), 13:9 ultrawide variants, and 2048×2048 upscales.',
        'DALL·E 3: exactly 1024×1024, 1792×1024, or 1024×1792.',
        'Flux: 1008×1776 / 1776×1008 and other 32-multiple aspect presets.',
        'Stable Diffusion 1.x: 512×512 base; SDXL: 1024×1024 and 832×1216-style aspect buckets.',
      ]} />
      <P>If a "photo" arrives at exactly 1024×1792, it has almost certainly never touched a camera sensor.</P>

      <H2>Metadata signatures</H2>
      <UL items={[
        'DALL·E (ChatGPT/OpenAI API): XMP blocks with an "Engine"/Generator field naming gpt-image-1 or dall-e; newer files carry C2PA manifests signed by OpenAI.',
        'Midjourney: website downloads often include a Software/Prompt hint in XMP; Discord CDN strips most of it.',
        'Stable Diffusion web UIs: Automatic1111 and ComfyUI embed the full prompt + sampler parameters in PNG tEXt chunks ("parameters", "workflow") — the loudest signature of all.',
        'Flux (black-forest-labs API): minimal EXIF, occasionally a BFL XMP credential block.',
      ]} />

      <H2>Watermarks & provenance</H2>
      <P>DALL·E/GPT-image outputs routed through ChatGPT include SynthID-style invisible watermarks and increasingly ship C2PA credentials. Midjourney does not watermark. SD/ComfyUI only carry whatever the operator configures. Verified C2PA with an AI generator assertion is currently the strongest attribution evidence available.</P>

      <H2>Pixel tells</H2>
      <UL items={[
        'Midjourney: painterly micro-texture, characteristic rim-lighting, hands improved sharply since v6.',
        'DALL·E 3: slightly oversmoothed surfaces, coherent rendered text (its party trick).',
        'SD 1.x: low-res softness, checkerboard upsample traces in the FFT spectrum.',
        'Flux: near-photographic noise, currently the hardest to catch on pixels alone — rely on metadata/dimensions.',
      ]} />

      <H2>Detect any of them automatically</H2>
      <P>IsItAI checks all of these fingerprints in one pass — dimension presets, XMP/PNG-chunk generator fields, C2PA assertions, watermark markers, and spectral artifacts — and shows which signals drove the verdict. Upload the image or paste its URL for free.</P>
    </ContentShell>
  )
}
