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
  isApproved: boolean
  scrapedAt: Date
  createdAt: Date
  updatedAt: Date
  description?: string
  articleBody?: string
  articleBodyProcessed?: string
  articleSection?: string
  datePublished?: Date
  image?: Array<{ '@type'?: string; url?: string }>
  wordCount?: number
  readingTimeMinutes?: number
  categoryIds?: string[]
  tagIds?: string[]
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

function toArticle(doc: MongoArticle, source?: MongoFeedSource): Article {
  const imageUrl = doc.image?.[0]?.url || null
  return {
    id: doc._id,
    title: doc.headline,
    description: doc.description,
    content: doc.articleBodyProcessed || doc.articleBody,
    source: source?.name || doc.feedSourceId,
    source_id: doc.feedSourceId,
    slug: doc.slug,
    category: doc.articleSection || undefined,
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
  countries?: string[]
  sort?: 'latest' | 'trending' | 'popular'
} = {}): Promise<{ articles: Article[]; total: number }> {
  const db = await getDb()
  const { limit = 20, page = 1, category, countries, sort = 'latest' } = params

  const filter: Filter<MongoArticle> = {
    status: { $in: ['approved', 'published'] },
  }
  if (category) filter.articleSection = category
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
          filter: { status: { $in: ['approved', 'published'] } },
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
      status: { $in: ['approved', 'published'] },
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
      status: { $in: ['approved', 'published'] },
      wordCount: { $lte: 300 },
      'image.0': { $exists: true },
    })
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
