/**
 * Server-side MongoDB category and tag queries.
 * Import only in Server Components, Route Handlers, or Server Actions.
 */

import { getDb } from './client'
import type { Category } from '@/lib/api'

interface MongoCategory {
  _id: string
  categorySlug: string
  name: string
  description?: string
  sortOrder: number
}

interface MongoTag {
  _id: string
  tagSlug: string
  name: string
  articleCount: number
}

interface MongoTrendingCache {
  _id: string
  scope: string
  tagId: string
  term: string
  articleCount: number
  score: number
  computedAt: Date
  expiresAt: Date
}

export async function getCategories(): Promise<Category[]> {
  const db = await getDb()
  const docs = await db.collection<MongoCategory>('categories')
    .find({})
    .sort({ sortOrder: 1 })
    .toArray()

  return docs.map(d => ({
    id: d._id,
    name: d.name,
    slug: d.categorySlug,
  }))
}

export async function getTrendingTags(limit = 32): Promise<Array<{
  id: string
  name: string
  slug: string
  type: string
  article_count: number
}>> {
  const db = await getDb()
  const docs = await db.collection<MongoTag>('tags')
    .find({ articleCount: { $gt: 0 } })
    .sort({ articleCount: -1 })
    .limit(limit)
    .toArray()

  return docs.map(d => ({
    id: d._id,
    name: d.name,
    slug: d.tagSlug,
    type: 'tag',
    article_count: d.articleCount,
  }))
}

export async function getTrendingCategories(limit = 8): Promise<Array<{
  id: string
  name: string
  slug: string
  article_count: number
}>> {
  const db = await getDb()

  // Use trendingCache if populated, fall back to live aggregation
  const cached = await db.collection<MongoTrendingCache>('trendingCache')
    .find({ scope: 'global', expiresAt: { $gt: new Date() } })
    .sort({ score: -1 })
    .limit(limit)
    .toArray()

  if (cached.length > 0) {
    return cached.map(c => ({
      id: c.tagId,
      name: c.term,
      slug: c.tagId,
      article_count: c.articleCount,
    }))
  }

  // Live fallback: aggregate from articles
  const pipeline = [
    { $match: { status: { $in: ['approved', 'published'] }, articleSection: { $exists: true, $ne: null } } },
    { $group: { _id: '$articleSection', article_count: { $sum: 1 } } },
    { $sort: { article_count: -1 } },
    { $limit: limit },
  ]
  const rows = await db.collection('articles').aggregate(pipeline).toArray()
  return rows.map(r => ({
    id: r._id as string,
    name: r._id as string,
    slug: (r._id as string).toLowerCase().replace(/\s+/g, '-'),
    article_count: r.article_count as number,
  }))
}
