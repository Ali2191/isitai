import SiblingTool from '../components/SiblingTool'

export const metadata = {
  title: 'Is It AI Audio? — Free TTS / AI music detector',
  description: 'Upload audio (MP3/WAV/OGG/M4A) to detect AI voice cloning, TTS and generated music via spectral artifact analysis. Processed in memory, never stored.',
  alternates: { canonical: '/isitaudio' },
}

export default function IsItAudioPage() {
  return (
    <SiblingTool
      kind="audio"
      api="/api/audio"
      title="Is It AI Audio?"
      intro="Neural voices (ElevenLabs, OpenVoice, Suno, Udio) leave consistent tells: over-clean high-frequency rolloff, unnatural silence floors and periodic vocoder artifacts. We decode the waveform and measure them directly."
      acceptHint="MP3, WAV, OGG, M4A up to 25 MB. Analyzed transiently — nothing is uploaded anywhere else."
    />
  )
}
