import SiblingTool from '../components/SiblingTool'

export const metadata = {
  title: 'Synthetic Audio Signals — IsItAI',
  description: 'Analyze audio for synthetic voice, TTS, and generated-music signals through spectral and waveform evidence. Results are probabilistic, not speaker identity proof.',
  alternates: { canonical: '/isitaudio' },
}

export default function IsItAudioPage() {
  return (
    <SiblingTool
      kind="audio"
      api="/api/audio"
      title="Synthetic audio signals"
      intro="Measure spectral rolloff, silence floors, waveform dynamics, and optional reference-track consistency. These are probabilistic audio signals, not proof of speaker identity or authorship."
      acceptHint="MP3, WAV, OGG, M4A up to 25 MB. Analyzed transiently — nothing is uploaded anywhere else."
    />
  )
}
