/**
 * Server-side MongoDB article queries.
 * Maps MongoDB v3.1 schema (camelCase) → Article type used by components.
 * Import only in Server Components, Route Handlers, or Server Actions.
 */

import type { Collection, Filter } from 'mongodb'
import { getDb, QUERY_MAX_TIME_MS } from './client'
import { stripHtml } from '@/lib/utils'
import { clampInt, MAX_LIMIT, MAX_PAGE } from '@/lib/safety'
import { getPublisherOrganization, type PublisherOrganization } from './organizations'
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
  articleBodyMarkdown?: string
  articleSection?: string
  datePublished?: Date
  // Schema.org sub-document, NOT a string — both ingestion paths write
  // `{ '@type': 'Person', name }` (see sources.ts / analytics.ts, which already
  // read it this way). It was never declared here, so `toArticle` never mapped
  // it and `Article.author` was undefined for every article in the corpus.
  author?: { '@type'?: string; name?: string }
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
  /**
   * The publisher's own site and feed endpoint. Measured 2026-09-10: `feedUrl`
   * is an http(s) URL on 587 of 587 sources, `sourceUrl` on 479. Both are
   * already in every document these reads fetch (the feed-source lookups are
   * unprojected), so carrying them costs no extra IO.
   */
  feedUrl?: string
  sourceUrl?: string
}

/**
 * The publisher's own website for a feed source, or undefined.
 *
 * `sourceUrl` is the site; `feedUrl` is the RSS endpoint on that same site, so
 * its host is the publisher's either way. Only the host is consumed downstream
 * (`@/lib/publisher-icon`), which is why the feed URL is an acceptable second
 * choice rather than a guess.
 */
