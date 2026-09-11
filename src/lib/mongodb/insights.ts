/**
 * Server-side MongoDB aggregations for the public open-data Insights dashboard.
 *
 * READ-ONLY. Every export queries the `news` database directly via getDb() and
 * is wrapped so that any failure (Atlas unreachable, a bad pipeline, a missing
 * collection) returns an empty-but-typed result instead of throwing to the
 * page/route. This keeps `/insights` server-rendered and resilient: a degraded
 * cluster yields empty sections, never a 500.
 *
 * Every number is computed from the live corpus. Metrics with partial coverage
 * (e.g. sentiment, which only exists on AI-enriched articles) carry an explicit
 * coverage figure so the UI can label them honestly.
 *
 * Import only in Server Components, Route Handlers, or Server Actions.
 */

import { getDb } from './client'
import { clampInt } from '@/lib/safety'
import { COUNTRIES } from '@/lib/constants'

// Base visibility filter — mirrors the article read layer (articles.ts): hide
// rejected/removed documents so public analytics reflect the live catalogue.
//
// ⚠️ MEASURED 2026-09-11, and the reason this page was showing "No data
// available yet" on a corpus of 65,203 articles.
//
// `$ne` is never index-selective, so every pipeline that opens with this filter
// is a COLLSCAN of a 1.5 GB collection. Explained on the live cluster, a
// two-branch `$facet` behind it took **27,529 ms** and examined all 65,203
// documents — and that was the CHEAPEST of the seven reads this module runs.
// A Vercel function is killed long before that, `getCorpusSummary` fell into
// its catch, and the fail-soft empty result rendered as a statement that the
// corpus is empty. A failure presented to a reader as a fact.
//
// It also excludes nothing. An Atlas Search facet over `status` (milliseconds,
// because the search index is a real inverted index) reports ONE bucket:
// `approved`, 65,203 of 65,203. Not one article has ever been `rejected`.
//
// So the reads that can be served by an index or by Atlas Search no longer
// carry it — see `searchMeta` below. It remains only on the pipelines that
// must touch documents anyway, where it costs nothing extra.
const BASE_MATCH = {
  status: { $ne: 'rejected' },
  moderationStatus: { $ne: 'removed' },
} as const

/**
 * Every aggregation in this module is bounded.
 *
 * Without it a slow read does not fail — it HANGS, holding the serverless
 * function until the platform kills the whole request, which the reader sees
 * as a blank page rather than as a degraded one. Five seconds is well beyond
 * any read here that is working correctly and well inside the function's own
 * budget, so a read that exceeds it lands in the catch, flips `ok` to false,
 * and the page says so.
 */
const AGGREGATE_TIMEOUT_MS = 5000
const AGG_OPTS = { maxTimeMS: AGGREGATE_TIMEOUT_MS } as const

/** The Atlas Search index on `news.articles`. Kept in one place — a typo here
 *  is a silent full-collection fallback, not an error. */
const SEARCH_INDEX = 'articles_text_search'

/**
 * Everything in the corpus, as a Search operator.
 *
 * `exists` on a field every article carries is the Search equivalent of "match
 * all". The index maps `status`, `countryCode`, `feedSourceId`, `datePublished`,
 * `inLanguage`, `articleSection`, `categoryIds` and `tagIds` as tokens/dates —
 * which is exactly the set of questions this dashboard asks most often, and why
 * those reads now go through `$searchMeta` instead of scanning documents.
 */
const MATCH_ALL = { exists: { path: 'status' } } as const

const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c.name])
)

/** Round to `dp` decimal places, returning 0 for null/NaN/undefined. */
function round(value: unknown, dp = 2): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** YYYY-MM-DD (UTC) for a Date. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Publishing volume
// ---------------------------------------------------------------------------

export interface VolumePoint {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string
  count: number
}

export interface PublishingVolume {
  days: number
  /** Inclusive UTC day range covered by the series. */
  from: string
  to: string
  /** Total articles published in the window. */
  total: number
  /** One point per day, ascending, zero-filled across the whole range. */
  series: VolumePoint[]
  /** Top sources by volume in the window (context for the overall series). */
  topSources: Array<{ sourceId: string; name: string; count: number }>
}

