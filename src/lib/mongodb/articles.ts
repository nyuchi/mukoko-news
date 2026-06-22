/**
 * Server-side MongoDB article queries.
 * Maps MongoDB v3.1 schema (camelCase) → Article type used by components.
 * Import only in Server Components, Route Handlers, or Server Actions.
 */

import type { Collection, Filter } from 'mongodb'
import { getDb } from './client'
import type { Article } from '@/lib/api'

interface MongoArticle {
  _id: string
  _schemaVersion: string
  feedSourceId: string
  mediaOrganizationId: string
  externalUrl: string
  headline: string
  slug: string
  inLanguage: string
  status: string
  moderationStatus?: string
  isApproved: boolean
  scrapedAt: Date
  createdAt: Date
  updatedAt: Date
  description?: string
  articleBody?: string
  articleBodyProcessed?: string
  articleSection?: string
  datePublished?: Date
  // Image has been stored in several shapes across pipeline versions:
  //   schema.org array:  image: [{ url }]       (fly-worker rss/newsdata collectors)
  //   schema.org object: image: { url }         (parser intermediate)
  //   flat string:       image: "https://…"
  //   flat field:        imageUrl / image_url   (processing worker / edge cache)
  image?: Array<{ '@type'?: string; url?: string }> | { '@type'?: string; url?: string } | string
  imageUrl?: string
  image_url?: string
  wordCount?: number
  readingTimeMinutes?: number
  categoryIds?: string[]
  tagIds?: string[]
  // Current schema keeps categories + keywords under an `engagement` subdocument.
  // Elements may be plain strings (slug/name) or objects — handle both.
  engagement?: {
    interest_categories?: Array<string | { id?: string; category_id?: string; slug?: string; name?: string }>
    tags?: Array<string | { id?: string; slug?: string; name?: string }>
  }
  qualityScore?: number
  aiProcessed?: boolean
  embedding?: number[]
  searchScore?: number
  vectorSearchScore?: number
}

interface MongoFeedSource {
  _id: string
  name: string
  countryCode: string
  mediaOrganizationId: string
}

/**
 * Resolve an article's image URL across the schema variants the pipeline has
 * written over time (schema.org array/object, a flat string, or a flat
 * imageUrl / image_url field). Returns the first non-empty candidate.
 */
function resolveImageUrl(doc: MongoArticle): string | null {
  const img = doc.image
  let fromImage: string | undefined
  if (Array.isArray(img)) fromImage = img[0]?.url
  else if (img && typeof img === 'object') fromImage = img.url
  else if (typeof img === 'string') fromImage = img

  return fromImage || doc.imageUrl || doc.image_url || null
}

/** Human-readable label for a category/tag entry that may be a string or object. */
function entryLabel(entry: string | { id?: string; category_id?: string; slug?: string; name?: string }): string | undefined {
  if (typeof entry === 'string') return entry.trim() || undefined
  return entry.name || entry.slug || entry.id || entry.category_id || undefined
}

/**
 * Resolve an article's primary category. Current schema stores categories under
 * `engagement.interest_categories`; fall back to the legacy `articleSection`
 * (which the RSS collector hardcodes to "general").
 */
function resolveCategory(doc: MongoArticle): string | undefined {
  const cats = doc.engagement?.interest_categories
  if (Array.isArray(cats) && cats.length) {
    const label = entryLabel(cats[0])
    if (label) return label
  }
  return doc.articleSection || undefined
}

/** Map `engagement.tags` (strings or objects) onto the Article keyword shape. */
function resolveKeywords(doc: MongoArticle): Article['keywords'] {
  const tags = doc.engagement?.tags
  if (!Array.isArray(tags) || tags.length === 0) return undefined
  const mapped = tags
    .map((t) => {
      if (typeof t === 'string') {
        const v = t.trim()
        return v ? { id: v, name: v, slug: v } : null
      }
      const name = t.name || t.slug || t.id
      if (!name) return null
      return { id: t.id || t.slug || name, name, slug: t.slug || t.id || name }
    })
    .filter((k): k is { id: string; name: string; slug: string } => k !== null)
  return mapped.length ? mapped : undefined
}

function toArticle(doc: MongoArticle, source?: MongoFeedSource): Article {
  const imageUrl = resolveImageUrl(doc)
  return {
    id: doc._id,
    title: doc.headline,
    description: doc.description,
    content: doc.articleBodyProcessed || doc.articleBody,
    source: source?.name || doc.feedSourceId,
    source_id: doc.feedSourceId,
    slug: doc.slug,
    category: resolveCategory(doc),
    keywords: resolveKeywords(doc),
    country: source?.countryCode || undefined,
    image_url: imageUrl || undefined,
    original_url: doc.externalUrl,
    published_at: doc.datePublished?.toISOString() || doc.createdAt.toISOString(),
    updated_at: doc.updatedAt.toISOString(),
    word_count: doc.wordCount,
    reading_time: doc.readingTimeMinutes,
  }
}

