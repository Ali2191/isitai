import VideoClient from './VideoClient'

export const metadata = {
  title: 'Is It AI Video? — Temporal Deepfake Detector | IsItAI',
  description: 'Analyze video and animated GIF keyframes for temporal inconsistency, synthetic noise, and generated-video evidence with calibrated uncertainty.',
  alternates: { canonical: '/isvideo' },
}

export default function IsVideoPage() { return <VideoClient /> }