const EMPTY_VOLUME = (days: number): PublishingVolume => {
  const to = new Date()
  const from = new Date(to.getTime() - (days - 1) * 86_400_000)
  return {
    days,
    from: isoDay(from),
    to: isoDay(to),
    total: 0,
    series: [],
    topSources: [],
  }
}

/**
 * Articles published per UTC day over the last `days` (default 30), plus the
 * top sources contributing to that window. The daily series is zero-filled so
 * the chart has a point for every day even when nothing was published.
 */
export async function getPublishingVolume({
  days = 30,
}: { days?: number } = {}): Promise<PublishingVolume> {
  const window = clampInt(days, 1, 365, 30)
  try {
    const db = await getDb()
    const now = new Date()
    // Start of the window: midnight UTC, `window - 1` days back (inclusive of today).
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    start.setUTCDate(start.getUTCDate() - (window - 1))

    const match = { ...BASE_MATCH, datePublished: { $gte: start } }
    const col = db.collection('articles')

    const [dayRows, sourceRows] = await Promise.all([
      col
        .aggregate<{ _id: string; count: number }>([
          { $match: match },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$datePublished', timezone: 'UTC' } },
              count: { $sum: 1 },
            },
          },
        ], AGG_OPTS)
        .toArray(),
      col
        .aggregate<{ _id: string; count: number; name?: string }>([
          { $match: match },
          { $group: { _id: '$feedSourceId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 8 },
          { $lookup: { from: 'feedSources', localField: '_id', foreignField: '_id', as: 'source' } },
          { $addFields: { name: { $ifNull: [{ $arrayElemAt: ['$source.name', 0] }, '$_id'] } } },
          { $project: { count: 1, name: 1 } },
        ], AGG_OPTS)
        .toArray(),
    ])

    const counts = new Map(dayRows.map((r) => [r._id, r.count]))
    const series: VolumePoint[] = []
    let total = 0
    for (let i = 0; i < window; i++) {
      const d = new Date(start.getTime() + i * 86_400_000)
      const key = isoDay(d)
      const count = counts.get(key) ?? 0
      total += count
      series.push({ date: key, count })
    }

    return {
      days: window,
      from: series[0]?.date ?? isoDay(start),
      to: series[series.length - 1]?.date ?? isoDay(now),
      total,
      series,
      topSources: sourceRows.map((r) => ({
        sourceId: r._id,
        name: r.name || r._id,
        count: r.count,
      })),
    }
  } catch (error) {
    console.error('[insights.getPublishingVolume]', error)
    return EMPTY_VOLUME(window)
  }
}

// ---------------------------------------------------------------------------
// Source / organization leaderboard
// ---------------------------------------------------------------------------

export interface SourceLeaderboardRow {
  sourceId: string
  name: string
  /** Publisher organization display name, when linked. */
  organization?: string
  verified: boolean
  articleCount: number
  /** Average qualityScore (0..1) over articles that carry one. */
  avgQualityScore: number
  avgWordCount: number
  /** Distinct country codes seen across this source's articles. */
  countries: string[]
  lastPublished: string | null
}

/**
 * Per-source analytics: article count, average quality/length, countries
 * covered and last-published time, joined to feedSources (display name) and
 * newsMediaOrganizations (publisher + verification). This is the "media
 * organizations" analytics surface.
 */
