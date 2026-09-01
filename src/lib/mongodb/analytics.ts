/**
 * Server-side MongoDB aggregations for the /analytics query console.
 *
 * READ-ONLY. `/insights` answers "what does the corpus look like?" with a fixed
 * set of headline figures. This module answers "what does the corpus say about
 * X, in country Y, over window Z?" — the deep dive `/insights` links into.
 *
 * Same resilience contract as `insights.ts`: every export is wrapped so a
 * failure (Atlas unreachable, a bad pipeline, a missing Search index) returns
 * an empty-but-typed result rather than throwing to the page.
 *
 * Honesty rules this module follows, because the underlying corpus is uneven:
 *   - Metrics computed over an AI-enriched subset (sentiment, quality,
 *     keywords, entities) always carry an explicit `coverage` percentage.
 *   - `byAuthor` reports how few articles actually carry a byline rather than
 *     silently ranking a 0.5% sample as if it were the newsroom.
 *   - Source concentration is reported as a real share, so a country served by
 *     one outlet reads as one outlet, not as "covered".
 *
 * Import only in Server Components, Route Handlers, or Server Actions.
 */

import type { Filter, Document } from 'mongodb'
import { getDb } from './client'
import { clampInt, MAX_LIMIT } from '@/lib/safety'
import { COUNTRIES } from '@/lib/constants'

// Mirrors the article read layer (articles.ts) and insights.ts: hide
// rejected/removed documents so the console reflects the live catalogue.
const BASE_MATCH = {
  status: { $ne: 'rejected' },
  moderationStatus: { $ne: 'removed' },
} as const

const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c.name])
)

/** Default analysis window, in days, when the caller does not pick one. */
export const DEFAULT_WINDOW_DAYS = 30
/** Widest window a single query may span. */
export const MAX_WINDOW_DAYS = 365

/**
 * Feed-supplied `engagement.tags` are polluted with RSS boilerplate — section
 * names ("News", "Featured"), and the publication's own country. Ranking them
 * produces a "topics" list where the top entries carry no information. The
 * console ranks `aiKeywords` instead and still drops these, because the
 * enrichment model echoes them back from the article text.
 */