export async function getArticles(params: {
  limit?: number
  page?: number
  category?: string
  categories?: string[]
  countries?: string[]
  sort?: 'latest' | 'trending' | 'popular'
} = {}): Promise<{ articles: Article[]; total: number }> {
  const db = await getDb()
  const { limit = 20, page = 1, category, categories, countries, sort = 'latest' } = params

  const filter: Filter<MongoArticle> = {
    status: { $ne: 'rejected' },
    moderationStatus: { $ne: 'removed' },
  }
  if (categories?.length) {
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.articleSection = { $in: categories.map(c => new RegExp(`^${escapeRegex(c)}$`, 'i')) } as never
  } else if (category) {
    filter.articleSection = category
  }
  if (countries?.length) {
    const sources = await db.collection<MongoFeedSource>('feedSources')
      .find({ countryCode: { $in: countries } }, { projection: { _id: 1 } })
      .toArray()
    const sourceIds = sources.map(s => s._id)
    filter.feedSourceId = { $in: sourceIds }
  }

  const col = db.collection<MongoArticle>('articles')
  const sortField = sort === 'latest' ? { datePublished: -1 } : { qualityScore: -1, datePublished: -1 }
  const skip = (page - 1) * limit

  const [docs, total] = await Promise.all([
    col.find(filter).sort(sortField as never).skip(skip).limit(limit).toArray(),
    col.countDocuments(filter),
  ])

  const sourceIds = [...new Set(docs.map(d => d.feedSourceId))]
  const sources = await db.collection<MongoFeedSource>('feedSources')
    .find({ _id: { $in: sourceIds } })
    .toArray()
  const sourceMap = new Map(sources.map(s => [s._id, s]))

  return {
    articles: docs.map(d => toArticle(d, sourceMap.get(d.feedSourceId))),
    total,
  }
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const db = await getDb()
  const doc = await db.collection<MongoArticle>('articles').findOne({ slug })
  if (!doc) return null

  const source = await db.collection<MongoFeedSource>('feedSources').findOne({ _id: doc.feedSourceId })
  return toArticle(doc, source || undefined)
}

export async function getArticleById(id: string): Promise<Article | null> {
  const db = await getDb()
  const doc = await db.collection<MongoArticle>('articles').findOne({ _id: id })
  if (!doc) return null

  const source = await db.collection<MongoFeedSource>('feedSources').findOne({ _id: doc.feedSourceId })
  return toArticle(doc, source || undefined)
}

export async function getRelatedArticles(articleId: string, limit = 5): Promise<Article[]> {
  const db = await getDb()
  const article = await db.collection<MongoArticle>('articles').findOne({ _id: articleId })
  if (!article) return []

  let docs: MongoArticle[]

  if (article.embedding?.length) {
    // Semantic similarity via Atlas Vector Search
    const pipeline = [
      {
        $vectorSearch: {
          index: 'articles_vector_search',
          path: 'embedding',
          queryVector: article.embedding,
          numCandidates: limit * 15,
          limit: limit + 1,
          filter: { status: { $ne: 'rejected' }, moderationStatus: { $ne: 'removed' } },
        },
      },
      { $match: { _id: { $ne: articleId } } },
      { $limit: limit },
      { $project: { embedding: 0 } },
    ]
    docs = await db.collection<MongoArticle>('articles').aggregate<MongoArticle>(pipeline).toArray()
  } else {
    // Fallback: same section, same source, recent
    const filter: Filter<MongoArticle> = {
      _id: { $ne: articleId },
      status: { $ne: 'rejected' },
      moderationStatus: { $ne: 'removed' },
      feedSourceId: article.feedSourceId,
    }
    if (article.articleSection) filter.articleSection = article.articleSection
    docs = await db.collection<MongoArticle>('articles')
      .find(filter)
      .sort({ datePublished: -1 })
      .limit(limit)
      .toArray()
  }

  const sourceIds = [...new Set(docs.map(d => d.feedSourceId))]
  const sources = await db.collection<MongoFeedSource>('feedSources')
    .find({ _id: { $in: sourceIds } })
    .toArray()
  const sourceMap = new Map(sources.map(s => [s._id, s]))

  return docs.map(d => toArticle(d, sourceMap.get(d.feedSourceId)))
}