function resolveSourceSiteUrl(source?: MongoFeedSource): string | undefined {
  const candidates = [source?.sourceUrl, source?.feedUrl]
  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (trimmed && /^https?:\/\//i.test(trimmed)) return trimmed
  }
  return undefined
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
  // Fall back to `articleSection` ONLY when it carries real signal. The collectors
  // hardcode it to "general" at ingestion, so an un-enriched article would otherwise
  // render a misleading "general" badge (the "everything is "general"" symptom).
  // Genuinely-classified "general" comes from `interest_categories` above and is kept.
  const section = doc.articleSection?.trim()
  if (section && section.toLowerCase() !== 'general') return section
  return undefined
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

/**
 * Fields a LIST read must never pull.
 *
 * Mukoko's readers are on African mobile networks where data is metered and
 * expensive, so every byte in a feed response is a byte someone pays for — and
 * these are the biggest bytes in the collection. `embedding` is 1024 floats of
 * BGE-M3 output that only vector search reads; the three body renditions are the
 * full article text, which no card renders (`article.content` is consumed on the
 * detail page and in its JSON-LD, nowhere else — grep before widening this).
 *
 * Excluding them cuts a 20-article feed response from hundreds of KB to a few,
 * and cuts the server-side FETCH proportionally: the fetch of fat documents, not
 * the index scan, is what makes these queries slow (measured: 3,000 documents =
 * 1.4s, 20,000 = 50s, on an IXSCAN costing 2.2s of that).
 *
 * The single-article reads (`getArticleById`, `getArticleBySlug`) deliberately do
 * NOT use this — that is the one page that needs the body.
 */
const LIST_PROJECTION = {
  embedding: 0,
  articleBody: 0,
  articleBodyProcessed: 0,
  articleBodyMarkdown: 0,
} as const

function toArticle(
  doc: MongoArticle,
  source?: MongoFeedSource,
  opts: { fullContent?: boolean; organization?: PublisherOrganization } = {}
): Article {
  const imageUrl = resolveImageUrl(doc)
  return {
    id: doc._id,
    title: doc.headline,
    description: doc.description,
    // Both body renditions are detail-page-only (`fullContent`). Kept out of list
    // responses (feed/search/related) so 20× full article bodies don't bloat the
    // payload; cards render title/description only. The plain `content` used to
    // ship on every list item regardless — this comment described the intent while
    // the line above it did the opposite, which on a metered African mobile
    // connection is a real bill, not a rounding error. `LIST_PROJECTION` stops the
    // fields being read at all; this stops them being serialised if they ever are.
    content: opts.fullContent
      ? stripHtml(doc.articleBodyProcessed || doc.articleBody) || undefined
      : undefined,
    content_markdown: opts.fullContent ? doc.articleBodyMarkdown?.trim() || undefined : undefined,
    // The journalist's byline. The pipeline backfilled these onto `author.name`
    // in 2026-09; without this line none of that reached the page, the article
    // metadata, the NewsArticle JSON-LD or the markdown served to agents — all
    // of which silently fell back to attributing the piece to the outlet.
    author: typeof doc.author?.name === 'string' && doc.author.name.trim()
      ? doc.author.name.trim()
      : undefined,
    // The corpus is not monolingual (it carries francophone sources), and the
    // document records its own language. Falling back to undefined lets the
    // caller decide rather than asserting English.
    language: typeof doc.inLanguage === 'string' && doc.inLanguage.trim()
      ? doc.inLanguage.trim()
      : undefined,
    source: source?.name || doc.feedSourceId,
    source_id: doc.feedSourceId,
    // The publishing newsroom, RESOLVED — never stored. Only the reads that
    // actually emit a publisher pass it in (the single-article path); list reads
    // leave it undefined rather than pay a catalogue read per feed request, and
    // an undefined publisher degrades to the feed-source name downstream. It is
    // deliberately NOT derived from `source`: one masthead can hold several feed
    // sources under names that disagree, and collapsing the two is the bug this
    // field exists to fix.
    publisher: opts.organization,
    // The publisher's own site, resolved from the feed-source record on the same
    // read. Also derived, never stored — it feeds the source icon.
    source_url: resolveSourceSiteUrl(source),
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

/**
 * How many recent articles a `popular` read ranks over.
 *
 * `popular` does NOT sort in MongoDB. `{qualityScore: -1, datePublished: -1}` has
 * no index behind it, so it plans as COLLSCAN → blocking in-memory SORT, and
 * bounding it by date is not enough to save it: a 14-day window is ~32,000
 * documents and that query still did not finish inside 60s, because the sort has
 * to materialise every one of those fat documents first. (`LIST_PROJECTION` does
 * not help — FETCH reads the whole document and the projection is applied after.)
 *
 * Instead, take the most recent N by `datePublished` — a pure IXSCAN with a
 * LIMIT, measured at 880ms for 300 documents and no SORT stage at all — and rank
 * that pool by `qualityScore` in application code, where sorting 200 objects is
 * free.
 *
 * This is also what the rail actually means. "Top stories" is the best of what is
 * recent; the old query would happily surface a high-scoring article from weeks
 * ago over today's lead, which was a bug in the ranking as much as in the plan.
 */
const POPULAR_CANDIDATE_POOL = 200

/**
 * Ceiling on the pagination total, for the callers that explicitly ask for one.
 *
 * `countDocuments(filter)` with only `$ne` filters cannot use an index and cannot
 * be covered, so it COLLSCANs — on every feed request. That one call is what took
 * the site down on 2026-09-10.
 *
 * Capping it is not enough to make it routine: measured on the live cluster, even
 * stopping at 5,000 matches costs **9.4 seconds**, because the scan still has to
 * read 5,000 fat documents off disk to test two `$ne`s. So the count is now
 * opt-in (`withTotal`) and OFF by default. Nothing in the UI reads it — "is there
 * another page" is answered exactly and for free by fetching `limit + 1` — and a
 * number no one displays is not worth nine seconds of a reader's time.
 */
const TOTAL_COUNT_CAP = 5000

/** Opaque keyset cursor: the sort position of the last item a caller received. */
export interface ArticleCursor {
  publishedAt: string
  id: string
}

export function encodeArticleCursor(article: Article): string {
  return Buffer.from(`${article.published_at}|${article.id}`, 'utf8').toString('base64url')
}

export function decodeArticleCursor(raw: string | undefined | null): ArticleCursor | null {
  if (!raw || typeof raw !== 'string' || raw.length > 512) return null
  try {
    const [publishedAt, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
    const id = rest.join('|')
    if (!publishedAt || !id) return null
    if (Number.isNaN(Date.parse(publishedAt))) return null
    return { publishedAt, id }
  } catch {
    return null
  }
}

export async function getArticles(params: {
  limit?: number
  page?: number
  /**
   * Keyset position to read from, instead of `page`. This is the cheap path and
   * the one the feed uses.
   *
   * Offset paging costs more the further a reader scrolls — `skip(n)` walks and
   * discards n documents server-side, so page 20 pays for pages 1-19 again — and
   * it double-counts or skips articles when new ones arrive mid-scroll, which on
   * a news feed is constantly. A keyset cursor is O(1) per page regardless of
   * depth and is stable under insertion: it says "continue from this exact
   * position in the sort" rather than "discard the first n".
   *
   * `page` is kept for the numbered surfaces that still use it; the two are
   * mutually exclusive and `cursor` wins.
   */
  cursor?: string
  category?: string
  categories?: string[]
  countries?: string[]
  sort?: 'latest' | 'trending' | 'popular'
  /**
   * Compute a (capped) match count. Off by default because it costs ~9.4s — see
   * TOTAL_COUNT_CAP. Only pass this if you are going to render the number.
   */
  withTotal?: boolean
} = {}): Promise<{
  articles: Article[]
  /** Capped match count, or null when `withTotal` was not requested. */
  total: number | null
  nextCursor: string | null
  hasMore: boolean
}> {
  const db = await getDb()
  const { category, categories, countries, sort = 'latest' } = params
  // Defensive second layer: Server Actions clamp already, but never let an
  // unbounded limit/skip reach the driver from any other call path.
  const limit = clampInt(params.limit, 1, MAX_LIMIT, 20)
  const page = clampInt(params.page, 1, MAX_PAGE, 1)
  const cursor = decodeArticleCursor(params.cursor)

  const filter: Filter<MongoArticle> = {
    status: { $ne: 'rejected' },
    moderationStatus: { $ne: 'removed' },
  }
  // Filter on the AI-classified categories (`engagement.interest_categories`,
  // an array of slugs) — NOT the legacy `articleSection`, which the collectors
  // hardcode to "general", so filtering on it returned everything-or-nothing and
  // never matched a real category the nav surfaced. Case-insensitive so a nav
  // slug matches regardless of how enrichment cased it.
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (categories?.length) {
    filter['engagement.interest_categories'] = {
      $in: categories.map(c => new RegExp(`^${escapeRegex(c)}$`, 'i')),
    } as never
  } else if (category) {
    filter['engagement.interest_categories'] = new RegExp(`^${escapeRegex(category)}$`, 'i') as never
  }
  if (countries?.length) {
    const sources = await db.collection<MongoFeedSource>('feedSources')
      .find({ countryCode: { $in: countries } }, { projection: { _id: 1 } })
      .toArray()
    const sourceIds = sources.map(s => s._id)
    filter.feedSourceId = { $in: sourceIds }
  }

  const isPopular = sort !== 'latest'

  // Keyset: continue strictly after the caller's last position.
  //
  // The `_id` half is not ceremony. Ties on `datePublished` are common — measured
  // on the live corpus, 3,000 recent articles carry only 2,831 distinct
  // timestamps, so ~6% share one with another article. A bare `$lt` on the
  // timestamp would skip every same-timestamp sibling at each page boundary; the
  // second branch keeps them.
  if (cursor && !isPopular) {
    const at = new Date(cursor.publishedAt)
    filter.$or = [
      { datePublished: { $lt: at } },
      { datePublished: at, _id: { $lt: cursor.id } },
    ] as never
  }

  const col = db.collection<MongoArticle>('articles')

  // `popular`: read a recent pool on the index, rank it here. See
  // POPULAR_CANDIDATE_POOL for why this is not a MongoDB sort.
  if (isPopular) {
    const pool = await col
      .find(filter, { projection: LIST_PROJECTION })
      .sort({ datePublished: -1 })
      .limit(POPULAR_CANDIDATE_POOL)
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .toArray()

    pool.sort((a, b) => {
      const qa = typeof a.qualityScore === 'number' ? a.qualityScore : -1
      const qb = typeof b.qualityScore === 'number' ? b.qualityScore : -1
      if (qb !== qa) return qb - qa
      // Recency breaks a quality tie, matching the old sort's second key. An
      // un-enriched article (no qualityScore) ranks below every scored one
      // rather than being dropped — it is unranked, not bad.
      return (b.datePublished?.getTime() ?? 0) - (a.datePublished?.getTime() ?? 0)
    })

    const start = (page - 1) * limit
    const pageDocs = pool.slice(start, start + limit)
    const sourceIds = [...new Set(pageDocs.map(d => d.feedSourceId))]
    const sources = await db.collection<MongoFeedSource>('feedSources')
      .find({ _id: { $in: sourceIds } })
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .toArray()
    const sourceMap = new Map(sources.map(s => [s._id, s]))

    return {
      articles: pageDocs.map(d => toArticle(d, sourceMap.get(d.feedSourceId))),
      // The pool IS the result set for this rail, so its size is an exact total,
      // not a capped estimate — and it costs nothing, having already been read.
      total: pool.length,
      hasMore: start + limit < pool.length,
      // No keyset over an application-side ranking; `popular` pages by offset
      // within the pool. Emitting a cursor here would loop the client.
      nextCursor: null,
    }
  }

  // Sort on `datePublished` ALONE, never `{datePublished, _id}`.
  //
  // The tie-break belongs in the filter, not the sort. Adding `_id` to the sort
  // key looks more correct and is catastrophically slower: no index carries
  // `_id` within `datePublished` order, so the planner can no longer stream and
  // falls back to a blocking SORT over the whole `$lt` branch — i.e. most of the
  // collection. Measured: that variant did not finish inside 60s, while the
  // single-key sort plans as SORT_MERGE (two streaming index scans) at 22 keys
  // and 22 documents examined for the same page.
  const sortField = { datePublished: -1 }
  // A cursor read never skips: that is the whole point of it.
  const skip = cursor ? 0 : (page - 1) * limit

  // Fetch one more than asked for. Its presence answers "is there another page"
  // exactly, with no count at all — the cheap half of the TikTok-style feed.
  const docs = await col
    .find(filter, { projection: LIST_PROJECTION })
    .sort(sortField as never)
    .skip(skip)
    .limit(limit + 1)
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .toArray()

  const hasMore = docs.length > limit
  const pageDocs = hasMore ? docs.slice(0, limit) : docs

  // `null`, not a guess. A caller that did not ask for a total gets an explicit
  // "not computed" rather than a plausible-looking number (the page length, say)
  // that would silently be wrong wherever it was rendered.
  const total = params.withTotal
    ? await col.countDocuments(filter, { limit: TOTAL_COUNT_CAP, maxTimeMS: QUERY_MAX_TIME_MS })
    : null

  const sourceIds = [...new Set(pageDocs.map(d => d.feedSourceId))]
  const sources = await db.collection<MongoFeedSource>('feedSources')
    .find({ _id: { $in: sourceIds } })
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .toArray()
  const sourceMap = new Map(sources.map(s => [s._id, s]))

  const articles = pageDocs.map(d => toArticle(d, sourceMap.get(d.feedSourceId)))

  return {
    articles,
    total,
    hasMore,
    // Only `latest` reaches here (every other sort returned from the popular
    // branch above), and only `latest` has a keyset implementation — a cursor
    // emitted for an application-side ranking would send the caller back to page
    // one forever.
    nextCursor:
      hasMore && articles.length > 0 ? encodeArticleCursor(articles[articles.length - 1]) : null,
  }
}

/**
 * The single-article reads are the ONLY place a publisher is resolved.
 *
 * They are also the only place a full `NewsArticle` is emitted, which is the
 * one document that carries a `publisher`. Resolving it here costs a single
 * cached catalogue read (`getPublisherOrganization`, in-process, 60s) shared
 * across every article view, rather than a join per feed card on the hottest
 * path in the app. The feed-source lookup beside it is unchanged — the two
 * answer different questions and both are wanted: `source` is where the article
 * was fetched from, `publisher` is who published it.
 */
async function resolveArticleDetail(doc: MongoArticle): Promise<Article> {
  const db = await getDb()
  const [source, organization] = await Promise.all([
    db.collection<MongoFeedSource>('feedSources').findOne({ _id: doc.feedSourceId }),
    getPublisherOrganization(doc.mediaOrganizationId),
  ])
  return toArticle(doc, source || undefined, { fullContent: true, organization })
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const db = await getDb()
  const doc = await db.collection<MongoArticle>('articles').findOne({ slug })
  if (!doc) return null

  return resolveArticleDetail(doc)
}

export async function getArticleById(id: string): Promise<Article | null> {
  const db = await getDb()
  const doc = await db.collection<MongoArticle>('articles').findOne({ _id: id })
  if (!doc) return null

  return resolveArticleDetail(doc)
}

export async function getRelatedArticles(articleId: string, limit = 5): Promise<Article[]> {
  limit = clampInt(limit, 1, MAX_LIMIT, 5)
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
      { $project: LIST_PROJECTION },
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
      .find(filter, { projection: LIST_PROJECTION })
      .sort({ datePublished: -1 })
      .limit(limit)
      .maxTimeMS(QUERY_MAX_TIME_MS)
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
  limit = clampInt(limit, 1, MAX_LIMIT, 10)
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
    } as Filter<MongoArticle>, { projection: LIST_PROJECTION })
    .sort({ datePublished: -1 })
    .limit(limit)
    .maxTimeMS(QUERY_MAX_TIME_MS)
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
  limit = clampInt(limit, 1, MAX_LIMIT, 20)
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
    { $project: LIST_PROJECTION },
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
      }, { projection: LIST_PROJECTION })
      .sort({ datePublished: -1 })
      .limit(limit)
      .maxTimeMS(QUERY_MAX_TIME_MS)
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
    .find({ _id: { $in: articleIds } }, { projection: LIST_PROJECTION })
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .toArray()

  const sourceIds = [...new Set(docs.map(d => d.feedSourceId))]
  const sources = await db.collection<MongoFeedSource>('feedSources')
    .find({ _id: { $in: sourceIds } })
    .toArray()
  const sourceMap = new Map(sources.map(s => [s._id, s]))

  const articleMap = new Map(docs.map(d => [d._id, toArticle(d, sourceMap.get(d.feedSourceId))]))
  return { articles: articleIds.map(id => articleMap.get(id)).filter(Boolean) as Article[] }
}