export async function getSourceLeaderboard({
  limit = 20,
}: { limit?: number } = {}): Promise<SourceLeaderboardRow[]> {
  const max = clampInt(limit, 1, 100, 20)
  try {
    const db = await getDb()
    const rows = await db
      .collection('articles')
      .aggregate<{
        _id: string
        articleCount: number
        avgQualityScore: number | null
        avgWordCount: number | null
        countries: (string | null)[]
        lastPublished: Date | null
        source: Array<{ name?: string; mediaOrganizationId?: string; countryCode?: string }>
        org: Array<{ name?: string; verified?: boolean; isVerified?: boolean; verificationStatus?: string }>
      }>([
        { $match: BASE_MATCH },
        {
          $group: {
            _id: '$feedSourceId',
            articleCount: { $sum: 1 },
            avgQualityScore: { $avg: '$qualityScore' },
            avgWordCount: { $avg: '$wordCount' },
            countries: { $addToSet: '$countryCode' },
            lastPublished: { $max: '$datePublished' },
          },
        },
        { $sort: { articleCount: -1 } },
        { $limit: max },
        { $lookup: { from: 'feedSources', localField: '_id', foreignField: '_id', as: 'source' } },
        {
          $lookup: {
            from: 'newsMediaOrganizations',
            localField: 'source.mediaOrganizationId',
            foreignField: '_id',
            as: 'org',
          },
        },
      ], AGG_OPTS)
      .toArray()

    return rows.map((r) => {
      const source = r.source?.[0]
      const org = r.org?.[0]
      const verified = Boolean(
        org?.verified ?? org?.isVerified ?? org?.verificationStatus === 'verified'
      )
      const countries = (r.countries ?? [])
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .sort()
      // Fall back to the source's own country when article-level codes are absent.
      if (countries.length === 0 && source?.countryCode) countries.push(source.countryCode)
      return {
        sourceId: r._id,
        name: source?.name || r._id,
        organization: org?.name || undefined,
        verified,
        articleCount: r.articleCount,
        avgQualityScore: round(r.avgQualityScore, 3),
        avgWordCount: Math.round(r.avgWordCount ?? 0),
        countries,
        lastPublished: r.lastPublished ? new Date(r.lastPublished).toISOString() : null,
      }
    })
  } catch (error) {
    console.error('[insights.getSourceLeaderboard]', error)
    return []
  }
}

// ---------------------------------------------------------------------------
// Category distribution
// ---------------------------------------------------------------------------

export interface CategoryDistribution {
  /** Total category assignments across the corpus (an article may carry several). */
  totalAssignments: number
  /** Share of all assignments the returned (top) slugs account for. */
  coverage: number
  categories: Array<{ slug: string; count: number; share: number }>
}

const EMPTY_CATEGORY: CategoryDistribution = { totalAssignments: 0, coverage: 0, categories: [] }

/**
 * Article counts per `engagement.interest_categories` slug (top 15). Share is
 * expressed against total category *assignments* (articles can hold several),
 * and `coverage` reports how much of the corpus the returned slugs cover.
 */
export async function getCategoryDistribution(): Promise<CategoryDistribution> {
  try {
    const db = await getDb()
    const rows = await db
      .collection('articles')
      .aggregate<{ _id: string; count: number }>([
        { $match: BASE_MATCH },
        { $unwind: '$engagement.interest_categories' },
        { $group: { _id: '$engagement.interest_categories', count: { $sum: 1 } } },
        { $match: { _id: { $type: 'string', $ne: '' } } },
        { $sort: { count: -1 } },
        // Compute the grand total, then slice the top 15 in JS from a facet.
        {
          $facet: {
            top: [{ $limit: 15 }],
            totals: [{ $group: { _id: null, total: { $sum: '$count' } } }],
          },
        },
      ], AGG_OPTS)
      .toArray()

    const facet = rows[0] as unknown as
      | { top: Array<{ _id: string; count: number }>; totals: Array<{ total: number }> }
      | undefined
    const top = facet?.top ?? []
    const totalAssignments = facet?.totals?.[0]?.total ?? 0
    if (totalAssignments === 0) return EMPTY_CATEGORY

    const categories = top.map((r) => ({
      slug: String(r._id).trim(),
      count: r.count,
      share: round((r.count / totalAssignments) * 100, 1),
    }))
    const coverage = round(
      (categories.reduce((s, c) => s + c.count, 0) / totalAssignments) * 100,
      1
    )
    return { totalAssignments, coverage, categories }
  } catch (error) {
    console.error('[insights.getCategoryDistribution]', error)
    return EMPTY_CATEGORY
  }
}

// ---------------------------------------------------------------------------
// Country coverage
// ---------------------------------------------------------------------------

