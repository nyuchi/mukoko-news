/**
 * Server-side MongoDB feed source queries.
 * Import only in Server Components, Route Handlers, or Server Actions.
 */

import { getDb, QUERY_MAX_TIME_MS } from './client'
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
  org?: { isVerified?: boolean; publisherTier?: string; url?: string; name?: string } | null
}

export async function getSources(): Promise<Array<{
  id: string
  name: string
  url: string
  /**
   * The publishing organisation's own homepage, from its own record.
   *
   * Derived per request, never stored: the organisation record is the single
   * instance of publisher identity. All 537 organisations carry an http(s) `url`
   * (measured 2026-09-10), which is what makes a favicon resolvable for every
   * source rather than the 38 a hardcoded table covered.
   */
  site_url?: string
  country_id: string
  article_count: number
  last_fetched_at?: string
  error_count?: number
  last_error?: string
  /** True when the org behind this source is a verified publisher (Tier-2). */
  verified?: boolean
  publisher_tier?: string
  /**
   * The NEWSROOM (masthead) this feed delivers, from `mediaOrganizationId`.
   *
   *   publisher / entity   the publishing house      `entity.entities`
   *     └── newsroom       the masthead              `news.newsMediaOrganizations`
   *           └── source   the feed endpoint         THIS ROW
   *
   * One masthead can be delivered by several feeds, which is why the directory
   * can group by it: 587 sources across 537 newsrooms, and the multi-feed cases
   * are real (Daily Maverick's `/dmrss/` and `/rss`, KTN News and The Standard
   * on `standardmedia.co.ke`). Absent when the organisation did not resolve —
   * absent means unknown, and such a row is grouped under no newsroom rather
   * than under a made-up one.
   */
  newsroom_id?: string
  newsroom_name?: string
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
          pipeline: [{ $project: { isVerified: 1, publisherTier: 1, url: 1, name: 1 } }],
        },
      },
      { $set: { org: { $first: '$org' } } },
    ])
    .toArray()

  return docs.map((d) => ({
    id: d._id,
    name: d.name,
    url: d.feedUrl,
    site_url: d.org?.url || undefined,
    country_id: d.countryCode,
    article_count: d.articleCount,
    last_fetched_at: d.lastFetchedAt?.toISOString(),
    error_count: d.consecutiveFailures,
    last_error: d.lastFetchError || undefined,
    verified: d.org?.isVerified === true,
    publisher_tier: d.org?.publisherTier || undefined,
    newsroom_id: d.mediaOrganizationId || undefined,
    newsroom_name: d.org?.name || undefined,
  }))
}

const TRENDING_AUTHOR_WINDOW_DAYS = 30
const TRENDING_AUTHOR_SCAN_CAP = 3000

