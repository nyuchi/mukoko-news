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
 * The second, purpose-built index — the one that makes the enrichment panels
 * possible at all.
 *
 * `articles_text_search` maps what a reader SEARCHES: headline, description,
 * body, and the tokens a search can be filtered by. It does not map
 * `aiSentiment`, `aiKeywords` or `engagement.interest_categories`, and those
 * three are the whole of the sentiment, topics and category panels. Without a
 * mapping the only way to count them is to read every document, which on this
 * M20 is 27.5 seconds for 65,203 articles — longer than the request lives.
 *
 * So `articles_insights` maps exactly those fields and nothing expensive: no
 * bodies, no analysed text, just the tokens and two numbers. It is ADDITIVE —
 * the search index is untouched, and dropping this one degrades three panels
 * rather than breaking search.
 *
 * The split is deliberate and not tidiness: the reads that already work stay on
 * the index that already serves them, so a rebuild or a mapping change here
 * cannot take the corpus summary and country coverage down with it.
 */
const INSIGHTS_INDEX = 'articles_insights'

/** One bucket of an Atlas Search facet, before it is trusted. */
interface RawBucket {
  _id: unknown
  count: unknown
}

/** One bucket after it is. A string facet fills `value`; a date facet fills `at`. */
interface FacetBucket {
  value: string
  at: Date | null
  count: number
}

/**
 * Run one `$searchMeta` facet query and hand back the buckets, already cleaned.
 *
 * Every panel below is the same shape — count documents, group by one token
 * field — so this is the one place that knows how `$searchMeta` replies, how
 * the counts are coerced, and that `count: {type:'total'}` is required because
 * the DEFAULT is a lower BOUND. A headline figure that is quietly an
 * underestimate is worse than a slow one.
 */
async function searchFacets(
  db: Awaited<ReturnType<typeof getDb>>,
  index: string,
  operator: Record<string, unknown>,
  facets: Record<string, Record<string, unknown>>
): Promise<{ total: number; buckets: Record<string, FacetBucket[]> }> {
  const rows = (await db
    .collection('articles')
    .aggregate(
      [{ $searchMeta: { index, count: { type: 'total' }, facet: { operator, facets } } }],
      AGG_OPTS
    )
    .toArray()) as Array<{
    count?: { total?: unknown }
    facet?: Record<string, { buckets?: RawBucket[] }>
  }>

  const row = rows[0]
  const buckets: Record<string, FacetBucket[]> = {}
  for (const name of Object.keys(facets)) {
    buckets[name] = (row?.facet?.[name]?.buckets ?? [])
      .map((b) => ({
        // A string facet's id is the token; a DATE facet's is the bucket's
        // lower boundary, as a Date. Both are kept, so one call can carry a
        // daily series and a top-sources list without a second round trip.
        value: typeof b._id === 'string' ? b._id.trim() : '',
        at: b._id instanceof Date && !Number.isNaN(b._id.getTime()) ? b._id : null,
        count: Math.max(0, Math.trunc(Number(b.count ?? 0))),
      }))
      .filter((b) => b.count > 0 && (b.value.length > 0 || b.at !== null))
      .sort((a, b) => b.count - a.count)
  }

  return { total: Math.max(0, Math.trunc(Number(row?.count?.total ?? 0))), buckets }
}

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
  /** Did the read succeed? Zero is a number; a failure is not. */
  ok: boolean
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
    ok: false,
    days,
    from: isoDay(from),
    to: isoDay(to),
    total: 0,
    series: [],
    topSources: [],
  }
}

/** Midnight UTC, `back` days before today, inclusive of today. */
function windowStart(back: number): Date {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - (back - 1))
  return start
}

/**
 * Articles published per UTC day over the last `days` (default 30), plus the
 * top sources contributing to that window. The daily series is zero-filled so
 * the chart has a point for every day even when nothing was published.
 *
 * A `$searchMeta` DATE facet, not a `$group` on `$dateToString`. The boundaries
 * are the window's own day edges, so Atlas Search counts each day in the
 * inverted index and the result is exact — the `$group` this replaced opened
 * with `BASE_MATCH`, whose `$ne` pair no index can serve, and so read all
 * 65,203 documents (27.5s measured). The top-source names come from a single
 * `find` on `feedSources` rather than a `$lookup`, because a lookup would have
 * dragged the whole pipeline back onto the collection it was just lifted off.
 */
