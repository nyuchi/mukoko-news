'use server'

/**
 * Server Actions for the /analytics query console.
 *
 * Exposes the read-only aggregations in `@/lib/mongodb/analytics` to the
 * `/analytics` page and its export route. Per the repo's data-flow rule these
 * read the `news` DB directly — never through the gateway Worker.
 *
 * Server Actions are a public RPC surface, so every input is validated with the
 * `@/lib/safety` schemas here before it reaches the MongoDB layer. Reads degrade
 * to safe defaults rather than throwing: a malformed filter yields an
 * unfiltered-but-bounded query, not a 500.
 *
 * ACCESS: every action here requires a signed-in viewer. Unlike `/insights`,
 * which publishes a fixed set of aggregates, the console answers an arbitrary
 * query over the corpus and returns sample articles — a queryable database, not
 * a published dataset. The guard lives in each action rather than only on the
 * page because an action id can be POSTed directly by anyone who has seen it
 * once; a page-only redirect would protect nothing.
 */

import { z } from 'zod'
import { unstable_cache } from 'next/cache'
import { requireViewer } from '@/lib/auth/guard'
import {
  runCorpusQuery,
  getCoverageConcentration,
  getQueryFacets,
  type CorpusQueryParams,
  type CorpusQueryResult,
  type CoverageConcentration,
  type QueryFacets,
} from '@/lib/mongodb/analytics'
import {
  parseOrDefault,
  countriesSchema,
  categoriesSchema,
  searchQuerySchema,
  clampInt,
  MAX_LIST_ENTRIES,
  MAX_ID_LENGTH,
} from '@/lib/safety'

/** Inclusive UTC calendar day, YYYY-MM-DD. */
const daySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)

const sentimentsSchema = z
  .array(z.unknown())
  .transform((arr) =>
    arr
      .flatMap((v) =>
        typeof v === 'string' && ['positive', 'neutral', 'negative', 'mixed'].includes(v)
          ? [v as 'positive' | 'neutral' | 'negative' | 'mixed']
          : []
      )
      .slice(0, 4)
  )

const sourcesSchema = z
  .array(z.unknown())
  .transform((arr) =>
    arr
      .flatMap((v) =>
        typeof v === 'string' && v.trim().length > 0 && v.trim().length <= MAX_ID_LENGTH
          ? [v.trim()]
          : []
      )
      .slice(0, MAX_LIST_ENTRIES)
  )

/**
 * Validate the console's query params. Each field degrades independently — a
 * bad `from` date never discards a good country filter.
 */
function safeQueryParams(raw: unknown): CorpusQueryParams {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    q: parseOrDefault(searchQuerySchema, p.q, undefined),
    countries: parseOrDefault(countriesSchema, p.countries, undefined),
    categories: parseOrDefault(categoriesSchema, p.categories, undefined),
    sources: parseOrDefault(sourcesSchema, p.sources, undefined),
    from: parseOrDefault(daySchema, p.from, undefined),
    to: parseOrDefault(daySchema, p.to, undefined),
    sentiments: parseOrDefault(sentimentsSchema, p.sentiments, undefined),
    minQuality:
      typeof p.minQuality === 'number' && Number.isFinite(p.minQuality)
        ? Math.min(1, Math.max(0, p.minQuality))
        : undefined,
    sampleLimit: p.sampleLimit === undefined ? undefined : clampInt(p.sampleLimit, 1, 100, 20),
  }
}

/**
 * Run one corpus query — the console's single data call.
 *
 * Returns every panel (series, source/country/topic/entity breakdowns,
 * sentiment, quality, sample articles) plus the normalized query it actually
 * ran, so the UI can caption results with the filters that were applied rather
 * than the ones that were requested.
 */
export async function runCorpusQueryAction(params: unknown): Promise<CorpusQueryResult> {
  await requireViewer()
  return runCorpusQuery(safeQueryParams(params))
}

/**
 * Cache window for the two query-INDEPENDENT reads below.
 *
 * `/analytics` is `force-dynamic` because the corpus query answers an arbitrary
 * URL, but the facet list and the concentration table do not depend on the
 * query at all — every visitor gets the same numbers. Without this, one public
 * unauthenticated page view ran three aggregations over `news.articles`, two of
 * them recomputing an identical answer. Ten minutes matches `/insights`
 * (`revalidate = 600`): these are day-scale corpus shape metrics, not a live
 * feed, and the console's own result stays uncached and current.
 */
const FACET_CACHE_SECONDS = 600

/**
 * `unstable_cache` keys on the arguments, so the clamped day count is passed in
 * rather than read inside — two different windows must not share an entry.
 */
const cachedConcentration = unstable_cache(
  (days: number) => getCoverageConcentration({ days }),
  ['analytics-coverage-concentration'],
  { revalidate: FACET_CACHE_SECONDS, tags: ['analytics-facets'] }
)

const cachedFacets = unstable_cache(
  (days: number) => getQueryFacets({ days }),
  ['analytics-query-facets'],
  { revalidate: FACET_CACHE_SECONDS, tags: ['analytics-facets'] }
)

/**
 * Per-country source concentration over the recent window — how many outlets
 * actually serve each country, and what share the largest one holds.
 */
export async function getCoverageConcentrationAction(days = 30): Promise<CoverageConcentration> {
  await requireViewer()
  return cachedConcentration(clampInt(days, 1, 365, 30))
}

/** The filter values the corpus can actually answer for, to populate the console's controls. */
export async function getQueryFacetsAction(days = 90): Promise<QueryFacets> {
  await requireViewer()
  return cachedFacets(clampInt(days, 1, 365, 90))
}