export async function getTrendingAuthors(limit = 5): Promise<{
  trending_authors: Array<{ id: string; name: string; article_count: number }>
}> {
  limit = clampInt(limit, 1, MAX_LIMIT, 5)
  const db = await getDb()
  // `author` is a Schema.org sub-document ({ '@type': 'Person', name }) written
  // by both ingestion paths — NOT a string. Grouping on `$author` grouped by the
  // whole object and then rendered it through String(), so every entry showed as
  // "[object Object]"; group on the name instead. The `$type: 'string'` match
  // also skips any legacy document that stored a bare string or a malformed
  // sub-document, rather than letting it become a bogus author row.
  // Bounded like every other derived aggregation in this app: unbounded, the
  // $match/$group is a COLLSCAN of the whole 1.47 GB collection, and the FETCH of
  // fat article documents (not the scan) is what makes that slow enough to blow
  // the socket timeout. A 30-day window rides `status_1_datePublished_-1` as a
  // range seek and is the right question anyway — "who is filing now", not "who
  // ever filed".
  const since = new Date(Date.now() - TRENDING_AUTHOR_WINDOW_DAYS * 86400_000)
  const results = await db.collection('articles').aggregate<{ _id: string; count: number }>([
    {
      $match: {
        datePublished: { $gte: since },
        status: { $ne: 'rejected' },
        moderationStatus: { $ne: 'removed' },
        'author.name': { $type: 'string', $ne: '' },
      },
    },
    { $sort: { datePublished: -1 } },
    { $limit: TRENDING_AUTHOR_SCAN_CAP },
    { $project: { 'author.name': 1 } },
    { $group: { _id: '$author.name', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ], { maxTimeMS: QUERY_MAX_TIME_MS }).toArray()

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
    today_articles: number
  }
}> {
  const db = await getDb()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [total_articles, active_sources, today_articles] = await Promise.all([
    // `estimatedDocumentCount` reads collection metadata — O(1). The exact
    // version (`countDocuments({status: {$in: [...]}})`) cannot use an index
    // here: `status` is the SECOND key of `status_1_datePublished_-1`, so it is
    // not a usable prefix, and the query degrades to a FETCH of all 1.47 GB. That
    // is what was making this very endpoint answer `database: unavailable`
    // (2026-09-10) — the health probe was the outage.
    //
    // The number this returns counts every article rather than only the
    // approved/published ones. For a corpus-size figure that is the more honest
    // answer anyway; it is not worth a full-collection scan to shave the
    // handful that are rejected.
    db.collection('articles').estimatedDocumentCount(),
    db.collection('feedSources').countDocuments({ isActive: true }, { maxTimeMS: QUERY_MAX_TIME_MS }),
    // Index-backed: `datePublished` IS the prefix, so this is a range seek.
    db.collection('articles').countDocuments(
      {
        status: { $in: ['approved', 'published'] },
        datePublished: { $gte: today },
      },
      { maxTimeMS: QUERY_MAX_TIME_MS }
    ),
  ])

  // `categories` is deliberately absent: it used to count `news.categories`,
  // which is deprecated and empty, so the figure the search page rendered was
  // always 0. The real count comes from the derived category list, which the
  // action layer already holds cached — composing it there costs nothing, while
  // deriving it here would put a 1.4s aggregation behind /api/health.
  return { database: { total_articles, active_sources, today_articles } }
}

/**
 * How far back the author index looks, and how many authors it returns.
 *
 * Bounded for the same reason `getTrendingAuthors` is: unbounded, the group is
 * a COLLSCAN of a 1.47 GB collection and the FETCH of fat article documents is
 * what blows the socket timeout. A 30-day window rides
 * `status_1_datePublished_-1` as a range seek.
 *
 * The cap is on AUTHORS returned, not on articles scanned, so the ranking is
 * over the whole window rather than over an arbitrary first slice — a scan cap
 * would silently rank "whoever filed most recently" and present it as "most
 * prolific".
 */
const AUTHOR_INDEX_WINDOW_DAYS = 30
const AUTHOR_INDEX_LIMIT = 400

export interface SourceAuthor {
  name: string
  articleCount: number
  /** Feed-source ids this byline has filed to in the window. */
  sourceIds: string[]
}

/**
 * The bylines filing right now, and which feeds they file to.
 *
 * Powers the author filter on the source directory: pick a journalist, see the
 * sources they actually publish through. That is a question the corpus can
 * answer and a hardcoded list never could — measured live, 3,092 distinct
 * bylines in 30 days, 88 of them filing to more than one source.
 *
 * `author.name` is a Schema.org sub-document, NOT a bare string. Grouping on
 * `$author` groups by the whole object and renders every row as
 * "[object Object]"; that bug is on record in `getTrendingAuthors` and this
 * read must not repeat it, hence the `author.name` path and the `$type` guard
 * that skips any legacy document storing a bare string.
 *
 * Fail-soft: an unreachable cluster yields an empty index and the filter
 * renders as unavailable rather than as "this author writes for nothing".
 */
export async function getSourceAuthors(limit = AUTHOR_INDEX_LIMIT): Promise<SourceAuthor[]> {
  limit = clampInt(limit, 1, 2000, AUTHOR_INDEX_LIMIT)
  try {
    const db = await getDb()
    const since = new Date(Date.now() - AUTHOR_INDEX_WINDOW_DAYS * 86400_000)
    const rows = await db
      .collection('articles')
      .aggregate<{ _id: string; articleCount: number; sourceIds: string[] }>([
        {
          $match: {
            datePublished: { $gte: since },
            status: { $ne: 'rejected' },
            moderationStatus: { $ne: 'removed' },
            'author.name': { $type: 'string', $ne: '' },
            feedSourceId: { $type: 'string', $ne: '' },
          },
        },
        {
          $group: {
            _id: '$author.name',
            articleCount: { $sum: 1 },
            sourceIds: { $addToSet: '$feedSourceId' },
          },
        },
        { $sort: { articleCount: -1, _id: 1 } },
        { $limit: limit },
      ])
      .toArray()

    return rows.map((r) => ({
      name: String(r._id).trim(),
      articleCount: r.articleCount,
      sourceIds: r.sourceIds,
    }))
  } catch (error) {
    console.error('[sources.getSourceAuthors]', error)
    return []
  }
}