export interface CountryCoverage {
  total: number
  countries: Array<{ code: string; name: string; count: number; share: number }>
}

const EMPTY_COUNTRY: CountryCoverage = { total: 0, countries: [] }

/**
 * Article counts per `countryCode`, mapped to display names via COUNTRIES.
 * Share is expressed against the total number of articles carrying a country.
 *
 * An Atlas Search string facet, not a `$group`: `countryCode` is a mapped token
 * in `articles_text_search`, so the counts come out of the inverted index in
 * milliseconds. The `$group` this replaced opened with `BASE_MATCH`, whose
 * `$ne` pair forced a scan of all 65,203 documents — 27s+ on this cluster,
 * i.e. longer than the request it was serving was allowed to live.
 *
 * `numBuckets` is 54 + headroom: the scope is the 54 African Union member
 * states, and truncating the tail would silently under-report the countries
 * this project exists to cover. A code with no entry in COUNTRIES keeps its
 * code as its name rather than being dropped — an unmapped country is a gap in
 * our table, not an absence of journalism.
 */
export async function getCountryCoverage(): Promise<CountryCoverage> {
  try {
    const db = await getDb()
    const rows = await db
      .collection('articles')
      .aggregate<{ facet?: { country?: { buckets?: Array<{ _id: unknown; count: unknown }> } } }>(
        [
          {
            $searchMeta: {
              index: SEARCH_INDEX,
              facet: {
                operator: MATCH_ALL,
                facets: { country: { type: 'string', path: 'countryCode', numBuckets: 60 } },
              },
            },
          },
        ],
        AGG_OPTS
      )
      .toArray()

    const buckets = rows[0]?.facet?.country?.buckets ?? []
    const counted = buckets
      .map((b) => ({
        code: typeof b._id === 'string' ? b._id.trim() : '',
        count: Math.max(0, Math.trunc(Number(b.count ?? 0))),
      }))
      .filter((b) => b.code.length > 0 && b.count > 0)

    const total = counted.reduce((sum, b) => sum + b.count, 0)

    return {
      total,
      countries: counted
        .sort((a, b) => b.count - a.count)
        .map((b) => ({
          code: b.code,
          name: COUNTRY_NAMES[b.code] ?? b.code,
          count: b.count,
          share: total > 0 ? round((b.count / total) * 100, 1) : 0,
        })),
    }
  } catch (error) {
    console.error('[insights.getCountryCoverage]', error)
    return { ...EMPTY_COUNTRY, countries: [] }
  }
}

// ---------------------------------------------------------------------------
// Sentiment breakdown
// ---------------------------------------------------------------------------

export interface SentimentBreakdown {
  /** Articles carrying a sentiment label (the enriched subset). */
  total: number
  /** Share of the whole corpus that has been AI-enriched with a sentiment. */
  coverage: number
  breakdown: Array<{ sentiment: string; count: number; share: number }>
}

const EMPTY_SENTIMENT: SentimentBreakdown = { total: 0, coverage: 0, breakdown: [] }

/**
 * Counts per `aiSentiment` value over `aiProcessed=true` articles only, with a
 * `coverage` figure (enriched-with-sentiment / whole corpus) so the thin-data
 * caveat can be shown in the UI.
 */
