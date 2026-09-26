import BenchmarkClient from './BenchmarkClient'

export const metadata = {
  title: 'Public benchmark — how accurate is IsItAI?',
  description: 'Our detection pipeline evaluated against known labeled datasets (DiffusionDB, GenImage, WildRF subsets): accuracy, precision, recall, ROC-AUC and confusion matrices. Reproducible with one command.',
  alternates: { canonical: '/benchmark' },
}

export default function BenchmarkPage() {
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '40px 20px', color: '#eee', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/" style={{ color: '#8ab4f8' }}>← IsItAI home</a>
      <h1 style={{ marginTop: 16 }}>Public benchmark</h1>
      <p style={{ color: '#aaa', lineHeight: 1.6 }}>
        Transparency is the product. We run the exact same pipeline users hit at isitai.app against published
        labeled datasets and report every number — including where we fail. Re-run it yourself:
        {' '}<code style={{ color: '#9cdcfe' }}>node scripts/benchmark.mjs &lt;samples-dir&gt;</code>
      </p>
      <BenchmarkClient />
    </main>
  )
}
