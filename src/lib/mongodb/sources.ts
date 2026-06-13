/**
 * Server-side MongoDB feed source queries.
 * Import only in Server Components, Route Handlers, or Server Actions.
 */

import { getDb } from './client'

interface MongoFeedSource {
  _id: string
  name: string
  feedUrl: string
  countryCode: string
  isActive: boolean
  articleCount: number
  lastFetchedAt?: Date
  consecutiveFailures?: number
  lastFetchStatus?: string
  lastFetchError?: string
  trustScore?: number
}

export async function getSources(): Promise<Array<{
  id: string
  name: string
  url: string
  country_id: string
  article_count: number
  last_fetched_at?: string
  error_count?: number
  last_error?: string
}>> {
  const db = await getDb()
  const docs = await db.collection<MongoFeedSource>('feedSources')
    .find({ isActive: true })
    .sort({ articleCount: -1 })
    .toArray()

  return docs.map(d => ({
    id: d._id,
    name: d.name,
    url: d.feedUrl,
    country_id: d.countryCode,
    article_count: d.articleCount,
    last_fetched_at: d.lastFetchedAt?.toISOString(),
    error_count: d.consecutiveFailures,
    last_error: d.lastFetchError || undefined,
  }))
}

export async function getStats(): Promise<{
  database: {
    total_articles: number
    active_sources: number
    categories: number
    today_articles: number
  }
}> {
  const db = await getDb()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [total_articles, active_sources, categories, today_articles] = await Promise.all([
    db.collection('articles').countDocuments({ status: { $in: ['approved', 'published'] } }),
    db.collection('feedSources').countDocuments({ isActive: true }),
    db.collection('categories').countDocuments({}),
    db.collection('articles').countDocuments({
      status: { $in: ['approved', 'published'] },
      datePublished: { $gte: today },
    }),
  ])

  return { database: { total_articles, active_sources, categories, today_articles } }
}