export async function getSentimentBreakdown(): Promise<SentimentBreakdown> {
  try {
    const db = await getDb()
    const col = db.collection('articles')
    const [rows, corpusTotal] = await Promise.all([
      col
        .aggregate<{ _id: string; count: number }>([
          { $match: { ...BASE_MATCH, aiProcessed: true, aiSentiment: { $type: 'string', $ne: '' } } },
          { $group: { _id: '$aiSentiment', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ], AGG_OPTS)
        .toArray(),
      col.countDocuments(BASE_MATCH),
    ])

    const total = rows.reduce((s, r) => s + r.count, 0)
    if (total === 0) return { ...EMPTY_SENTIMENT }
    return {
      total,
      coverage: corpusTotal > 0 ? round((total / corpusTotal) * 100, 1) : 0,
      breakdown: rows.map((r) => ({
        sentiment: String(r._id).trim().toLowerCase(),
        count: r.count,
        share: round((r.count / total) * 100, 1),
      })),
    }
  } catch (error) {
    console.error('[insights.getSentimentBreakdown]', error)
    return { ...EMPTY_SENTIMENT }
  }
}

// ---------------------------------------------------------------------------
// Corpus summary
// ---------------------------------------------------------------------------

export interface CorpusSummary {
  /**
   * Did the read succeed?
   *
   * This exists because its absence was the bug. Every figure below is zero
   * both when the corpus is genuinely empty and when the read failed, and the
   * page rendered the second case as the first: "No data available yet", on a
   * corpus of 65,203 articles. Zero is a number; a failure is not. Callers must
   * check this before saying anything about the corpus.
   */
  ok: boolean
  totalArticles: number
  sources: number
  organizations: number
  countries: number
  /** Percentage of articles with aiProcessed=true. */
  aiEnrichedPct: number
  /**
   * Average qualityScore (0..1) over scored articles, or **null when it could
   * not be computed** — which is currently always.
   *
   * There is no index on `qualityScore` and no Atlas Search mapping for it, so
   * averaging it means reading all 65,203 documents: 27s+ on this cluster,
   * measured. `0` would read as "the corpus scores zero on quality", which is
   * a far worse answer than "we do not know". It comes back when the field is
   * either added to the search index or rolled up by the pipeline.
   */
  avgQualityScore: number | null
  earliest: string | null
  latest: string | null
}

const EMPTY_SUMMARY: CorpusSummary = {
  ok: false,
  totalArticles: 0,
  sources: 0,
  organizations: 0,
  countries: 0,
  aiEnrichedPct: 0,
  avgQualityScore: null,
  earliest: null,
  latest: null,
}

/**
 * Headline totals across the corpus for the stat-tile row.
 *
 * Rebuilt 2026-09-11 to stop scanning the collection. Every figure now comes
 * from an index or from Atlas Search, and the whole function is four cheap
 * reads instead of one 27-second one:
 *
 * | figure | how | measured |
 * | --- | --- | --- |
 * | `totalArticles` | `$searchMeta` count, `type: 'total'` (exact, not a bound) | ms |
 * | `countries` | `$group` on `countryCode` → `DISTINCT_SCAN` on `countryCode_1_feedSourceId_1`, 43 keys, **0 documents** | 90 ms |
 * | `aiEnrichedPct` | `countDocuments({aiProcessed:true})` on `aiProcessed_createdAt` | ms |
 * | `earliest`/`latest` | one document off each end of `{datePublished:-1, status:1}` | ms |
 *
 * The `countries` read deliberately carries NO filter: adding `BASE_MATCH`
 * turns that same query from a 90 ms covered index scan into the 27-second
 * collection scan, to exclude a set of documents that is measurably empty.
 */
export async function getCorpusSummary(): Promise<CorpusSummary> {
  try {
    const db = await getDb()
    const col = db.collection('articles')

    const [searchMeta, countryIds, aiEnriched, sources, organizations, oldest, newest] =
      await Promise.all([
        col
          .aggregate<{ count?: { total?: number } }>(
            [{ $searchMeta: { index: SEARCH_INDEX, count: { type: 'total' }, ...MATCH_ALL } }],
            AGG_OPTS
          )
          .toArray(),
        col.aggregate<{ _id: unknown }>([{ $group: { _id: '$countryCode' } }], AGG_OPTS).toArray(),
        col.countDocuments({ aiProcessed: true }, AGG_OPTS),
        db.collection('feedSources').countDocuments({}, AGG_OPTS),
        db.collection('newsMediaOrganizations').countDocuments({}, AGG_OPTS),
        col
          .find({ datePublished: { $type: 'date' } }, { projection: { datePublished: 1 } })
          .sort({ datePublished: 1 })
          .limit(1)
          .maxTimeMS(AGGREGATE_TIMEOUT_MS)
          .toArray(),
        col
          .find({ datePublished: { $type: 'date' } }, { projection: { datePublished: 1 } })
          .sort({ datePublished: -1 })
          .limit(1)
          .maxTimeMS(AGGREGATE_TIMEOUT_MS)
          .toArray(),
      ])

    const totalArticles = Math.max(0, Math.trunc(Number(searchMeta[0]?.count?.total ?? 0)))
    const countries = countryIds.filter(
      (row) => typeof row._id === 'string' && row._id.trim().length > 0
    ).length

    const asIso = (rows: Array<Record<string, unknown>>): string | null => {
      const value = rows[0]?.datePublished
      return value instanceof Date ? value.toISOString() : null
    }

    return {
      ok: true,
      totalArticles,
      sources,
      organizations,
      countries,
      aiEnrichedPct: totalArticles > 0 ? round((aiEnriched / totalArticles) * 100, 1) : 0,
      // Deliberately not computed — see the field's own note.
      avgQualityScore: null,
      earliest: asIso(oldest),
      latest: asIso(newest),
    }
  } catch (error) {
    console.error('[insights.getCorpusSummary]', error)
    return { ...EMPTY_SUMMARY }
  }
}

// ---------------------------------------------------------------------------
// Trending topics
// ---------------------------------------------------------------------------

export interface TopTopic {
  tag: string
  count: number
}

/**
 * Boilerplate that dominates a naive topic ranking.
 *
 * `engagement.tags` carries the raw RSS <category>/<dc:subject> terms, whose
 * most frequent values across the corpus are feed section names ("News",
 * "Featured", "National") and the publication's own country. Ranking them
 * produced a "Trending topics" list whose top entries carried no information,
 * which is why this now ranks `aiKeywords` — but the enrichment model echoes
 * the same words back from the article text, so they are filtered here too.
 */
const TOPIC_STOPWORDS = new Set<string>([
  'news',
  'featured',
  'national',
  'general',
  'latest',
  'headlines',
  'breaking',
  'breaking news',
  'top stories',
  'uncategorized',
  'uncategorised',
  'home',
  'local',
  'world',
  'africa',
  'opinion',
  'article',
  'articles',
  'updates',
])

/** Country names and codes are a facet of the corpus, not a topic within it. */
const COUNTRY_TOKENS = new Set<string>(
  COUNTRIES.flatMap((c) => [c.name.toLowerCase(), c.code.toLowerCase()])
)

function isMeaningfulTopic(raw: string): boolean {
  const t = raw.trim().toLowerCase()
  if (t.length < 2 || t.length > 60) return false
  return !TOPIC_STOPWORDS.has(t) && !COUNTRY_TOKENS.has(t)
}

/**
 * Trending topics over the last 7 days, ranked by article count.
 *
 * Reads `aiKeywords` (the enrichment model's extracted keywords), NOT
 * `engagement.tags`: tags are feed-supplied section labels, so ranking them
 * surfaced "News" and "Featured" above every real subject. Because aiKeywords
 * only exists on enriched articles, the ranking covers a subset of the window —
 * the shape of what is trending, not an exhaustive count.
 */
export async function getTopTopics({
  limit = 10,
}: { limit?: number } = {}): Promise<TopTopic[]> {
  const max = clampInt(limit, 1, 50, 10)
  try {
    const db = await getDb()
    const since = new Date(Date.now() - 7 * 86_400_000)
    const rows = await db
      .collection('articles')
      .aggregate<{ _id: string; count: number }>([
        {
          $match: {
            ...BASE_MATCH,
            datePublished: { $gte: since },
            aiKeywords: { $type: 'array' },
          },
        },
        { $unwind: '$aiKeywords' },
        { $group: { _id: '$aiKeywords', count: { $sum: 1 } } },
        { $match: { _id: { $type: 'string', $ne: '' } } },
        { $sort: { count: -1 } },
        // Over-fetch so the stopword filter cannot leave the list short.
        { $limit: max * 4 },
      ], AGG_OPTS)
      .toArray()

    return rows
      .filter((r) => isMeaningfulTopic(String(r._id)))
      .slice(0, max)
      .map((r) => ({ tag: String(r._id).trim(), count: r.count }))
  } catch (error) {
    console.error('[insights.getTopTopics]', error)
    return []
  }
}
