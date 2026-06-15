/**
 * Server-side MongoDB reads for the admin app.
 * Import only in Server Components, Route Handlers, or Server Actions.
 *
 * Reads come straight from the `news` database. Mutations are NOT done here —
 * they go through the gateway Worker's WorkOS-gated /api/admin/* endpoints
 * (see src/lib/admin/gateway.ts).
 */

import { getDb } from './client'

export interface AdminSource {
  id: string
  name: string
  url: string
  countryCode: string
  isActive: boolean
  articleCount: number
  lastFetchedAt?: string
  consecutiveFailures?: number
  lastFetchStatus?: string
  lastFetchError?: string
}

export interface AdminArticle {
  id: string
  title: string
  source?: string
  countryCode?: string
  category?: string
  status?: string
  moderationStatus?: string
  url?: string
  datePublished?: string
}

export interface AdminStats {
  totalArticles: number
  activeSources: number
  categories: number
  todayArticles: number
  pendingArticles: number
}

interface MongoFeedSource {
  _id: string
  name: string
  feedUrl: string
  countryCode: string
  isActive: boolean
  articleCount?: number
  lastFetchedAt?: Date
  consecutiveFailures?: number
  lastFetchStatus?: string
  lastFetchError?: string
}

interface MongoArticle {
  _id: string
  title: string
  sourceName?: string
  source?: string
  countryCode?: string
  category?: string
  status?: string
  moderationStatus?: string
  link?: string
  url?: string
  datePublished?: Date
}

/** Aggregate counts for the dashboard. */
export async function getAdminStats(): Promise<AdminStats> {
  const db = await getDb()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [totalArticles, activeSources, categories, todayArticles, pendingArticles] =
    await Promise.all([
      db.collection('articles').countDocuments({ status: { $ne: 'rejected' }, moderationStatus: { $ne: 'removed' } }),
      db.collection('feedSources').countDocuments({ isActive: true }),
      db.collection('categories').countDocuments({}),
      db.collection('articles').countDocuments({
        status: { $ne: 'rejected' },
        moderationStatus: { $ne: 'removed' },
        datePublished: { $gte: today },
      }),
      db.collection('articles').countDocuments({ moderationStatus: 'flagged' }),
    ])

  return { totalArticles, activeSources, categories, todayArticles, pendingArticles }
}

/** All feed sources, most-productive first. */
export async function getAdminSources(): Promise<AdminSource[]> {
  const db = await getDb()
  const docs = await db
    .collection<MongoFeedSource>('feedSources')
    .find({})
    .sort({ articleCount: -1 })
    .limit(200)
    .toArray()

  return docs.map((d) => ({
    id: String(d._id),
    name: d.name,
    url: d.feedUrl,
    countryCode: d.countryCode,
    isActive: d.isActive,
    articleCount: d.articleCount ?? 0,
    lastFetchedAt: d.lastFetchedAt?.toISOString(),
    consecutiveFailures: d.consecutiveFailures,
    lastFetchStatus: d.lastFetchStatus,
    lastFetchError: d.lastFetchError || undefined,
  }))
}

/** Articles for the moderation queue, filtered by moderationStatus. */
export async function getAdminArticles(moderationStatus?: string): Promise<AdminArticle[]> {
  const db = await getDb()
  const filter = moderationStatus ? { moderationStatus } : {}
  const docs = await db
    .collection<MongoArticle>('articles')
    .find(filter)
    .sort({ datePublished: -1 })
    .limit(100)
    .toArray()

  return docs.map((d) => ({
    id: String(d._id),
    title: d.title,
    source: d.sourceName ?? d.source,
    countryCode: d.countryCode,
    category: d.category,
    status: d.status,
    moderationStatus: d.moderationStatus,
    url: d.link ?? d.url,
    datePublished: d.datePublished?.toISOString(),
  }))
}
