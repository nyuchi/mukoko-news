/**
 * Server-side MongoDB feed source queries.
 * Import only in Server Components, Route Handlers, or Server Actions.
 */

import { getDb } from './client'
import { clampInt, MAX_LIMIT } from '@/lib/safety'

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

interface MongoFeedSourceWithOrg extends MongoFeedSource {
  mediaOrganizationId?: string
  org?: { isVerified?: boolean; publisherTier?: string } | null
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
  /** True when the org behind this source is a verified publisher (Tier-2). */
  verified?: boolean
  publisher_tier?: string
}>> {
  const db = await getDb()
  // $lookup the publisher (newsMediaOrganizations) so the directory can badge
  // sources whose organization has passed Tier-2 verification. feedSources
  // .mediaOrganizationId → newsMediaOrganizations._id (both string ids).
  const docs = await db
    .collection<MongoFeedSource>('feedSources')
    .aggregate<MongoFeedSourceWithOrg>([
      { $match: { isActive: true } },
      { $sort: { articleCount: -1 } },
      {
        $lookup: {
          from: 'newsMediaOrganizations',
          localField: 'mediaOrganizationId',
          foreignField: '_id',
          as: 'org',
          pipeline: [{ $project: { isVerified: 1, publisherTier: 1 } }],
        },
      },
      { $set: { org: { $first: '$org' } } },
    ])
    .toArray()

  return docs.map((d) => ({
    id: d._id,
    name: d.name,
    url: d.feedUrl,
    country_id: d.countryCode,
    article_count: d.articleCount,
    last_fetched_at: d.lastFetchedAt?.toISOString(),
    error_count: d.consecutiveFailures,
    last_error: d.lastFetchError || undefined,
    verified: d.org?.isVerified === true,
    publisher_tier: d.org?.publisherTier || undefined,
  }))
}

export async function getTrendingAuthors(limit = 5): Promise<{
  trending_authors: Array<{ id: string; name: string; article_count: number }>
}> {
  limit = clampInt(limit, 1, MAX_LIMIT, 5)
  const db = await getDb()
  const results = await db.collection('articles').aggregate<{ _id: string; count: number }>([
    { $match: { status: { $ne: 'rejected' }, author: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: '$author', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]).toArray()

  return {
    trending_authors: results.map(r => ({
      id: r._id,
      name: r._id,
      article_count: r.count,
    })),
  }
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
