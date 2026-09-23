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
import { getCountryTopicTokens } from './places'


/**
 * Every aggregation here is bounded.
 *
 * `news.articles` is 1.5 GB and the console's filters are arbitrary, so a query
 * can legitimately ask for something no index serves. Unbounded, that does not
 * fail — it HANGS, holding the serverless function until the platform kills the
 * request, which the reader sees as a blank page instead of a slow one. With a
 * ceiling the read lands in the fail-soft catch and the page can say so.
 *
 * Measured 2026-09-11: a two-branch `$facet` behind this module's `$ne`
 * visibility filter examined all 65,203 documents in **27.5 seconds** — longer
 * than the request it was serving was allowed to live.
 */
const ANALYTICS_TIMEOUT_MS = 8000
const AGG_OPTS = { maxTimeMS: ANALYTICS_TIMEOUT_MS } as const

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

/**
 * Is this keyword a real topic, or is it the corpus's own country axis?
 *
 * ⚠️ THE COUNTRY LIST IS NOT DEFINED HERE, DELIBERATELY. It is read from the
 * `places` domain — the platform SSOT for geography — via
 * `getCountryTopicTokens()`. An earlier revision of this file derived the set
 * from `COUNTRIES` in `src/lib/constants.ts` and then hand-added two spellings
 * to it, which made this the FOURTH country list in the app and the seventeenth
 * across the platform. Measured 2026-09-23, those copies already held five
 * different answers to "how many countries are there" (53, 54, 55, 21, 16), and
 * `/insights` and `/analytics` disagreed about Senegal on the same day.
 *
 * The tokens are passed IN rather than fetched here so this stays a pure,
 * synchronous predicate that a `.filter()` can call per row.
 */
function isMeaningfulTopic(raw: string, countryTokens: ReadonlySet<string>): boolean {
  const t = raw.trim().toLowerCase()
  if (t.length < 2 || t.length > 60) return false
  if (TOPIC_STOPWORDS.has(t)) return false
  // Fold here so the caller's set and the incoming term are compared on the
  // same footing; `getCountryTopicTokens` folds on the way in.
  const folded = t.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  if (countryTokens.has(folded)) return false
  return true
}

/**
 * The token set, memoised per isolate for `COUNTRY_TOKEN_TTL_MS`.
 *
 * Countries change on a timescale of years; re-reading `places` on every
 * analytics query would add a round trip to the platform's slowest page for a
 * list that is effectively static. A failed read falls back inside
 * `getCountryTopicTokens` rather than here, so this never caches a failure as
 * though it were an answer.
 */
const COUNTRY_TOKEN_TTL_MS = 10 * 60 * 1000
let countryTokenCache: { at: number; tokens: ReadonlySet<string> } | null = null

/**
 * Clear the memo.
 *
 * Exported ONLY for tests, and it exists because the memo is otherwise
 * invisible to them: the first suite to touch either read populates it for the
 * whole file, so a later test that stubs `places` differently silently gets the
 * earlier answer. That is not a test-harness quirk — it is the same staleness a
 * long-lived isolate would show, so it is worth being able to reproduce.
 */
export function __resetCountryTokenCache(): void {
  countryTokenCache = null
}

