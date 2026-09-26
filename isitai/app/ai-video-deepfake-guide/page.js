import { ContentShell, H2, P, UL, seo } from '../content'

export const metadata = seo({
  title: 'AI Video Deepfakes in 2026: How to Spot Them',
  description: 'A guide to detecting AI-generated video and deepfakes: temporal artifacts, blinking and lip-sync anomalies, C2PA provenance for video, and tools that actually work.',
  path: '/ai-video-deepfake-guide',
})

export default function DeepfakeGuide() {
  return (
    <ContentShell breadcrumb="AI video & deepfake guide">
      <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)', fontWeight: 900, letterSpacing: '-0.03em', margin: '0 0 1rem', lineHeight: 1.15 }}>AI Video Deepfakes in 2026: What to Look For</h1>
      <P>Sora-class text-to-video models and real-time face-swappers have made moving fakes cheap and fast. Video adds temporal dimensions to the detection problem — and new tells that single frames hide.</P>

      <H2>Per-frame tells (same as still images)</H2>
      <UL items={[
        'Hands, teeth, earrings, and text on signs deform frame-by-frame.',
        'Background objects drift, merge, or pop in and out of existence.',
        'Skin texture over-smoothed; frequency spectra show generator upsampling spikes.',
        'Metadata: no camera EXIF, no device model, sometimes a generator XMP block.',
      ]} />

      <H2>Temporal tells unique to video</H2>
      <UL items={[
        'Blink rate too low or metronomically regular; natural blinks vary.',
        'Lip sync breaks during plosives (p/b/m) or when the speaker turns.',
        'Illumination flicker inconsistent with scene lighting.',
        'Face/neck boundary blur under motion — classic GAN face-swap seam.',
        'Impossible physics: reflections lagging, shadows changing independently.',
      ]} />

      <H2>Compression is your enemy (and theirs)</H2>
      <P>WhatsApp, Zoom recordings, and broadcast re-encodes destroy pixel-level evidence in real footage too — so pixel detectors false-positive less than you'd think, but also catch fewer fakes. The most robust remaining signals after heavy compression are metadata/provenance and audio-visual desync.</P>

      <H2>Provenance: the strongest defense</H2>
      <UL items={[
        'C2PA manifests now cover video captured on Adobe-supported and Truepic cameras — a valid capture manifest is strong authenticity evidence.',
        'SynthID for video (Google DeepMind) embeds invisible watermarks in Gemini-generated clips.',
        'Platform credentials: YouTube/TikTok "shot on device" attestations and election-content labels.',
      ]} />

      <H2>What IsItAI covers today</H2>
      <P>IsItAI analyzes image frames — including keyframes you export from suspicious video — across five forensic layers with explainable verdicts and uncertainty bands. For a clip, extract 5–10 varied frames and batch-analyze them: a genuine clip shows consistent camera evidence; generated ones fail together on the same tells. Audio deepfake detection and full temporal analysis are on the roadmap.</P>
    </ContentShell>
  )
}