export async function getPublishingVolume({
  days = 30,
}: { days?: number } = {}): Promise<PublishingVolume> {
  const window = clampInt(days, 1, 365, 30)
  try {
    const db = await getDb()
    const start = windowStart(window)

    // One boundary per day edge, plus the closing edge — N days needs N+1.
    const boundaries: Date[] = []
    for (let i = 0; i <= window; i++) boundaries.push(new Date(start.getTime() + i * 86_400_000))

    const { total, buckets } = await searchFacets(
      db,
      SEARCH_INDEX,
      { range: { path: 'datePublished', gte: start, lt: boundaries[boundaries.length - 1] } },
      {
        day: { type: 'date', path: 'datePublished', boundaries },
        source: { type: 'string', path: 'feedSourceId', numBuckets: 8 },
      }
    )

    // A date facet's bucket id is its lower boundary, which is the UTC day.
    const counts = new Map<string, number>()
    for (const b of buckets.day) {
      if (b.at) counts.set(isoDay(b.at), b.count)
    }

    const series: VolumePoint[] = []
    for (let i = 0; i < window; i++) {
      const key = isoDay(new Date(start.getTime() + i * 86_400_000))
      series.push({ date: key, count: counts.get(key) ?? 0 })
    }

    const sourceNames = await sourceDisplayNames(
      db,
      buckets.source.map((b) => b.value)
    )

    return {
      ok: true,
      days: window,
      from: series[0]?.date ?? isoDay(start),
      to: series[series.length - 1]?.date ?? isoDay(new Date()),
      total,
      series,
      topSources: buckets.source.map((b) => ({
        sourceId: b.value,
        name: sourceNames.get(b.value)?.name ?? b.value,
        count: b.count,
      })),
    }
  } catch (error) {
    console.error('[insights.getPublishingVolume]', error)
    return EMPTY_VOLUME(window)
  }
}

/**
 * Resolve feed-source ids to their display name, organisation and country.
 *
 * `feedSources` is 587 rows and `newsMediaOrganizations` 537 — two indexed
 * `find`s on small collections, which is why every panel above can afford to
 * name its sources without a `$lookup` back onto the 1.5 GB article
 * collection. Fail-soft: an unresolvable id keeps the id as its name, because
 * a source we cannot name still published the articles.
 */
