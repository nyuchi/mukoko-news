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
const BASE_MATCH = {
  status: { $ne: 'rejected' },
  moderationStatus: { $ne: 'removed' },
} as const

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
        ])
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
        ])
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
      ])
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
      ])
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
 */
export async function getCountryCoverage(): Promise<CountryCoverage> {
  try {
    const db = await getDb()
    const rows = await db
      .collection('articles')
      .aggregate<{ _id: string; count: number }>([
        { $match: BASE_MATCH },
        { $group: { _id: '$countryCode', count: { $sum: 1 } } },
        { $match: { _id: { $type: 'string', $ne: '' } } },
        { $sort: { count: -1 } },
        { $limit: 60 },
      ])
      .toArray()

    const total = rows.reduce((s, r) => s + r.count, 0)
    if (total === 0) return EMPTY_COUNTRY
    return {
      total,
      countries: rows.map((r) => {
        const code = String(r._id).trim().toUpperCase()
        return {
          code,
          name: COUNTRY_NAMES[code] || code,
          count: r.count,
          share: round((r.count / total) * 100, 1),
        }
      }),
    }
  } catch (error) {
    console.error('[insights.getCountryCoverage]', error)
    return EMPTY_COUNTRY
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
        ])
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
  totalArticles: number
  sources: number
  organizations: number
  countries: number
  /** Percentage of articles with aiProcessed=true. */
  aiEnrichedPct: number
  /** Average qualityScore (0..1) over scored articles. */
  avgQualityScore: number
  earliest: string | null
  latest: string | null
}

const EMPTY_SUMMARY: CorpusSummary = {
  totalArticles: 0,
  sources: 0,
  organizations: 0,
  countries: 0,
  aiEnrichedPct: 0,
  avgQualityScore: 0,
  earliest: null,
  latest: null,
}

/** Headline totals across the corpus for the stat-tile row. */
export async function getCorpusSummary(): Promise<CorpusSummary> {
  try {
    const db = await getDb()
    const col = db.collection('articles')

    const [facet, sources, organizations, countries] = await Promise.all([
      col
        .aggregate<{
          totalArticles: Array<{ n: number }>
          aiEnriched: Array<{ n: number }>
          quality: Array<{ avg: number | null }>
          range: Array<{ earliest: Date | null; latest: Date | null }>
        }>([
          { $match: BASE_MATCH },
          {
            $facet: {
              totalArticles: [{ $count: 'n' }],
              aiEnriched: [{ $match: { aiProcessed: true } }, { $count: 'n' }],
              quality: [
                { $match: { qualityScore: { $type: 'number' } } },
                { $group: { _id: null, avg: { $avg: '$qualityScore' } } },
                { $project: { _id: 0, avg: 1 } },
              ],
              range: [
                { $match: { datePublished: { $type: 'date' } } },
                {
                  $group: {
                    _id: null,
                    earliest: { $min: '$datePublished' },
                    latest: { $max: '$datePublished' },
                  },
                },
                { $project: { _id: 0, earliest: 1, latest: 1 } },
              ],
            },
          },
        ])
        .toArray(),
      db.collection('feedSources').countDocuments({}),
      db.collection('newsMediaOrganizations').countDocuments({}),
      col.distinct('countryCode', BASE_MATCH),
    ])

    const f = facet[0]
    const totalArticles = f?.totalArticles?.[0]?.n ?? 0
    const aiEnriched = f?.aiEnriched?.[0]?.n ?? 0
    const range = f?.range?.[0]
    const distinctCountries = (countries as unknown[]).filter(
      (c): c is string => typeof c === 'string' && c.trim().length > 0
    )

    return {
      totalArticles,
      sources,
      organizations,
      countries: distinctCountries.length,
      aiEnrichedPct: totalArticles > 0 ? round((aiEnriched / totalArticles) * 100, 1) : 0,
      avgQualityScore: round(f?.quality?.[0]?.avg, 3),
      earliest: range?.earliest ? new Date(range.earliest).toISOString() : null,
      latest: range?.latest ? new Date(range.latest).toISOString() : null,
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
 * Trending `engagement.tags` over the last 7 days, ranked by article count.
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
        { $match: { ...BASE_MATCH, datePublished: { $gte: since } } },
        { $unwind: '$engagement.tags' },
        { $group: { _id: '$engagement.tags', count: { $sum: 1 } } },
        { $match: { _id: { $type: 'string', $ne: '' } } },
        { $sort: { count: -1 } },
        { $limit: max },
      ])
      .toArray()

    return rows.map((r) => ({ tag: String(r._id).trim(), count: r.count }))
  } catch (error) {
    console.error('[insights.getTopTopics]', error)
    return []
  }
}
