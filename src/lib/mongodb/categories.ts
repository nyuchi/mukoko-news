/**
 * Server-side MongoDB category and tag queries.
 * Import only in Server Components, Route Handlers, or Server Actions.
 */

import { getDb } from './client'
import { clampInt, MAX_LIMIT } from '@/lib/safety'
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

/** Title-case a category slug for display: "international" → "International",
 *  "arts-culture" → "Arts Culture". Used when a category comes from the AI
 *  classification (a bare slug) rather than a curated `categories` doc with a name. */
function slugToName(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function getCategories(): Promise<Category[]> {
  const db = await getDb()

  // Prefer curated category docs when the collection is populated…
  const curated = await db.collection<MongoCategory>('categories')
    .find({})
    .sort({ sortOrder: 1 })
    .toArray()
  if (curated.length > 0) {
    return curated.map(d => ({
      id: d._id,
      name: d.name,
      slug: d.categorySlug,
    }))
  }

  // …otherwise derive the list from the categories articles are ACTUALLY
  // classified into. AI enrichment writes slugs to
  // `engagement.interest_categories`; the legacy `articleSection` is hardcoded
  // "general" at ingestion, so grouping on it (the old behaviour) collapsed the
  // whole nav to a single "general" bucket. Rank by article count so the busiest
  // real categories lead the quick-nav bar.
  const rows = await db.collection('articles').aggregate<{ _id: string; n: number }>([
    { $match: { status: { $ne: 'rejected' }, moderationStatus: { $ne: 'removed' } } },
    { $unwind: '$engagement.interest_categories' },
    { $group: { _id: '$engagement.interest_categories', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 24 },
  ]).toArray()

  return rows
    .filter((r) => typeof r._id === 'string' && r._id.trim().length > 0)
    .map((r) => {
      const slug = r._id.trim()
      return { id: slug, name: slugToName(slug), slug, article_count: r.n }
    })
}

export async function getTrendingTags(limit = 32): Promise<Array<{
  id: string
  name: string
  slug: string
  type: string
  article_count: number
}>> {
  limit = clampInt(limit, 1, MAX_LIMIT, 32)
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
  limit = clampInt(limit, 1, MAX_LIMIT, 8)
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

  // Live fallback: aggregate from the AI-classified categories
  // (`engagement.interest_categories`), NOT the hardcoded-"general"
  // `articleSection`, so trending reflects real topic distribution.
  const pipeline = [
    { $match: { status: { $ne: 'rejected' }, moderationStatus: { $ne: 'removed' } } },
    { $unwind: '$engagement.interest_categories' },
    { $group: { _id: '$engagement.interest_categories', article_count: { $sum: 1 } } },
    { $sort: { article_count: -1 } },
    { $limit: limit },
  ]
  const rows = await db.collection('articles').aggregate(pipeline).toArray()
  return rows
    .filter(r => typeof r._id === 'string' && (r._id as string).trim().length > 0)
    .map(r => {
      const slug = (r._id as string).trim()
      return {
        id: slug,
        name: slugToName(slug),
        slug,
        article_count: r.article_count as number,
      }
    })
}