const TOPIC_STOPWORDS = new Set<string>([
  'news',
  'featured',
  'national',
  'general',
  'latest',
  'headlines',
  'top stories',
  'breaking',
  'breaking news',
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

/** Country names/codes, lowercased — excluded from topic ranking (they are a facet, not a topic). */
const COUNTRY_TOKENS = new Set<string>(
  COUNTRIES.flatMap((c) => [c.name.toLowerCase(), c.code.toLowerCase()])
)

function isMeaningfulTopic(raw: string): boolean {
  const t = raw.trim().toLowerCase()
  if (t.length < 2 || t.length > 60) return false
  if (TOPIC_STOPWORDS.has(t)) return false
  if (COUNTRY_TOKENS.has(t)) return false
  return true
}

/** Round to `dp` decimal places, returning 0 for null/NaN/undefined. */
function round(value: unknown, dp = 2): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Percentage of `part` in `whole`, 1dp, 0 when `whole` is 0. */
function share(part: number, whole: number): number {
  return whole > 0 ? round((part / whole) * 100, 1) : 0
}

/** YYYY-MM-DD (UTC) for a Date. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

export type SentimentValue = 'positive' | 'neutral' | 'negative' | 'mixed'

export interface CorpusQueryParams {
  /** Free-text topic term, e.g. "accidents". Empty/absent = no text filter. */
  q?: string
  /** ISO 3166-1 alpha-2 codes. Empty = all countries. */
  countries?: string[]
  /** Category slugs matched against `engagement.interest_categories`. */
  categories?: string[]
  /** feedSource ids. */
  sources?: string[]
  /** Inclusive UTC day bounds, YYYY-MM-DD. Defaults to the last 30 days. */
  from?: string
  to?: string
  /** Restrict to articles the enrichment model scored with these sentiments. */
  sentiments?: SentimentValue[]
  /** Minimum `qualityScore` (0–1). */
  minQuality?: number
  /** Sample articles returned alongside the aggregates. */
  sampleLimit?: number
}

/** The parameters actually applied, echoed back so the UI can render honest captions. */
export interface NormalizedQuery {
  q: string | null
  countries: string[]
  categories: string[]
  sources: string[]
  from: string
  to: string
  sentiments: SentimentValue[]
  minQuality: number | null
  days: number
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface SeriesPoint {
  date: string
  count: number
}

export interface SourceRow {
  sourceId: string
  name: string
  country: string | null
  count: number
  share: number
}

export interface CountryRow {
  code: string
  name: string
  count: number
  share: number
  /** Distinct sources contributing to this country within the query window. */
  sources: number
}

export interface TermRow {
  term: string
  count: number
}

export interface EntityRow {
  name: string
  type: string
  count: number
}

export interface AuthorRow {
  name: string
  count: number
}

export interface SampleArticle {
  id: string
  headline: string
  description: string | null
  source: string
  country: string | null
  publishedAt: string | null
  url: string
  sentiment: string | null
  qualityScore: number | null
}

export interface CoveredMetric {
  /** Percentage of matched articles the metric could actually be computed over. */
  coverage: number
  /** Number of matched articles carrying the underlying field. */
  covered: number
}

export interface SentimentSummary extends CoveredMetric {
  positive: number
  neutral: number
  negative: number
  mixed: number
}

export interface QualitySummary extends CoveredMetric {
  avg: number
}

export interface CorpusQueryResult {
  query: NormalizedQuery
  /** Total articles matching the query. */
  total: number
  /** True when the text term ran through Atlas Search rather than the regex fallback. */
  usedSearchIndex: boolean
  series: SeriesPoint[]
  bySource: SourceRow[]
  byCountry: CountryRow[]
  byCategory: TermRow[]
  byKeyword: TermRow[]
  byEntity: EntityRow[]
  byAuthor: AuthorRow[]
  /** Articles carrying a byline, and what share of the match that is. */
  bylineCoverage: CoveredMetric
  sentiment: SentimentSummary
  quality: QualitySummary
  sample: SampleArticle[]
  generatedAt: string
}

function emptyResult(query: NormalizedQuery): CorpusQueryResult {
  return {
    query,
    total: 0,
    usedSearchIndex: false,
    series: [],
    bySource: [],
    byCountry: [],
    byCategory: [],
    byKeyword: [],
    byEntity: [],
    byAuthor: [],
    bylineCoverage: { coverage: 0, covered: 0 },
    sentiment: { positive: 0, neutral: 0, negative: 0, mixed: 0, coverage: 0, covered: 0 },
    quality: { avg: 0, coverage: 0, covered: 0 },
    sample: [],
    generatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Parameter normalisation
// ---------------------------------------------------------------------------

/** Parse a YYYY-MM-DD day into a UTC Date, or null when malformed. */
function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function normalizeQuery(params: CorpusQueryParams): NormalizedQuery {
  const q = params.q?.trim() ?? ''

  const today = new Date()
  const toDate = parseDay(params.to) ?? today
  const requestedFrom = parseDay(params.from)
  const defaultFrom = new Date(toDate.getTime() - (DEFAULT_WINDOW_DAYS - 1) * 86_400_000)
  let fromDate = requestedFrom ?? defaultFrom

  // A reversed range is a UI slip, not an error — swap rather than return nothing.
  if (fromDate > toDate) fromDate = defaultFrom

  // Cap the span so one query can never scan an unbounded slice of the corpus.
  const spanDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1
  if (spanDays > MAX_WINDOW_DAYS) {
    fromDate = new Date(toDate.getTime() - (MAX_WINDOW_DAYS - 1) * 86_400_000)
  }

  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1

  const countries = [...new Set((params.countries ?? []).map((c) => c.trim().toUpperCase()))]
    .filter((c) => /^[A-Z]{2}$/.test(c))
    .slice(0, 20)

  const categories = [...new Set((params.categories ?? []).map((c) => c.trim().toLowerCase()))]
    .filter((c) => /^[a-z0-9-]{1,50}$/.test(c))
    .slice(0, 20)

  const sources = [...new Set((params.sources ?? []).map((s) => s.trim()))]
    .filter((s) => s.length > 0 && s.length <= 128)
    .slice(0, 20)

  const allowed: SentimentValue[] = ['positive', 'neutral', 'negative', 'mixed']
  const sentiments = [...new Set(params.sentiments ?? [])].filter((s): s is SentimentValue =>
    allowed.includes(s)
  )

  const minQuality =
    typeof params.minQuality === 'number' && Number.isFinite(params.minQuality)
      ? Math.min(1, Math.max(0, params.minQuality))
      : null

  return {
    q: q.length > 0 ? q.slice(0, 200) : null,
    countries,
    categories,
    sources,
    from: isoDay(fromDate),
    to: isoDay(toDate),
    sentiments,
    minQuality,
    days,
  }
}

/** Build the structured `$match` shared by every stage of the query. */
function buildMatch(query: NormalizedQuery): Filter<Document> {
  const filter: Filter<Document> = { ...BASE_MATCH }

  // `to` is an inclusive calendar day, so the upper bound is the start of the next one.
  filter.datePublished = {
    $gte: new Date(`${query.from}T00:00:00.000Z`),
    $lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000),
  }

  // `countryCode` is written by both collectors at ingestion, so country needs
  // no feedSources join here (unlike the article list path, which predates it).
  if (query.countries.length) filter.countryCode = { $in: query.countries }
  if (query.sources.length) filter.feedSourceId = { $in: query.sources }
  if (query.categories.length) {
    filter['engagement.interest_categories'] = {
      $in: query.categories.map((c) => new RegExp(`^${escapeRegex(c)}$`, 'i')),
    }
  }
  if (query.sentiments.length) filter.aiSentiment = { $in: query.sentiments }
  if (query.minQuality !== null) filter.qualityScore = { $gte: query.minQuality }

  return filter
}

/**
 * The one aggregation that produces every panel.
 *
 * `$facet` keeps this to a single round trip over the matched set — the
 * breakdowns all read the same documents, so computing them separately would
 * re-scan the corpus once per panel.
 */
function buildFacets(sampleLimit: number): Document {
  return {
    total: [{ $count: 'n' }],

    series: [
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$datePublished' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ],

    bySource: [
      { $group: { _id: '$feedSourceId', count: { $sum: 1 }, country: { $first: '$countryCode' } } },
      { $sort: { count: -1 } },
      { $limit: 25 },
    ],

    byCountry: [
      {
        $group: {
          _id: '$countryCode',
          count: { $sum: 1 },
          sources: { $addToSet: '$feedSourceId' },
        },
      },
      { $project: { count: 1, sources: { $size: '$sources' } } },
      { $sort: { count: -1 } },
    ],

    byCategory: [
      { $unwind: '$engagement.interest_categories' },
      { $group: { _id: '$engagement.interest_categories', count: { $sum: 1 } } },
      { $match: { _id: { $type: 'string', $ne: '' } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ],

    // Ranked from `aiKeywords` (enrichment output), NOT `engagement.tags`:
    // tags carry the raw RSS <category> terms, whose top entries are feed
    // boilerplate. Over-fetched so the stopword filter can drop entries
    // without leaving the list short.
    byKeyword: [
      { $match: { aiKeywords: { $type: 'array' } } },
      { $unwind: '$aiKeywords' },
      { $group: { _id: '$aiKeywords', count: { $sum: 1 } } },
      { $match: { _id: { $type: 'string', $ne: '' } } },
      { $sort: { count: -1 } },
      { $limit: 80 },
    ],

    byEntity: [
      { $match: { aiNamedEntities: { $type: 'array' } } },
      { $unwind: '$aiNamedEntities' },
      {
        $group: {
          _id: { name: '$aiNamedEntities.name', type: '$aiNamedEntities.type' },
          count: { $sum: 1 },
        },
      },
      { $match: { '_id.name': { $type: 'string', $ne: '' } } },
      { $sort: { count: -1 } },
      { $limit: 40 },
    ],

    // `author` is a Schema.org sub-document ({@type, name}) on the newsdata
    // path and absent on the RSS path, so this ranks names and the caller
    // reports coverage next to it.
    byAuthor: [
      { $match: { 'author.name': { $type: 'string', $ne: '' } } },
      { $group: { _id: '$author.name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ],

    bylineCovered: [{ $match: { 'author.name': { $type: 'string', $ne: '' } } }, { $count: 'n' }],

    sentiment: [
      { $match: { aiSentiment: { $type: 'string' } } },
      { $group: { _id: '$aiSentiment', count: { $sum: 1 } } },
    ],

    quality: [
      { $match: { qualityScore: { $type: 'number', $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$qualityScore' }, n: { $sum: 1 } } },
    ],

    sample: [
      { $sort: { datePublished: -1 } },
      { $limit: sampleLimit },
      {
        $project: {
          headline: 1,
          description: 1,
          feedSourceId: 1,
          countryCode: 1,
          datePublished: 1,
          externalUrl: 1,
          aiSentiment: 1,
          qualityScore: 1,
        },
      },
    ],
  }
}

interface FacetOutput {
  total?: Array<{ n: number }>
  series?: Array<{ _id: string; count: number }>
  bySource?: Array<{ _id: string; count: number; country: string | null }>
  byCountry?: Array<{ _id: string; count: number; sources: number }>
  byCategory?: Array<{ _id: string; count: number }>
  byKeyword?: Array<{ _id: string; count: number }>
  byEntity?: Array<{ _id: { name: string; type: string }; count: number }>
  byAuthor?: Array<{ _id: string; count: number }>
  bylineCovered?: Array<{ n: number }>
  sentiment?: Array<{ _id: string; count: number }>
  quality?: Array<{ avg: number; n: number }>
  sample?: Array<{
    _id: string
    headline?: string
    description?: string
    feedSourceId?: string
    countryCode?: string
    datePublished?: Date
    externalUrl?: string
    aiSentiment?: string
    qualityScore?: number
  }>
}

/** Zero-fill the daily series so a quiet day reads as 0, not as a gap. */
function fillSeries(rows: Array<{ _id: string; count: number }>, from: string, to: string): SeriesPoint[] {
  const counts = new Map(rows.map((r) => [r._id, r.count]))
  const out: SeriesPoint[] = []
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = isoDay(new Date(t))
    out.push({ date: day, count: counts.get(day) ?? 0 })
  }
  return out
}

/**
 * Run a corpus query and return every panel the console renders.
 *
 * When `q` is set the pipeline leads with Atlas Search (`articles_text_search`,
 * the same index the site search uses) and falls back to a headline/description
 * regex if the index is unavailable — the caller can tell which ran from
 * `usedSearchIndex`, so the UI never implies stemmed relevance it didn't get.
 */
export async function runCorpusQuery(params: CorpusQueryParams): Promise<CorpusQueryResult> {
  const query = normalizeQuery(params)
  const sampleLimit = clampInt(params.sampleLimit, 1, MAX_LIMIT, 20)

  try {
    const db = await getDb()
    const col = db.collection('articles')
    const match = buildMatch(query)
    const facets = buildFacets(sampleLimit)

    let rows: FacetOutput[] = []
    let usedSearchIndex = false

    if (query.q) {
      try {
        rows = await col
          .aggregate<FacetOutput>([
            {
              $search: {
                index: 'articles_text_search',
                text: {
                  query: query.q,
                  path: ['headline', 'description', 'articleBodyProcessed'],
                  fuzzy: { maxEdits: 1, prefixLength: 3 },
                },
              },
            },
            { $match: match },
            { $facet: facets },
          ])
          .toArray()
        usedSearchIndex = true
      } catch (searchError) {
        // Index missing or still building — degrade to regex rather than 500.
        console.warn('[analytics.runCorpusQuery] Atlas Search unavailable, using regex', searchError)
        const re = new RegExp(escapeRegex(query.q), 'i')
        rows = await col
          .aggregate<FacetOutput>([
            { $match: { ...match, $or: [{ headline: re }, { description: re }] } },
            { $facet: facets },
          ])
          .toArray()
      }
    } else {
      rows = await col.aggregate<FacetOutput>([{ $match: match }, { $facet: facets }]).toArray()
    }

    const f = rows[0] ?? {}
    const total = f.total?.[0]?.n ?? 0
    if (total === 0) return { ...emptyResult(query), usedSearchIndex }

    // Resolve source ids → display names in one round trip.
    const sourceIds = [
      ...new Set([
        ...(f.bySource ?? []).map((r) => r._id),
        ...(f.sample ?? []).map((d) => d.feedSourceId).filter((s): s is string => !!s),
      ]),
    ]
    const sourceDocs = sourceIds.length
      ? await db
          .collection<{ _id: string; name?: string; countryCode?: string }>('feedSources')
          .find({ _id: { $in: sourceIds } }, { projection: { name: 1, countryCode: 1 } })
          .toArray()
      : []
    const sourceNames = new Map(sourceDocs.map((s) => [s._id, s.name ?? s._id]))

    const sentimentCounts = new Map((f.sentiment ?? []).map((r) => [r._id, r.count]))
    const sentimentCovered = [...sentimentCounts.values()].reduce((a, b) => a + b, 0)
    const bylineCovered = f.bylineCovered?.[0]?.n ?? 0
    const qualityRow = f.quality?.[0]

    return {
      query,
      total,
      usedSearchIndex,
      series: fillSeries(f.series ?? [], query.from, query.to),
      bySource: (f.bySource ?? []).map((r) => ({
        sourceId: r._id,
        name: sourceNames.get(r._id) ?? r._id,
        country: r.country ?? null,
        count: r.count,
        share: share(r.count, total),
      })),
      byCountry: (f.byCountry ?? [])
        .filter((r) => typeof r._id === 'string' && r._id.length > 0)
        .map((r) => ({
          code: r._id,
          name: COUNTRY_NAMES[r._id] ?? r._id,
          count: r.count,
          share: share(r.count, total),
          sources: r.sources,
        })),
      byCategory: (f.byCategory ?? []).map((r) => ({ term: r._id, count: r.count })),
      byKeyword: (f.byKeyword ?? [])
        .filter((r) => isMeaningfulTopic(r._id))
        .slice(0, 25)
        .map((r) => ({ term: r._id, count: r.count })),
      byEntity: (f.byEntity ?? [])
        .filter((r) => r._id?.name && isMeaningfulTopic(r._id.name))
        .slice(0, 25)
        .map((r) => ({ name: r._id.name, type: r._id.type ?? 'UNKNOWN', count: r.count })),
      byAuthor: (f.byAuthor ?? []).map((r) => ({ name: r._id, count: r.count })),
      bylineCoverage: { covered: bylineCovered, coverage: share(bylineCovered, total) },
      sentiment: {
        positive: sentimentCounts.get('positive') ?? 0,
        neutral: sentimentCounts.get('neutral') ?? 0,
        negative: sentimentCounts.get('negative') ?? 0,
        mixed: sentimentCounts.get('mixed') ?? 0,
        covered: sentimentCovered,
        coverage: share(sentimentCovered, total),
      },
      quality: {
        avg: round(qualityRow?.avg ?? 0, 3),
        covered: qualityRow?.n ?? 0,
        coverage: share(qualityRow?.n ?? 0, total),
      },
      sample: (f.sample ?? []).map((d) => ({
        id: d._id,
        headline: d.headline ?? '(untitled)',
        description: d.description?.trim() || null,
        source: sourceNames.get(d.feedSourceId ?? '') ?? d.feedSourceId ?? 'unknown',
        country: d.countryCode ?? null,
        publishedAt: d.datePublished ? new Date(d.datePublished).toISOString() : null,
        url: d.externalUrl ?? '',
        sentiment: d.aiSentiment ?? null,
        qualityScore: typeof d.qualityScore === 'number' ? round(d.qualityScore, 3) : null,
      })),
      generatedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.error('[analytics.runCorpusQuery]', error)
    return emptyResult(query)
  }
}

// ---------------------------------------------------------------------------
// Coverage concentration
// ---------------------------------------------------------------------------

export interface ConcentrationRow {
  code: string
  name: string
  articles: number
  sources: number
  /** Share of the country's articles coming from its single largest source. */
  topSourceShare: number
  topSourceName: string
  /**
   * Herfindahl–Hirschman index over source shares, 0–10000. Above 2500 is
   * "concentrated" by the standard reading; 10000 means one source is the
   * country's entire news feed as far as this platform is concerned.
   */
  hhi: number
}

export interface CoverageConcentration {
  days: number
  from: string
  to: string
  countries: ConcentrationRow[]
  /** African countries in `COUNTRIES` with no article at all in the window. */
  uncovered: Array<{ code: string; name: string }>
  /** Countries whose coverage comes from a single source. */
  singleSourceCount: number
}

const EMPTY_CONCENTRATION = (days: number): CoverageConcentration => {
  const to = new Date()
  const from = new Date(to.getTime() - (days - 1) * 86_400_000)
  return {
    days,
    from: isoDay(from),
    to: isoDay(to),
    countries: [],
    uncovered: [],
    singleSourceCount: 0,
  }
}

/**
 * How concentrated each country's coverage is — the metric behind "we only show
 * users one newspaper per country".
 *
 * This is the honest counterweight to a country article-count bar chart: a
 * country can look well covered on volume while every story comes from a single
 * outlet, which is an editorial risk, not coverage.
 */
export async function getCoverageConcentration({
  days = DEFAULT_WINDOW_DAYS,
}: { days?: number } = {}): Promise<CoverageConcentration> {
  const windowDays = clampInt(days, 1, MAX_WINDOW_DAYS, DEFAULT_WINDOW_DAYS)
  try {
    const db = await getDb()
    const to = new Date()
    const from = new Date(to.getTime() - (windowDays - 1) * 86_400_000)

    const rows = await db
      .collection('articles')
      .aggregate<{
        _id: string
        articles: number
        sources: Array<{ sourceId: string; n: number }>
      }>([
        {
          $match: {
            ...BASE_MATCH,
            datePublished: { $gte: new Date(`${isoDay(from)}T00:00:00.000Z`) },
            countryCode: { $type: 'string' },
          },
        },
        { $group: { _id: { country: '$countryCode', source: '$feedSourceId' }, n: { $sum: 1 } } },
        {
          $group: {
            _id: '$_id.country',
            articles: { $sum: '$n' },
            sources: { $push: { sourceId: '$_id.source', n: '$n' } },
          },
        },
        { $sort: { articles: -1 } },
      ])
      .toArray()

    const allSourceIds = [...new Set(rows.flatMap((r) => r.sources.map((s) => s.sourceId)))]
    const sourceDocs = allSourceIds.length
      ? await db
          .collection<{ _id: string; name?: string }>('feedSources')
          .find({ _id: { $in: allSourceIds } }, { projection: { name: 1 } })
          .toArray()
      : []
    const sourceNames = new Map(sourceDocs.map((s) => [s._id, s.name ?? s._id]))

    const countries: ConcentrationRow[] = rows.map((r) => {
      const sorted = [...r.sources].sort((a, b) => b.n - a.n)
      const top = sorted[0]
      const hhi = sorted.reduce((acc, s) => acc + ((s.n / r.articles) * 100) ** 2, 0)
      return {
        code: r._id,
        name: COUNTRY_NAMES[r._id] ?? r._id,
        articles: r.articles,
        sources: sorted.length,
        topSourceShare: share(top?.n ?? 0, r.articles),
        topSourceName: sourceNames.get(top?.sourceId ?? '') ?? top?.sourceId ?? '—',
        hhi: Math.round(hhi),
      }
    })

    const covered = new Set(countries.map((c) => c.code))
    const uncovered = COUNTRIES.filter((c) => !covered.has(c.code)).map((c) => ({
      code: c.code,
      name: c.name,
    }))

    return {
      days: windowDays,
      from: isoDay(from),
      to: isoDay(to),
      countries,
      uncovered,
      singleSourceCount: countries.filter((c) => c.sources === 1).length,
    }
  } catch (error) {
    console.error('[analytics.getCoverageConcentration]', error)
    return EMPTY_CONCENTRATION(windowDays)
  }
}

// ---------------------------------------------------------------------------
// Filter options (populate the console's selects from live data)
// ---------------------------------------------------------------------------

export interface QueryFacets {
  countries: Array<{ code: string; name: string; articles: number }>
  categories: Array<{ slug: string; articles: number }>
  sources: Array<{ id: string; name: string; country: string | null; articles: number }>
}

const EMPTY_FACETS: QueryFacets = { countries: [], categories: [], sources: [] }

/**
 * The filter values worth offering — drawn from what the corpus actually
 * contains in the recent window, so the console never offers a country or
 * category that would return nothing.
 */
export async function getQueryFacets({
  days = 90,
}: { days?: number } = {}): Promise<QueryFacets> {
  const windowDays = clampInt(days, 1, MAX_WINDOW_DAYS, 90)
  try {
    const db = await getDb()
    const since = new Date(Date.now() - windowDays * 86_400_000)
    const match = { ...BASE_MATCH, datePublished: { $gte: since } }

    const [rows] = await db
      .collection('articles')
      .aggregate<{
        countries: Array<{ _id: string; n: number }>
        categories: Array<{ _id: string; n: number }>
        sources: Array<{ _id: string; n: number; country: string | null }>
      }>([
        { $match: match },
        {
          $facet: {
            countries: [
              { $match: { countryCode: { $type: 'string' } } },
              { $group: { _id: '$countryCode', n: { $sum: 1 } } },
              { $sort: { n: -1 } },
            ],
            categories: [
              { $unwind: '$engagement.interest_categories' },
              { $group: { _id: '$engagement.interest_categories', n: { $sum: 1 } } },
              { $match: { _id: { $type: 'string', $ne: '' } } },
              { $sort: { n: -1 } },
              { $limit: 40 },
            ],
            sources: [
              {
                $group: {
                  _id: '$feedSourceId',
                  n: { $sum: 1 },
                  country: { $first: '$countryCode' },
                },
              },
              { $sort: { n: -1 } },
              { $limit: 200 },
            ],
          },
        },
      ])
      .toArray()

    if (!rows) return EMPTY_FACETS

    const sourceIds = rows.sources.map((s) => s._id)
    const sourceDocs = sourceIds.length
      ? await db
          .collection<{ _id: string; name?: string }>('feedSources')
          .find({ _id: { $in: sourceIds } }, { projection: { name: 1 } })
          .toArray()
      : []
    const sourceNames = new Map(sourceDocs.map((s) => [s._id, s.name ?? s._id]))

    return {
      countries: rows.countries.map((c) => ({
        code: c._id,
        name: COUNTRY_NAMES[c._id] ?? c._id,
        articles: c.n,
      })),
      categories: rows.categories.map((c) => ({ slug: c._id, articles: c.n })),
      sources: rows.sources.map((s) => ({
        id: s._id,
        name: sourceNames.get(s._id) ?? s._id,
        country: s.country ?? null,
        articles: s.n,
      })),
    }
  } catch (error) {
    console.error('[analytics.getQueryFacets]', error)
    return EMPTY_FACETS
  }
}
