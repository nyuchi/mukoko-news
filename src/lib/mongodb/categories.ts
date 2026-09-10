/**
 * Server-side MongoDB category and tag queries.
 * Import only in Server Components, Route Handlers, or Server Actions.
 */

import { getDb, QUERY_MAX_TIME_MS } from './client'
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

/**
 * How far back the derived-category pipelines look, and how many articles they
 * are allowed to touch.
 *
 * Both bounds are load-bearing. The unbounded version of this aggregation
 * (`$match` on two `$ne`s, then `$unwind`/`$group` over everything) is a COLLSCAN
 * of the whole 1.47 GB `articles` collection: measured on the live cluster it ran
 * past 60 SECONDS, well beyond the driver's 20s socket timeout, so it could never
 * return — it could only throw. Since `news.categories` is empty, that was the
 * live path on every single home-page and nav render.
 *
 * A `datePublished` lower bound turns it into a range seek on
 * `status_1_datePublished_-1` (key `{datePublished: -1, status: 1}`), and the
 * `$limit` caps the work regardless of how dense that window turns out to be.
 *
 * The bounds are measured, not guessed. `FETCH` dominates this pipeline because
 * an article document is fat (`embedding` is 1024 floats, plus three renditions
 * of the body), and the `$project` runs after the fetch, so it saves nothing:
 * 20,000 documents cost 44s of FETCH against 2.2s of IXSCAN. At 30 days / 3,000
 * documents the whole pipeline runs in **1.4s** — and returns the identical 17
 * categories the 20,000-document version did. The tighter bound costs nothing
 * real; it only stops paying for history that cannot change the answer.
 *
 * Thirty days also answers the question the nav is actually asking — "what is
 * this newsroom publishing?" — not "what has it ever published". A category with
 * nothing in a month is not one readers need a tab for.
 */
const DERIVED_CATEGORY_WINDOW_DAYS = 30
const DERIVED_CATEGORY_SCAN_CAP = 3000

function derivedCategoryPipeline(limit: number) {
  const since = new Date(Date.now() - DERIVED_CATEGORY_WINDOW_DAYS * 86400_000)
  return [
    {
      $match: {
        datePublished: { $gte: since },
        status: { $ne: 'rejected' },
        moderationStatus: { $ne: 'removed' },
      },
    },
    // Sorting on the index key before the cap makes the ceiling meaningful: the
    // articles we keep are the most recent ones, not an arbitrary 20k.
    { $sort: { datePublished: -1 } },
    { $limit: DERIVED_CATEGORY_SCAN_CAP },
    { $project: { 'engagement.interest_categories': 1 } },
    { $unwind: '$engagement.interest_categories' },
    { $group: { _id: '$engagement.interest_categories', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: limit },
  ]
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
  // real categories lead the quick-nav bar. Bounded — see
  // DERIVED_CATEGORY_WINDOW_DAYS.
  const rows = await db
    .collection('articles')
    .aggregate<{ _id: string; n: number }>(derivedCategoryPipeline(24), {
      maxTimeMS: QUERY_MAX_TIME_MS,
    })
    .toArray()

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
  // Same bounded shape as getCategories — this is the identical COLLSCAN
  // otherwise, and it runs whenever `trendingCache` has expired.
  const rows = await db
    .collection('articles')
    .aggregate<{ _id: string; n: number }>(derivedCategoryPipeline(limit), {
      maxTimeMS: QUERY_MAX_TIME_MS,
    })
    .toArray()
  return rows
    .filter(r => typeof r._id === 'string' && r._id.trim().length > 0)
    .map(r => {
      const slug = r._id.trim()
      return {
        id: slug,
        name: slugToName(slug),
        slug,
        article_count: r.n,
      }
    })
}