// ── Topic timeline (developing-story surface) ────────────────────────────────

/**
 * Articles matching a topic slug across the enrichment surfaces — tag slugs
 * (string or object elements), AI-classified categories, and AI keywords —
 * within a recency window, newest first. Backs the /topic/[slug] timeline;
 * day-grouping happens in the component layer.
 */
export async function getTopicTimeline(
  slug: string,
  params: { days?: number; limit?: number } = {}
): Promise<{ articles: Article[]; total: number }> {
  const db = await getDb()
  const days = clampInt(params.days, 1, 90, 30)
  const limit = clampInt(params.limit, 1, MAX_LIMIT, 100)

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // A slug like "zimbabwe-elections" should also match the tag/keyword name
  // form "zimbabwe elections" regardless of how enrichment cased it.
  const slugRe = new RegExp(`^${esc(slug)}$`, 'i')
  const nameRe = new RegExp(`^${esc(slug.replace(/-/g, ' '))}$`, 'i')

  const since = new Date(Date.now() - days * 86_400_000)
  const filter: Filter<MongoArticle> = {
    status: { $ne: 'rejected' },
    moderationStatus: { $ne: 'removed' },
    datePublished: { $gte: since },
    $or: [
      // engagement.tags elements are plain slugs/names or {slug, name} objects
      { 'engagement.tags': { $in: [slugRe, nameRe] } },
      { 'engagement.tags.slug': slugRe },
      { 'engagement.tags.name': nameRe },
      { 'engagement.interest_categories': slugRe },
      { aiKeywords: { $in: [slugRe, nameRe] } },
    ] as never,
  }

  const col = db.collection<MongoArticle>('articles')
  const [docs, total] = await Promise.all([
    col
      .find(filter, { projection: LIST_PROJECTION })
      .sort({ datePublished: -1 })
      .limit(limit)
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .toArray(),
    col.countDocuments(filter, { limit: TOTAL_COUNT_CAP, maxTimeMS: QUERY_MAX_TIME_MS }),
  ])

  const sourceIds = [...new Set(docs.map(d => d.feedSourceId))]
  const sources = await db.collection<MongoFeedSource>('feedSources')
    .find({ _id: { $in: sourceIds } })
    .toArray()
  const sourceMap = new Map(sources.map(s => [s._id, s]))

  return { articles: docs.map(d => toArticle(d, sourceMap.get(d.feedSourceId))), total }
}