export async function getNewsByteArticles(limit = 10): Promise<Article[]> {
  const db = await getDb()
  const docs = await db.collection<MongoArticle>('articles')
    .find({
      status: { $ne: 'rejected' },
      moderationStatus: { $ne: 'removed' },
      wordCount: { $lte: 300 },
      // An image in any of the shapes the pipeline has used (see resolveImageUrl)
      $or: [
        { 'image.0': { $exists: true } },
        { 'image.url': { $exists: true, $ne: null } },
        { image: { $type: 'string', $ne: '' } },
        { imageUrl: { $exists: true, $ne: null } },
        { image_url: { $exists: true, $ne: null } },
      ],
    } as Filter<MongoArticle>)
    .sort({ datePublished: -1 })
    .limit(limit)
    .toArray()

  const sourceIds = [...new Set(docs.map(d => d.feedSourceId))]
  const sources = await db.collection<MongoFeedSource>('feedSources')
    .find({ _id: { $in: sourceIds } })
    .toArray()
  const sourceMap = new Map(sources.map(s => [s._id, s]))

  return docs.map(d => toArticle(d, sourceMap.get(d.feedSourceId)))
}

export async function searchArticles(
  query: string,
  limit = 20,
  filters: { category?: string; countryCode?: string } = {},
): Promise<Article[]> {
  const db = await getDb()

  const searchFilters: unknown[] = [{ in: { path: 'status', value: ['approved', 'published'] } }]
  if (filters.category) {
    searchFilters.push({ equals: { path: 'articleSection', value: filters.category } })
  }

  // Atlas Full-Text Search — English stemming + fuzzy matching
  const pipeline = [
    {
      $search: {
        index: 'articles_text_search',
        compound: {
          must: [
            {
              text: {
                query,
                path: ['headline', 'description', 'articleBodyProcessed'],
                fuzzy: { maxEdits: 1, prefixLength: 3 },
              },
            },
          ],
          filter: searchFilters,
        },
      },
    },
    { $addFields: { searchScore: { $meta: 'searchScore' } } },
    { $project: { embedding: 0 } },
    { $limit: limit },
  ]

  let docs: MongoArticle[]
  try {
    docs = await db.collection<MongoArticle>('articles').aggregate<MongoArticle>(pipeline).toArray()
  } catch {
    // Fall back to regex if Atlas Search index is not yet active
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    docs = await db
      .collection<MongoArticle>('articles')
      .find({
        status: { $in: ['approved', 'published'] },
        $or: [{ headline: re }, { description: re }],
      })
      .sort({ datePublished: -1 })
      .limit(limit)
      .toArray()
  }

  // Post-filter by country if requested
  let filtered = docs
  if (filters.countryCode && docs.length) {
    const sourceIds = [...new Set(docs.map(d => d.feedSourceId))]
    const countrySources = await db
      .collection<MongoFeedSource>('feedSources')
      .find({ _id: { $in: sourceIds }, countryCode: filters.countryCode })
      .toArray()
    const allowed = new Set(countrySources.map(s => s._id))
    filtered = docs.filter(d => allowed.has(d.feedSourceId))
  }

  const sourceIds = [...new Set(filtered.map(d => d.feedSourceId))]
  const sources = await db
    .collection<MongoFeedSource>('feedSources')
    .find({ _id: { $in: sourceIds } })
    .toArray()
  const sourceMap = new Map(sources.map(s => [s._id, s]))

  return filtered.map(d => toArticle(d, sourceMap.get(d.feedSourceId)))
}

export async function getSavedArticles(sessionId: string): Promise<{ articles: Article[] }> {
  const db = await getDb()
  const saves = await db.collection('articleSaves')
    .find({ sessionId })
    .sort({ createdAt: -1 })
    .toArray()

  if (saves.length === 0) return { articles: [] }

  const articleIds = saves.map(s => s.articleId as string)
  const docs = await db.collection<MongoArticle>('articles')
    .find({ _id: { $in: articleIds } })
    .toArray()

  const sourceIds = [...new Set(docs.map(d => d.feedSourceId))]
  const sources = await db.collection<MongoFeedSource>('feedSources')
    .find({ _id: { $in: sourceIds } })
    .toArray()
  const sourceMap = new Map(sources.map(s => [s._id, s]))

  const articleMap = new Map(docs.map(d => [d._id, toArticle(d, sourceMap.get(d.feedSourceId))]))
  return { articles: articleIds.map(id => articleMap.get(id)).filter(Boolean) as Article[] }
}
