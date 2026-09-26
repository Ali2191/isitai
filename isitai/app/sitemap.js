import { SITE } from './content'

export default function sitemap() {
  const now = new Date('2026-09-27')
  const routes = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/how-to-detect-ai-images', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/midjourney-vs-dalle-detector', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/ai-video-deepfake-guide', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/api-guide', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
  ]
  return routes.map(r => ({
    url: `${SITE}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }))
}