async function countryTokens(): Promise<ReadonlySet<string>> {
  const now = Date.now()
  if (countryTokenCache && now - countryTokenCache.at < COUNTRY_TOKEN_TTL_MS) {
    return countryTokenCache.tokens
  }
  const tokens = await getCountryTopicTokens()
  countryTokenCache = { at: now, tokens }
  return tokens
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
  /** True when the text term ran through Atlas Search. */
  usedSearchIndex: boolean
  /**
   * Whether `total` and the breakdowns were counted over the WHOLE match.
   *
   * True on every path but one: a text term combined with a category, sentiment
   * or quality filter has no single Search index that can express it (see
   * `chooseIndex`), so those figures come from the highest-scoring
   * `deepScanned` matches instead. The UI must say so — a sampled count
   * rendered as a corpus count is the failure this module is built to avoid.
   */
  exact: boolean
  /**
   * Documents actually read for the panels no Search mapping carries — named
   * entities, bylines, the quality average. Their `coverage` is a share of
   * THIS, not of `total`.
   */
  deepScanned: number
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
    exact: true,
    deepScanned: 0,
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
  let toDate = parseDay(params.to) ?? today
  const requestedFrom = parseDay(params.from)
  const defaultFrom = new Date(toDate.getTime() - (DEFAULT_WINDOW_DAYS - 1) * 86_400_000)
  let fromDate = requestedFrom ?? defaultFrom

  // A reversed range is a UI slip, not an error — swap rather than return
  // nothing. This used to reset to the default window instead, so a request for
  // Aug 1-15 silently returned Jul 3 - Aug 1: not the range asked for, and not
  // obviously wrong on screen either.
  if (fromDate > toDate) {
    const swapped = fromDate
    fromDate = toDate
    toDate = swapped
  }

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

/** Build the structured `$match` that is the QUERY'S TRUTH.
 *
 * Every filter the caller asked for, in MQL, with no regard for what an index
 * can serve. The deep pass below applies it verbatim, so a document that
 * reaches the sample list or an entity count has passed every filter. The
 * Search compound is a fast approximation OF this; where the two can diverge
 * (see `chooseIndex`) the result says so rather than quietly reporting the
 * looser one.
 */
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

// ---------------------------------------------------------------------------
// Atlas Search: the counting half
// ---------------------------------------------------------------------------

/**
 * Why this module no longer counts by reading documents.
 *
 * Measured on the live cluster 2026-09-14, the console answered NOTHING — every
 * query, including every suggested question, rendered the fail-soft empty
 * result. Both of its paths were past `ANALYTICS_TIMEOUT_MS`:
 *
 *   - No term. A bare `$count` over a default 30-day window took **18,971 ms**.
 *     The index scan was fine (42,062 keys, 975 ms); the cost was the FETCH —
 *     42,061 individual document seeks, 17,663 ms, taken purely to evaluate
 *     `moderationStatus`, which no index carries. At ~25 KB per document that
 *     is ~1 GB read to answer a single integer, and the eleven-branch `$facet`
 *     behind it read the same documents again.
 *
 *   - With a term. The user's own query, "accidents in Zimbabwe", took
 *     **10,321 ms**. `$search` ran with `"filter": []` — the date range sat in a
 *     `$match` AFTER it — so it scored all 67,532 indexed documents across 17
 *     segments and id-looked-up every hit before anything narrowed it. The
 *     `fuzzy` expansion made that worse for nothing, generating junk terms
 *     (`accio`, `accis`, `accèd`, and soft-hyphen `zim­babw`) that matched
 *     noise; it is gone.
 *
 * The replacement counts in the index instead. The same 30-day window through
 * `$searchMeta` returns the identical total — 42,061 — in milliseconds, and
 * `count: {type: 'total'}` makes it exact rather than the default lower bound.
 * This is the same move `insights.ts` made for the same reason on the same
 * collection; the console simply had not had it yet.
 */
const TEXT_PATHS = ['headline', 'description', 'articleBodyProcessed']

type SearchIndexName = 'articles_text_search' | 'articles_insights'

/**
 * How many matched documents the deep pass may read.
 *
 * Anything a facet can count is counted by a facet, exactly, over the whole
 * match. This bound applies only to the panels no Search mapping can serve —
 * named entities, bylines, and the quality AVERAGE (a facet counts documents
 * per value; it cannot average a field across them). The result carries
 * `deepScanned`, so a partial pass is captioned rather than presented as the
 * whole corpus.
 *
 * 2,000 documents is ~1 s against this collection, well inside the timeout.
 */
export const ENRICHMENT_SCAN_LIMIT = 2000

/**
 * Which Search index can express this query — or `null` when none can.
 *
 * The two indexes are deliberately disjoint and neither is a superset:
 * `articles_text_search` has the analyzed text but none of the enrichment
 * fields; `articles_insights` has every enrichment field but no text (that is
 * the point of it — no bodies, so a mapping change here can never take search
 * down). A query needing both at once therefore has no exact index, and rather
 * than silently dropping whichever filter does not fit, that case falls to the
 * deep pass and is reported as `exact: false`.
 *
 * Making it exact means putting the analyzed text into `articles_insights`,
 * which is a second full-body Lucene index — not affordable on an M20 whose
 * search nodes are the same nodes ingestion is already contending for.
 */
function chooseIndex(query: NormalizedQuery): SearchIndexName | null {
  const needsEnrichmentFilter =
    query.categories.length > 0 || query.sentiments.length > 0 || query.minQuality !== null
  if (!query.q) return 'articles_insights'
  return needsEnrichmentFilter ? null : 'articles_text_search'
}

/** UTC day edges for the window: `days + 1` boundaries produce `days` buckets. */
function dayBoundaries(query: NormalizedQuery): Date[] {
  const start = new Date(`${query.from}T00:00:00.000Z`).getTime()
  return Array.from({ length: query.days + 1 }, (_, i) => new Date(start + i * 86_400_000))
}

/**
 * The Search compound for this query against `index`.
 *
 * Every filter goes in the compound, never in a following `$match`: that
 * placement is the whole difference between 10 seconds and 10 milliseconds,
 * because a filter inside `$search` narrows before Lucene scores and before
 * Atlas fetches a single document.
 *
 * `mustNot` is the exact semantics of `$ne` — it excludes the named value AND
 * keeps documents where the field is absent, which is what `BASE_MATCH` means.
 * `moderationStatus` is NOT mapped in either index, so that clause is currently
 * inert (verified: Atlas accepts an unmapped path in `mustNot` without error).
 * It is written anyway because it costs nothing and becomes live the moment the
 * field is mapped — and because it is true today regardless: measured
 * 2026-09-14, `moderationStatus` is `removed` on 0 of 65,813 articles and
 * `flagged` on 0, so the moderation path has never once been exercised. The
 * deep pass applies it in MQL for real, which is what keeps a removed article
 * out of the sample list — the only place one would be shown to a person.
 */
function buildCompound(query: NormalizedQuery, index: SearchIndexName): Document {
  const { $gte: gte, $lt: lt } = buildMatch(query).datePublished as { $gte: Date; $lt: Date }

  const filter: Document[] = [{ range: { path: 'datePublished', gte, lt } }]
  if (query.countries.length) filter.push({ in: { path: 'countryCode', value: query.countries } })
  if (query.sources.length) filter.push({ in: { path: 'feedSourceId', value: query.sources } })

  if (index === 'articles_insights') {
    if (query.categories.length) {
      filter.push({ in: { path: 'engagement.interest_categories', value: query.categories } })
    }
    if (query.sentiments.length) filter.push({ in: { path: 'aiSentiment', value: query.sentiments } })
    if (query.minQuality !== null) {
      filter.push({ range: { path: 'qualityScore', gte: query.minQuality } })
    }
  }

  const compound: Document = {
    filter,
    mustNot: [
      { text: { path: 'status', query: 'rejected' } },
      { text: { path: 'moderationStatus', query: 'removed' } },
    ],
  }
  if (query.q) compound.must = [{ text: { query: query.q, path: TEXT_PATHS } }]
  return compound
}

/** The facets `index` can answer, keyed to the panels that consume them. */
function buildMetaFacets(query: NormalizedQuery, index: SearchIndexName): Document {
  const facets: Document = {
    day: { type: 'date', path: 'datePublished', boundaries: dayBoundaries(query) },
    source: { type: 'string', path: 'feedSourceId', numBuckets: 25 },
    // 54 member states plus whatever provenance has mis-stamped; 60 leaves room
    // rather than truncating the tail into a wrong denominator.
    country: { type: 'string', path: 'countryCode', numBuckets: 60 },
  }

  if (index === 'articles_insights') {
    // 200 because `engagement.interest_categories` carries 52 distinct values,
    // not the platform's 40 — the pipeline's pre-rebuild vocabulary is still in
    // the corpus. Truncating the tail would also make every share wrong, since
    // the denominator is the sum of the buckets returned.
    facets.category = { type: 'string', path: 'engagement.interest_categories', numBuckets: 200 }
    // Over-fetched: the stopword filter runs after the counts.
    facets.keyword = { type: 'string', path: 'aiKeywords', numBuckets: 80 }
    facets.sentiment = { type: 'string', path: 'aiSentiment', numBuckets: 10 }
  }
  return facets
}

type MetaBucket = { _id: unknown; count: number }
type SearchMetaResult = {
  count?: { total?: number }
  facet?: Record<string, { buckets?: MetaBucket[] }>
}

const bucketsOf = (meta: SearchMetaResult | undefined, name: string): MetaBucket[] =>
  meta?.facet?.[name]?.buckets ?? []

/** Facet buckets → `TermRow[]`, dropping empties and anything not a string. */
function termRows(buckets: MetaBucket[]): TermRow[] {
  return buckets
    .filter((b): b is { _id: string; count: number } => typeof b._id === 'string' && b._id.length > 0)
    .map((b) => ({ term: b._id, count: Number(b.count) }))
}

/**
 * The panels no Search mapping can serve, read from the documents themselves.
 *
 * Bounded by `ENRICHMENT_SCAN_LIMIT`. The `$limit` sits immediately after
 * `$search` on purpose: it bounds the id lookup, which is the stage that made
 * the old pipeline unservable. When the compound could not carry every filter
 * (`chooseIndex` returned null) the remaining ones are applied here in MQL, so
 * what this pass reports is always the query the caller actually asked for —
 * over the highest-scoring `ENRICHMENT_SCAN_LIMIT` matches rather than all of
 * them, which is what `deepScanned` exists to disclose.
 */
function buildDeepFacets(sampleLimit: number): Document {
  return {
    read: [{ $count: 'n' }],

    // These three duplicate facets the index answers exactly. They are here for
    // the one case that has no exact index — a text term combined with an
    // enrichment filter — where this pass IS the query. On every other path the
    // facet values win and these are ignored; computing them costs nothing,
    // since the documents are already in the pipeline.
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
      { $group: { _id: '$feedSourceId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 25 },
    ],

    byCountry: [
      { $group: { _id: '$countryCode', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
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

    quality: [
      { $match: { qualityScore: { $type: 'number', $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$qualityScore' }, n: { $sum: 1 } } },
    ],

    // Only needed when the term forced `articles_text_search`, which maps no
    // enrichment field. Computing it unconditionally costs nothing — the
    // documents are already in the pipeline — and keeps one code path.
    sentiment: [
      { $match: { aiSentiment: { $type: 'string' } } },
      { $group: { _id: '$aiSentiment', count: { $sum: 1 } } },
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
    // boilerplate.
    byKeyword: [
      { $match: { aiKeywords: { $type: 'array' } } },
      { $unwind: '$aiKeywords' },
      { $group: { _id: '$aiKeywords', count: { $sum: 1 } } },
      { $match: { _id: { $type: 'string', $ne: '' } } },
      { $sort: { count: -1 } },
      { $limit: 80 },
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

/** Zero-fill the daily series so a quiet day reads as 0, not as a gap. */
function fillSeries(rows: Array<{ _id: string; count: number }>, from: string, to: string): SeriesPoint[] {
  const counts = new Map(rows.map((r) => [r._id, r.count]))
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  const out: SeriesPoint[] = []
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = isoDay(new Date(t))
    out.push({ date: day, count: counts.get(day) ?? 0 })
  }
  return out
}

/** A `date` facet keys each bucket by its LOWER boundary. */
function seriesFromDayFacet(buckets: MetaBucket[], query: NormalizedQuery): SeriesPoint[] {
  const rows = buckets
    .filter((b) => b._id instanceof Date || typeof b._id === 'string')
    .map((b) => ({ _id: isoDay(new Date(b._id as string | Date)), count: Number(b.count) }))
  return fillSeries(rows, query.from, query.to)
}

type DeepOutput = {
  read?: Array<{ n: number }>
  series?: Array<{ _id: string; count: number }>
  bySource?: Array<{ _id: string; count: number }>
  byCountry?: Array<{ _id: string; count: number }>
  byCategory?: Array<{ _id: string; count: number }>
  byKeyword?: Array<{ _id: string; count: number }>
  byEntity?: Array<{ _id: { name: string; type?: string }; count: number }>
  byAuthor?: Array<{ _id: string; count: number }>
  bylineCovered?: Array<{ n: number }>
  sentiment?: Array<{ _id: string; count: number }>
  quality?: Array<{ avg: number; n: number }>
  sample?: Document[]
}

/**
 * Run a corpus query and return every panel the console renders.
 *
 * Two bounded round trips, run together:
 *
 *   1. `$searchMeta` counts the WHOLE match in the index — total, daily series,
 *      sources, countries, and (when no text term forces the other index)
 *      categories, keywords and sentiment. Exact, and milliseconds.
 *   2. One `$search` capped at `ENRICHMENT_SCAN_LIMIT` reads documents for the
 *      panels no Search mapping carries: named entities, bylines, and the
 *      quality average.
 *
 * Both begin with the same compound, so both narrow inside Lucene rather than
 * after it. See the comment above `TEXT_PATHS` for what this replaced and why.
 */
export async function runCorpusQuery(params: CorpusQueryParams): Promise<CorpusQueryResult> {
  const query = normalizeQuery(params)
  const sampleLimit = clampInt(params.sampleLimit, 1, MAX_LIMIT, 20)

  try {
    const db = await getDb()
    const col = db.collection('articles')

    const facetIndex = chooseIndex(query)
    // With no exact index the deep pass carries the query alone; it still needs
    // the text term, so it runs against the index that has the analyzed fields.
    const searchIndex: SearchIndexName = facetIndex ?? 'articles_text_search'
    const compound = buildCompound(query, searchIndex)

    const [meta, deep] = await Promise.all([
      facetIndex
        ? col
            .aggregate<SearchMetaResult>(
              [
                {
                  $searchMeta: {
                    index: facetIndex,
                    facet: {
                      operator: { compound },
                      facets: buildMetaFacets(query, facetIndex),
                    },
                    // Not the default lower bound — an approximate headline
                    // figure beside exact per-bucket counts reads as a bug.
                    count: { type: 'total' },
                  },
                },
              ],
              AGG_OPTS
            )
            .toArray()
            .then((rows) => rows[0])
        : Promise.resolve(undefined),
      col
        .aggregate<DeepOutput>(
          [
            { $search: { index: searchIndex, compound } },
            // Immediately after `$search`, so it bounds the id lookup — the
            // stage whose unbounded cost made the old pipeline unservable.
            { $limit: ENRICHMENT_SCAN_LIMIT },
            // The query's truth, including the filters the compound could not
            // carry and the moderation exclusion no index maps.
            { $match: buildMatch(query) },
            { $facet: buildDeepFacets(sampleLimit) },
          ],
          AGG_OPTS
        )
        .toArray()
        .then((rows) => rows[0] ?? {}),
    ])

    const deepScanned = deep.read?.[0]?.n ?? 0
    const exact = Boolean(meta)
    const total = exact ? Number(meta?.count?.total ?? 0) : deepScanned

    if (total === 0) {
      return { ...emptyResult(query), usedSearchIndex: Boolean(query.q), exact, deepScanned }
    }

    // Which denominator each panel is honestly a share OF. The facets counted
    // the whole match; the deep pass counted only what it read, and reporting
    // its coverage against `total` would render 96%-of-what-we-saw as 4%.
    const facetDenominator = total
    const deepDenominator = deepScanned || total

    const sourceBuckets = exact ? bucketsOf(meta, 'source') : (deep.bySource ?? [])
    const countryBuckets = exact ? bucketsOf(meta, 'country') : (deep.byCountry ?? [])

    // Resolve source ids → display names in one round trip.
    const sourceIds = [
      ...new Set([
        ...sourceBuckets.map((b) => String(b._id)),
        ...(deep.sample ?? []).map((d) => d.feedSourceId).filter((s): s is string => !!s),
      ]),
    ].filter(Boolean)
    const sourceDocs = sourceIds.length
      ? await db
          .collection<{ _id: string; name?: string; countryCode?: string }>('feedSources')
          .find({ _id: { $in: sourceIds } }, { projection: { name: 1, countryCode: 1 } })
          .toArray()
      : []
    const sourceNames = new Map(sourceDocs.map((s) => [s._id, s.name ?? s._id]))
    const sourceCountries = new Map(sourceDocs.map((s) => [s._id, s.countryCode ?? null]))

    const sentimentBuckets = exact && meta?.facet?.sentiment
      ? bucketsOf(meta, 'sentiment')
      : (deep.sentiment ?? [])
    const sentimentFromFacet = Boolean(exact && meta?.facet?.sentiment)
    const sentimentCounts = new Map(
      sentimentBuckets.map((b) => [String(b._id), Number(b.count)])
    )
    const sentimentCovered = [...sentimentCounts.values()].reduce((a, b) => a + b, 0)
    const sentimentDenominator = sentimentFromFacet ? facetDenominator : deepDenominator

    // Country tokens come from the `places` SSOT, not from a list in this file.
    const countries = await countryTokens()
    const categoryRows = exact && meta?.facet?.category
      ? termRows(bucketsOf(meta, 'category'))
      : termRows(deep.byCategory ?? [])
    const keywordRows = exact && meta?.facet?.keyword
      ? termRows(bucketsOf(meta, 'keyword'))
      : termRows(deep.byKeyword ?? [])

    const bylineCovered = deep.bylineCovered?.[0]?.n ?? 0
    const qualityRow = deep.quality?.[0]

    return {
      query,
      total,
      exact,
      deepScanned,
      usedSearchIndex: Boolean(query.q),
      series: exact
        ? seriesFromDayFacet(bucketsOf(meta, 'day'), query)
        : fillSeries(deep.series ?? [], query.from, query.to),
      bySource: sourceBuckets
        .filter((b) => typeof b._id === 'string' && b._id.length > 0)
        .slice(0, 25)
        .map((b) => {
          const id = String(b._id)
          return {
            sourceId: id,
            name: sourceNames.get(id) ?? id,
            // The source's own registered country. The old pipeline took the
            // first article's, which is the same answer far more expensively.
            country: sourceCountries.get(id) ?? null,
            count: Number(b.count),
            share: share(Number(b.count), facetDenominator),
          }
        }),
      byCountry: countryBuckets
        .filter((b) => typeof b._id === 'string' && b._id.length > 0)
        .map((b) => ({
          code: String(b._id),
          name: COUNTRY_NAMES[String(b._id)] ?? String(b._id),
          count: Number(b.count),
          share: share(Number(b.count), facetDenominator),
        })),
      byCategory: categoryRows.slice(0, 20),
      byKeyword: keywordRows.filter((r) => isMeaningfulTopic(r.term, countries)).slice(0, 25),
      byEntity: (deep.byEntity ?? [])
        .filter((r) => r._id?.name && isMeaningfulTopic(r._id.name, countries))
        .slice(0, 25)
        .map((r) => ({ name: r._id.name, type: r._id.type ?? 'UNKNOWN', count: r.count })),
      byAuthor: (deep.byAuthor ?? []).map((r) => ({ name: r._id, count: r.count })),
      bylineCoverage: {
        covered: bylineCovered,
        coverage: share(bylineCovered, deepDenominator),
      },
      sentiment: {
        positive: sentimentCounts.get('positive') ?? 0,
        neutral: sentimentCounts.get('neutral') ?? 0,
        negative: sentimentCounts.get('negative') ?? 0,
        mixed: sentimentCounts.get('mixed') ?? 0,
        covered: sentimentCovered,
        coverage: share(sentimentCovered, sentimentDenominator),
      },
      quality: {
        avg: round(qualityRow?.avg ?? 0, 3),
        covered: qualityRow?.n ?? 0,
        coverage: share(qualityRow?.n ?? 0, deepDenominator),
      },
      sample: (deep.sample ?? []).map((d) => ({
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
// Preview — the anonymous half of the console
//
// `/insights` is open and `/analytics` is not, and the boundary between them is
// where a reader who wants to go deeper decides whether to sign up. A redirect
// to `/sign-in` is the worst possible thing to put there: it takes away the page
// they were reading and replaces it with a form that does not say what they were
// about to get. This app already learned that with the AI summary — "the gate
// teases, it does not vanish… a component that simply disappears converts
// nobody, because they never learn the feature exists" — and the console never
// got the same treatment.
//
// So an anonymous reader gets their own query answered, partially.
//
// ## Why the line falls exactly here
//
// It is not a product line drawn over the data; it is the seam the engine
// already has. `runCorpusQuery` issues TWO aggregations in parallel:
//
//   meta  — `$searchMeta` facets. Counts only. Milliseconds. No documents read.
//   deep  — `$search` + `$limit` + `$match` + `$facet`. Reads documents, and is
//           the pass that costs something.
//
// The preview runs the FIRST and never the second. That is what makes it safe
// to hand an anonymous caller: `guard.ts` gates the console partly because it
// "makes the expensive path reachable without a cost owner", and this path is
// not the expensive one. Everything the deep pass produces — named entities,
// bylines, the quality average, the sample articles — stays behind the session,
// along with the CSV export of a matched slice.
//
// It also happens to be the honest product line. Counts, shares and a shape over
// time are the same KIND of thing `/insights` already publishes, narrowed to a
// question the reader asked. Rows, names and the articles themselves are the
// queryable database the guard exists to protect.
// ---------------------------------------------------------------------------

/**
 * What an anonymous caller may see of their own query.
 *
 * Deliberately NOT a `Partial<CorpusQueryResult>`: the locked panels are absent
 * from the type rather than empty in it, so a client cannot render "no named
 * entities for this query" over data it was simply not given. An empty array
 * and a withheld one must not be the same value — that is the same rule
 * `CorpusSummary.ok` exists for.
 */
export interface CorpusPreview {
  query: NormalizedQuery
  /**
   * False when no Search index can express this query shape.
   *
   * `chooseIndex` returns null for a text term combined with a category,
   * sentiment or quality filter — `runCorpusQuery` falls back to the deep pass
   * there, and the preview will not, so it reports that it cannot answer rather
   * than answering with zero. Zero would read as "no articles match", which is
   * a claim about the corpus rather than about our indexes.
   */
  answered: boolean
  total: number
  usedSearchIndex: boolean
  series: SeriesPoint[]
  bySource: SourceRow[]
  byCountry: CountryRow[]
  /**
   * `null` when the chosen Search index cannot answer this facet at all —
   * NOT an empty result.
   *
   * `buildMetaFacets` adds the category/keyword/sentiment facets only for
   * `articles_insights`, and a text term routes the query to
   * `articles_text_search` instead. These three came back as `[]` in that
   * case, which the UI rendered as "No data for this query." — a facet we
   * never asked for, presented to a reader as a measured fact about the
   * corpus. That is the same failure `CorpusSummary.ok` exists to prevent,
   * and this type's own docstring above already forbids it.
   */
  byCategory: TermRow[] | null
  byKeyword: TermRow[] | null
  sentiment: SentimentSummary | null
  generatedAt: string
}

function emptyPreview(query: NormalizedQuery, answered: boolean): CorpusPreview {
  return {
    query,
    answered,
    total: 0,
    usedSearchIndex: Boolean(query.q),
    series: [],
    bySource: [],
    byCountry: [],
    byCategory: null,
    byKeyword: null,
    sentiment: null,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Run only the facet pass of a corpus query.
 *
 * Fail-soft like every other read in this module: a failure returns an
 * empty-but-typed result with `answered: false`, never throws to the page.
 */
export async function runCorpusPreview(params: CorpusQueryParams): Promise<CorpusPreview> {
  const query = normalizeQuery(params)

  const facetIndex = chooseIndex(query)
  // No index can express this shape, and the only other way to answer it is the
  // document scan this function exists not to run. Say so instead.
  if (!facetIndex) return emptyPreview(query, false)

  try {
    const db = await getDb()
    const col = db.collection('articles')
    const compound = buildCompound(query, facetIndex)

    const meta = await col
      .aggregate<SearchMetaResult>(
        [
          {
            $searchMeta: {
              index: facetIndex,
              facet: { operator: { compound }, facets: buildMetaFacets(query, facetIndex) },
              count: { type: 'total' },
            },
          },
        ],
        AGG_OPTS
      )
      .toArray()
      .then((rows) => rows[0])

    if (!meta) return emptyPreview(query, false)

    const total = Number(meta.count?.total ?? 0)
    if (total === 0) {
      /*
       * ANSWERED, and genuinely nothing matched — which is a finding about the
       * corpus, not about our indexes.
       *
       * `emptyPreview` nulls the three facet-dependent fields because it is
       * also the shape returned when we could not ask. Reusing it verbatim
       * here made a legitimately-empty result render "Not available for a text
       * search", asserting an index limitation that is not the cause. Carry
       * `[]` for whatever the chosen index DOES map, so null keeps meaning
       * exactly one thing: we did not ask.
       */
      const mapped = facetIndex === 'articles_insights'
      return {
        ...emptyPreview(query, true),
        total: 0,
        byCategory: mapped ? [] : null,
        byKeyword: mapped ? [] : null,
        sentiment: mapped
          ? { positive: 0, neutral: 0, negative: 0, mixed: 0, covered: 0, coverage: 0 }
          : null,
      }
    }

    const countries = await countryTokens()
    const sourceBuckets = bucketsOf(meta, 'source')
    const sourceIds = [...new Set(sourceBuckets.map((b) => String(b._id)))].filter(Boolean)
    const sourceDocs = sourceIds.length
      ? await db
          .collection<{ _id: string; name?: string; countryCode?: string }>('feedSources')
          .find({ _id: { $in: sourceIds } }, { projection: { name: 1, countryCode: 1 } })
          .toArray()
      : []
    const sourceNames = new Map(sourceDocs.map((s) => [s._id, s.name ?? s._id]))
    const sourceCountries = new Map(sourceDocs.map((s) => [s._id, s.countryCode ?? null]))

    const sentimentCounts = new Map(
      (meta.facet?.sentiment ? bucketsOf(meta, 'sentiment') : []).map((b) => [
        String(b._id),
        Number(b.count),
      ])
    )
    const sentimentCovered = [...sentimentCounts.values()].reduce((a, b) => a + b, 0)

    return {
      query,
      answered: true,
      total,
      usedSearchIndex: Boolean(query.q),
      series: seriesFromDayFacet(bucketsOf(meta, 'day'), query),
      bySource: sourceBuckets
        .filter((b) => typeof b._id === 'string' && b._id.length > 0)
        // Fewer rows than the full console gives a signed-in reader. The point
        // is to show the shape of the answer, not to be a smaller copy of it.
        .slice(0, 10)
        .map((b) => {
          const id = String(b._id)
          return {
            sourceId: id,
            name: sourceNames.get(id) ?? id,
            country: sourceCountries.get(id) ?? null,
            count: Number(b.count),
            share: round((Number(b.count) / total) * 100, 1),
          }
        }),
      byCountry: bucketsOf(meta, 'country')
        .filter((b) => typeof b._id === 'string' && b._id.length > 0)
        .slice(0, 10)
        .map((b) => ({
          code: String(b._id),
          name: COUNTRY_NAMES[String(b._id)] ?? String(b._id),
          count: Number(b.count),
          share: round((Number(b.count) / total) * 100, 1),
        })),
      // `null` rather than `[]` when the index carries no such facet — see the
      // note on `CorpusPreview.byCategory`. An empty array is a finding about
      // the corpus; a withheld facet is a fact about our indexes.
      byCategory: meta.facet?.category ? termRows(bucketsOf(meta, 'category')).slice(0, 10) : null,
      // The `isMeaningfulTopic` filter runs AFTER the counts, which is why the
      // facet over-fetches at `numBuckets: 80` — the same ordering
      // `runCorpusQuery` uses. Omitting it here is what put five country names
      // in the anonymous preview's top ten "Topics", duplicating the country
      // panel sitting next to it (measured live 2026-09-23: Nigeria 6,184,
      // South Africa 2,871, Ghana 2,189, Zimbabwe 1,804, Kenya 1,407).
      byKeyword: meta.facet?.keyword
        ? termRows(bucketsOf(meta, 'keyword'))
            .filter((r) => isMeaningfulTopic(r.term, countries))
            .slice(0, 10)
        : null,
      sentiment: meta.facet?.sentiment
        ? {
            positive: sentimentCounts.get('positive') ?? 0,
            neutral: sentimentCounts.get('neutral') ?? 0,
            negative: sentimentCounts.get('negative') ?? 0,
            mixed: sentimentCounts.get('mixed') ?? 0,
            covered: sentimentCovered,
            coverage: total > 0 ? round((sentimentCovered / total) * 100, 1) : 0,
          }
        : null,
      generatedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.error('[analytics.runCorpusPreview]', error)
    return emptyPreview(query, false)
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
      ], AGG_OPTS)
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
}

const EMPTY_FACETS: QueryFacets = { countries: [], categories: [] }

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
          },
        },
      ], AGG_OPTS)
      .toArray()

    if (!rows) return EMPTY_FACETS

    // Sources are deliberately NOT a facet here. The console has no source
    // <select> — a source filter is arrived at by clicking a bar in "Who is
    // covering it" — so fetching the top 200 plus a feedSources name lookup
    // only to serialize them into the RSC payload unread was a round trip and a
    // payload for nothing.
    return {
      countries: rows.countries.map((c) => ({
        code: c._id,
        name: COUNTRY_NAMES[c._id] ?? c._id,
        articles: c.n,
      })),
      categories: rows.categories.map((c) => ({ slug: c._id, articles: c.n })),
    }
  } catch (error) {
    console.error('[analytics.getQueryFacets]', error)
    return EMPTY_FACETS
  }
}
