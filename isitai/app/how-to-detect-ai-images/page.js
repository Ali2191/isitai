import { ContentShell, H2, P, UL, seo } from '../content'

export const metadata = seo({
  title: 'How to Detect AI-Generated Images (2026 Field Guide)',
  description: 'A practical guide to spotting AI-generated images: EXIF metadata, C2PA credentials, SynthID watermarks, frequency artifacts, and when to use an automated detector like IsItAI.',
  path: '/how-to-detect-ai-images',
})

export default function HowToDetect() {
  return (
    <ContentShell breadcrumb="How to detect AI-generated images">
      <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.9rem' }}>Field guide · Updated 2026</p>
      <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)', fontWeight: 900, letterSpacing: '-0.03em', margin: '0 0 1rem', lineHeight: 1.15 }}>How to Detect AI-Generated Images</h1>
      <P>Modern generators — Midjourney v7, DALL·E, Flux, Imagen, GPT-image — produce images that are visually indistinguishable from photographs. But they leak evidence in places human eyes never look: file headers, metadata blocks, frequency spectra, and watermark channels. This guide covers every reliable technique, from a 30-second manual check to automated multi-layer forensics.</P>

      <H2>1. Check the metadata (EXIF) first</H2>
      <P>Real cameras embed a rich provenance record: make, model, lens, exposure, ISO, GPS, and capture timestamp. Most AI generators write little or nothing. On Windows, right-click → Properties → Details; on macOS, open in Preview → Tools → Show Inspector. Look for:</P>
      <UL items={[
        'Camera Make/Model present? Strong real-photo signal.',
        'Software field naming Stable Diffusion, Midjourney, ComfyUI, DALL-E, or Firefly? Near-definitive proof of generation.',
        'No metadata at all? Suspicious, but remember WhatsApp, Twitter, and Instagram strip EXIF from re-uploaded photos.',
        'Missing DateTimeOriginal while other fields exist? A tampering hint.',
      ]} />

      <H2>2. Look for cryptographic provenance: C2PA and Content Credentials</H2>
      <P>C2PA is an open standard for signed image provenance. Adobe Lightroom, Nikon and Sony cameras, and Leica's Nocturne now embed signed manifests that survive editing. Files with a valid C2PA "captured with a camera" claim are about as trustworthy as it gets; ones signed by an AI tool are confessed generations. Verify at contentcredentials.org/verify, or just upload to IsItAI — we parse C2PA boxes automatically.</P>

      <H2>3. Watermarks: SynthID, GLIGEN, and IPTC AI tags</H2>
      <UL items={[
        "SynthID: Google's invisible watermark in Gemini/Imagen outputs. Container-level markers can sometimes be detected even after the visible badge is cropped.",
        'GLIGEN "tree-ring" fingerprints left by some Stable Diffusion pipelines.',
        'XMP Generator fields written by GPT-image and many web UIs.',
        'IPTC "AI-generated" digital source labels used by stock platforms like Shutterstock and Getty.',
      ]} />

      <H2>4. Inspect the pixels: frequency and texture artifacts</H2>
      <P>Upsampling layers in GANs and diffusion models leave periodic patterns that show up as spikes in the Fourier spectrum. Natural photographs follow a predictable 1/f power-law decay of high-frequency energy. Zoom to 100% and also check for:</P>
      <UL items={[
        'Over-smooth skin or fabric — diffusion models denoise fine texture.',
        'Symmetry too perfect in faces.',
        'Nonsense details: hands, text, jewelry, background signage.',
        'Inconsistent lighting direction or physically impossible shadows.',
      ]} />

      <H2>5. Dimension heuristics</H2>
      <P>Generators emit standard canvas sizes: 1024×1024, 1024×1792, 1344×768, 1008×1776, or anything divisible by 64/128 with no sensor explanation. Real cameras output sensor-native resolutions like 4032×3024 or 6000×4000.</P>

      <H2>6. Use an automated multi-signal detector</H2>
      <P>Manual checks miss things and false-flag social-media re-uploads. IsItAI fuses all five evidence classes above — ML classifier ensemble, server-side EXIF parsing, C2PA/SynthID scans, JPEG container forensics, and 2-D FFT pixel analysis — into one score with an honest uncertainty band, and explains every flagged signal in plain English. It's free, needs no account, and never stores your images.</P>

      <H2>What detectors still get wrong</H2>
      <P>No tool is perfect. Heavy recompression (WhatsApp, screenshots) erases pixel evidence; AI-then-photoshopped hybrids sit in the middle; and detectors trained on older generators under-flag the newest ones. That's why we publish uncertainty bands instead of pretending to certainty, and why "no strong indicators" ≠ "proof it's real."</P>
    </ContentShell>
  )
}
