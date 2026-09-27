import SiblingTool from '../components/SiblingTool'

export const metadata = {
  title: 'Writing Authorship Signals — IsItAI',
  description: 'Analyze writing for AI-associated stylometric signals, burstiness, language fingerprints, and uncertainty. Results are not proof of authorship.',
  alternates: { canonical: '/isitext' },
}

export default function IsItTextPage() {
  return (
    <SiblingTool
      kind="text"
      api="/api/text"
      title="Writing authorship signals"
      intro="Paste a passage to measure burstiness, vocabulary variation, punctuation habits and AI-associated language fingerprints. The result is a writing-style signal, not proof of who authored the text."
      placeholder="Paste the text you want to check (50+ characters)…"
      acceptHint="Works best on paragraphs longer than ~50 words. Translated or heavily edited text is harder for everyone."
    />
  )
}
