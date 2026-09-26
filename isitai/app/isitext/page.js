import SiblingTool from '../components/SiblingTool'

export const metadata = {
  title: 'Is It AI Text? — Free AI text detector (ChatGPT/Claude/Gemini)',
  description: 'Detect AI-generated text instantly: stylometric burstiness, perplexity proxies, LLM cliché fingerprints and optional model ensemble. No signup.',
  alternates: { canonical: '/isitext' },
}

export default function IsItTextPage() {
  return (
    <SiblingTool
      kind="text"
      api="/api/text"
      title="Is It AI Text?"
      intro="Paste any passage. We measure burstiness (humans vary sentence length wildly — LLMs don't), type-token ratio, punctuation habits and a growing fingerprint list of LLM clichés, then optionally consult open classifier models."
      placeholder="Paste the text you want to check (50+ characters)…"
      acceptHint="Works best on paragraphs longer than ~50 words. Translated or heavily edited text is harder for everyone."
    />
  )
}
