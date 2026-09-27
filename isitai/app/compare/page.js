import CompareClient from './CompareClient'

export const metadata = {
  title: 'Compare Images for Edits and Manipulation — IsItAI',
  description: 'Compare an original and suspected image to locate changed regions, metadata changes, and compression differences with transparent forensic evidence.',
  alternates: { canonical: '/compare' },
}

export default function ComparePage() { return <CompareClient /> }