async function sourceDisplayNames(
  db: Awaited<ReturnType<typeof getDb>>,
  ids: string[]
): Promise<Map<string, { name: string; organization?: string; verified: boolean; country?: string }>> {
  const out = new Map<
    string,
    { name: string; organization?: string; verified: boolean; country?: string }
  >()
  if (ids.length === 0) return out

  const sources = (await db
    .collection('feedSources')
    .find(
      // `_id` on these collections is a slug string (`src-herald-zw`), not an
      // ObjectId — the driver's default typing assumes otherwise.
      { _id: { $in: ids } } as unknown as Record<string, unknown>,
      { projection: { name: 1, mediaOrganizationId: 1, countryCode: 1 } }
    )
    .maxTimeMS(AGGREGATE_TIMEOUT_MS)
    .toArray()) as Array<Record<string, unknown>>

  const orgIds = sources
    .map((s) => s.mediaOrganizationId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const orgs = orgIds.length
    ? ((await db
        .collection('newsMediaOrganizations')
        .find(
          { _id: { $in: orgIds } } as unknown as Record<string, unknown>,
          { projection: { name: 1, verified: 1, isVerified: 1, verificationStatus: 1 } }
        )
        .maxTimeMS(AGGREGATE_TIMEOUT_MS)
        .toArray()) as Array<Record<string, unknown>>)
    : []

  const orgById = new Map(orgs.map((o) => [String(o._id), o]))

  for (const source of sources) {
    const org = typeof source.mediaOrganizationId === 'string'
      ? orgById.get(source.mediaOrganizationId)
      : undefined
    out.set(String(source._id), {
      name: typeof source.name === 'string' && source.name ? source.name : String(source._id),
      organization: typeof org?.name === 'string' ? org.name : undefined,
      verified: Boolean(
        org?.verified ?? org?.isVerified ?? org?.verificationStatus === 'verified'
      ),
      country: typeof source.countryCode === 'string' ? source.countryCode : undefined,
    })
  }

  return out
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
  /**
   * Average `qualityScore` / `wordCount` over this source's articles, or
   * **null when they could not be computed** — which is currently always.
   *
   * An Atlas Search facet counts documents per value; it cannot average a
   * field across them. Averaging means reading every one of this source's
   * articles, and the only pipeline that can do that is the collection scan
   * this function was rewritten to escape (27.5s for the corpus, measured).
   * `0` would render as "this newsroom scores zero on quality" and "articles
   * of zero words", which are claims about a real publisher.
   */
  avgQualityScore: number | null
  avgWordCount: number | null
  /**
   * The source's own country, from `feedSources`.
   *
   * This used to be `$addToSet` over every article's `countryCode` — the
   * distinct set the source had actually filed under. That needs the documents.
   * The source's registered country is the same answer for all but a handful of
   * wire sources, it is a single indexed read on a 587-row collection, and the
   * old code already fell back to it when article codes were absent.
   */
  countries: string[]
  /** Most recent publication, or null — see `avgQualityScore` for why. */
  lastPublished: string | null
}

/**
 * Per-source analytics: article count, publisher and verification, ranked by
 * volume. This is the "media organizations" analytics surface.
 *
 * Rebuilt 2026-09-11 onto a `$searchMeta` facet over `feedSourceId` plus two
 * small-collection reads. The `$group` it replaced opened with `BASE_MATCH`
 * and averaged four fields across all 65,203 documents; on this M20 that is a
 * COLLSCAN measured at 27.5 SECONDS, so the panel never rendered at all.
 *
 * What a facet cannot do is average, so the three per-article aggregates are
 * honestly `null` rather than `0`. A thinner panel that is true beats a fuller
 * one that is invented — and an empty panel, which is what shipped, tells the
 * reader nothing at all.
 */
export async function getSourceLeaderboard({
  limit = 20,
}: { limit?: number } = {}): Promise<SourceLeaderboardRow[]> {
  const max = clampInt(limit, 1, 100, 20)
  try {
    const db = await getDb()
    const { buckets } = await searchFacets(db, SEARCH_INDEX, MATCH_ALL, {
      source: { type: 'string', path: 'feedSourceId', numBuckets: max },
    })

    const ranked = buckets.source.slice(0, max)
    const sources = await sourceDisplayNames(
      db,
      ranked.map((b) => b.value)
    )

    return ranked.map((b) => {
      const source = sources.get(b.value)
      return {
        sourceId: b.value,
        name: source?.name ?? b.value,
        organization: source?.organization,
        verified: source?.verified ?? false,
        articleCount: b.count,
        avgQualityScore: null,
        avgWordCount: null,
        countries: source?.country ? [source.country] : [],
        lastPublished: null,
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
  /** Did the read succeed? Zero is a number; a failure is not. */
  ok: boolean
  /** Total category assignments across the corpus (an article may carry several). */
  totalAssignments: number
  /** Share of all assignments the returned (top) slugs account for. */
  coverage: number
  categories: Array<{ slug: string; count: number; share: number }>
}

const EMPTY_CATEGORY: CategoryDistribution = {
  ok: false,
  totalAssignments: 0,
  coverage: 0,
  categories: [],
}

/**
 * Article counts per `engagement.interest_categories` slug. Share is expressed
 * against total category *assignments* (articles can hold several), and
 * `coverage` reports how much of those the returned slugs account for.
 *
 * A `$searchMeta` facet on `articles_insights`, which exists precisely because
 * this field is not in the search index: the `$unwind` + `$group` it replaced
 * opened with `BASE_MATCH` and read all 65,203 documents (27.5s measured), so
 * the panel never rendered.
 *
 * `numBuckets` is 200, and the headroom is not arbitrary: **measured on the
 * live corpus 2026-09-11 the field carries 52 distinct values, not the 40 the
 * platform's interest-category set defines.** It holds a mix of that set
 * (`fintech-mobile-money`, `ai-machine-learning`, `african-identity`) and the
 * 17-slug vocabulary the pipeline invented before it (`politics`,
 * `international`, `economy`, `crime`) — history the enrichment rebuild left
 * behind. A first cut of this function used 50 on the assumption that 40 was
 * closed, which silently truncated the two smallest values AND made
 * `totalAssignments` the sum of a head rather than the true total. 200 leaves
 * room for that history to be cleaned up without this quietly under-counting
 * again; the whole tail costs nothing, since the 52nd value has ONE article.
 */
export async function getCategoryDistribution(): Promise<CategoryDistribution> {
  try {
    const db = await getDb()
    const { buckets } = await searchFacets(db, INSIGHTS_INDEX, MATCH_ALL, {
      category: { type: 'string', path: 'engagement.interest_categories', numBuckets: 200 },
    })

    const all = buckets.category
    const totalAssignments = all.reduce((sum, b) => sum + b.count, 0)
    if (totalAssignments === 0) return { ...EMPTY_CATEGORY, ok: true }

    const top = all.slice(0, 15)
    return {
      ok: true,
      totalAssignments,
      coverage: round((top.reduce((s, c) => s + c.count, 0) / totalAssignments) * 100, 1),
      categories: top.map((b) => ({
        slug: b.value,
        count: b.count,
        share: round((b.count / totalAssignments) * 100, 1),
      })),
    }
  } catch (error) {
    console.error('[insights.getCategoryDistribution]', error)
    return { ...EMPTY_CATEGORY }
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
  /** Did the read succeed? Zero is a number; a failure is not. */
  ok: boolean
  /** Articles carrying a sentiment label (the enriched subset). */
  total: number
  /** Share of the whole corpus that has been AI-enriched with a sentiment. */
  coverage: number
  breakdown: Array<{ sentiment: string; count: number; share: number }>
}

const EMPTY_SENTIMENT: SentimentBreakdown = { ok: false, total: 0, coverage: 0, breakdown: [] }

/**
 * Counts per `aiSentiment` value, with a `coverage` figure (labelled / whole
 * corpus) so the thin-data caveat can be shown in the UI.
 *
 * One `$searchMeta` call on `articles_insights`: the facet gives the per-label
 * counts and `count: {type:'total'}` gives the corpus denominator, so coverage
 * comes out of the same round trip rather than a second `countDocuments` that
 * would itself have been a full scan.
 *
 * `numBuckets` is 10 against a label set of three or four values — enough that
 * an unexpected label from the enrichment model shows up in the breakdown
 * rather than being silently folded into the tail.
 */
export async function getSentimentBreakdown(): Promise<SentimentBreakdown> {
  try {
    const db = await getDb()
    const { total: corpusTotal, buckets } = await searchFacets(db, INSIGHTS_INDEX, MATCH_ALL, {
      sentiment: { type: 'string', path: 'aiSentiment', numBuckets: 10 },
    })

    const labelled = buckets.sentiment
    const total = labelled.reduce((sum, b) => sum + b.count, 0)
    if (total === 0) return { ...EMPTY_SENTIMENT, ok: true }

    return {
      ok: true,
      total,
      coverage: corpusTotal > 0 ? round((total / corpusTotal) * 100, 1) : 0,
      breakdown: labelled.map((b) => ({
        sentiment: b.value.toLowerCase(),
        count: b.count,
        share: round((b.count / total) * 100, 1),
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

    // A `$searchMeta` facet on `articles_insights`. The `$unwind` + `$group`
    // this replaced opened with `BASE_MATCH`, whose `$ne` pair no index can
    // serve, so it read every document in the window — 27.5s for the corpus on
    // this M20, measured, which is longer than the request lives.
    //
    // The facet is over-fetched (`max * 6`, floored at 60) because the stopword
    // filter runs AFTER the counts come back: "news", "featured" and the rest
    // are frequent enough to fill a tight bucket list on their own and leave
    // the panel short of real subjects.
    const { buckets } = await searchFacets(
      db,
      INSIGHTS_INDEX,
      { range: { path: 'datePublished', gte: since } },
      { topic: { type: 'string', path: 'aiKeywords', numBuckets: Math.max(60, max * 6) } }
    )

    return buckets.topic
      .filter((b) => isMeaningfulTopic(b.value))
      .slice(0, max)
      .map((b) => ({ tag: b.value, count: b.count }))
  } catch (error) {
    console.error('[insights.getTopTopics]', error)
    return []
  }
}

