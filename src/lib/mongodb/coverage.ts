/**
 * Which countries the corpus can actually serve a reader right now.
 *
 * The onboarding modal used to offer `COUNTRIES.slice(0, 4)` — the first four
 * entries of a hand-ordered constant, which is the "East Africa" block at the
 * top of the array rather than anything about coverage. Measured on the live
 * corpus that meant a new reader was offered Tanzania (653 articles, 368 in the
 * last 30 days) while Nigeria — 13,518 articles, 8,648 of them in the last 30
 * days, the single largest country in the corpus — was not on the list at all.
 * Together the three busiest countries (NG, ZA, GH) are over half the corpus and
 * none of them appeared.
 *
 * Ranking by RECENT volume rather than all-time is deliberate: a country whose
 * sources have since gone dark still carries a large historical count, and
 * offering it would promise a feed the platform cannot currently fill.
 */

import { getDb } from './client'
import { clampInt } from '@/lib/safety'

export interface CoveredCountry {
  code: string
  /** Articles published in the window. */
  recent: number
  /** Distinct FEED SOURCES that published here in the window. */
  sources: number
  /**
   * Distinct NEWSROOMS (mastheads) that published here in the window.
   *
   * ## The three levels, and which one this is
   *
   *   publisher / entity   the publishing house      `entity.entities`
   *     └── newsroom       the masthead              `news.newsMediaOrganizations`
   *           └── source   the feed endpoint         `news.feedSources`
   *
   * A publishing house runs several mastheads and each masthead can be
   * delivered by several feeds, so the three counts are genuinely different
   * questions. This is the middle one. Measured live in the same window:
   * Kenya 27 sources across 24 newsrooms, South Africa 60 across 58, Zimbabwe
   * 37 across 35, Nigeria 71 across 70.
   *
   * ## The publisher level is NOT derivable from this data today
   *
   * `newsMediaOrganizations.entityId` exists, but measured on the live cluster
   * there are 537 organisations and 536 distinct entity ids — it is 1:1. The
   * Herald, Chronicle Zimbabwe, Manica Post, Sunday Mail and H-Metro are all
   * Zimpapers mastheads and every one carries a DIFFERENT `entityId`. So
   * grouping by entity would not group anything; a "publishers" count taken
   * from it would silently equal the newsroom count and read as a fact.
   * Nothing here claims a publisher count until the entity domain groups them.
   *
   * Counted from `mediaOrganizationId`. Articles whose organisation never
   * resolved collapse into a single `null` bucket rather than counting as one
   * newsroom each, so a resolution failure cannot inflate this.
   */
  newsrooms: number
}

/**
 * Every aggregation here is bounded, and none of them reads documents.
 *
 * Measured on the live cluster 2026-09-14: the `$group` these two functions
 * used to run could not be EXPLAINED inside 60 seconds — `executionStats` runs
 * the query, and it never came back. It opened with
 * `moderationStatus: {$ne: 'removed'}`, which no index carries, so every one of
 * the ~47,000 documents in the window had to be fetched to evaluate one field,
 * and then `$addToSet` held two sets per country across all of them.
 *
 * Nothing about that is survivable inside a Vercel function, so `getLiveCountries`
 * ALWAYS fell into its catch and returned `[]`. Callers then used
 * `FALLBACK_LIVE_COUNTRY_CODES` — which carries no per-country figures — so
 * `/discover` rendered "Coming soon" and "Browse news" on every country card,
 * and the coverage count came from a hardcoded floor rather than the corpus.
 * The page was not waiting on data that had yet to exist; it was showing the
 * failure state of a read that could never succeed.
 *
 * The replacement counts in the Atlas Search index instead, the same move
 * `insights.ts` and `analytics.ts` already made on this collection. It returns
 * in milliseconds.
 */
const COVERAGE_TIMEOUT_MS = 8000

/**
 * Highest number of distinct feed sources one window can report.
 *
 * 462 published in the last 30 days against 695 registered, so 1000 is roughly
 * double the live figure and above the registry total. If a window ever returns
 * exactly this many buckets the per-country source counts may be truncated — so
 * the caller checks, and degrades the counts rather than reporting short ones.
 */
const SOURCE_FACET_LIMIT = 1000

type CountryFacetBucket = { _id: unknown; count: number }
type CoverageMeta = {
  facet?: {
    country?: { buckets?: CountryFacetBucket[] }
    src?: { buckets?: CountryFacetBucket[] }
  }
}

/**
 * Per-country coverage for one window, busiest first.
 *
 * Two bounded round trips, because one cannot answer both halves:
 *
 *   1. `$searchMeta` facets the window by `countryCode` (the article count) and
 *      by `feedSourceId` (WHICH sources published). Exact, and index-only.
 *   2. Those source ids are resolved against `feedSources` — 695 rows — for the
 *      country and newsroom each belongs to.
 *
 * An Atlas Search facet counts documents per value; it cannot count the
 * DISTINCT sources behind them, and it cannot cross two facets. So the distinct
 * counts come from the join rather than from the index.
 *
 * The join is faithful because both collectors write an article's `countryCode`
 * from its source's own at ingestion, so the two agree by construction. The one
 * way they can drift is a source whose registered country was corrected after
 * it had already published: its older articles keep the country they were
 * stamped with, so the article count and the source count would attribute it to
 * different places. That is a handful of rows and it is visible in the data
 * (`countryCodeSource`), rather than a silent error.
 *
 * `sources`/`newsrooms` count only what actually PUBLISHED in the window, not
 * what is registered — measured today, Kenya has 29 sources publishing against
 * 44 registered. On a page about coverage, the registry figure would claim
 * reach the corpus is not currently delivering.
 */
async function countriesInWindow(since: Date): Promise<CoveredCountry[]> {
  const db = await getDb()

  const meta = await db
    .collection('articles')
    .aggregate<CoverageMeta>(
      [
        {
          $searchMeta: {
            index: 'articles_insights',
            facet: {
              operator: {
                compound: {
                  filter: [{ range: { path: 'datePublished', gte: since } }],
                  // `mustNot` is the exact semantics of `$ne`: it excludes the
                  // value AND keeps documents where the field is absent.
                  // `moderationStatus` is not mapped in this index, so that
                  // clause is inert today and becomes live the moment it is —
                  // see the same note in `analytics.ts`.
                  mustNot: [
                    { text: { path: 'status', query: 'rejected' } },
                    { text: { path: 'moderationStatus', query: 'removed' } },
                  ],
                },
              },
              facets: {
                // 54 AU member states plus whatever provenance has mis-stamped.
                country: { type: 'string', path: 'countryCode', numBuckets: 60 },
                src: { type: 'string', path: 'feedSourceId', numBuckets: SOURCE_FACET_LIMIT },
              },
            },
          },
        },
      ],
      { maxTimeMS: COVERAGE_TIMEOUT_MS }
    )
    .toArray()
    .then((rows) => rows[0])

  const countryBuckets = meta?.facet?.country?.buckets ?? []
  const sourceBuckets = meta?.facet?.src?.buckets ?? []
  if (!countryBuckets.length) return []

  const sourceIds = sourceBuckets
    .map((b) => String(b._id))
    .filter((id) => id && id !== 'null' && id !== 'undefined')

  // A truncated facet would under-report every country's source count. Report
  // no distinct counts at all rather than short ones — the article count is
  // still exact, and the card reads as fewer facts rather than wrong ones.
  const truncated = sourceBuckets.length >= SOURCE_FACET_LIMIT

  const sourceRows =
    sourceIds.length && !truncated
      ? await db
          .collection<{ _id: string; countryCode?: string; mediaOrganizationId?: string }>(
            'feedSources'
          )
          .find({ _id: { $in: sourceIds } }, { projection: { countryCode: 1, mediaOrganizationId: 1 } })
          .toArray()
      : []

  const sourcesByCountry = new Map<string, Set<string>>()
  const newsroomsByCountry = new Map<string, Set<string>>()
  for (const row of sourceRows) {
    const code = String(row.countryCode ?? '').trim().toUpperCase()
    if (!code) continue
    if (!sourcesByCountry.has(code)) sourcesByCountry.set(code, new Set())
    sourcesByCountry.get(code)!.add(row._id)
    // A source whose organisation never resolved is not counted as a newsroom
    // of its own, so a resolution failure cannot inflate the figure.
    if (row.mediaOrganizationId) {
      if (!newsroomsByCountry.has(code)) newsroomsByCountry.set(code, new Set())
      newsroomsByCountry.get(code)!.add(row.mediaOrganizationId)
    }
  }

  return countryBuckets
    .filter((b) => typeof b._id === 'string' && b._id.trim().length > 0)
    .map((b) => {
      const code = String(b._id).trim().toUpperCase()
      return {
        code,
        recent: Number(b.count),
        sources: sourcesByCountry.get(code)?.size ?? 0,
        newsrooms: newsroomsByCountry.get(code)?.size ?? 0,
      }
    })
    .sort((a, b) => b.recent - a.recent)
}

/**
 * Country codes ordered by article volume over the last `days`.
 *
 * Fail-soft like every other read here: an unreachable cluster yields an empty
 * list and the caller falls back to a static set, because an onboarding step
 * with no options at all is worse than one with stale options.
 */
export async function getTopCountriesByRecentVolume(
  limit = 6,
  days = 30
): Promise<CoveredCountry[]> {
  limit = clampInt(limit, 1, 24, 6)
  days = clampInt(days, 1, 365, 30)
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return (await countriesInWindow(since)).slice(0, limit)
  } catch (error) {
    console.error('[coverage.getTopCountriesByRecentVolume]', error)
    return []
  }
}

/**
 * The bar a country must clear to count as one Mukoko is aggregating from.
 *
 * A country is live when it published at least this many articles in the
 * trailing window. The bar exists because the alternative — "at least one
 * article" — would claim countries that are artefacts rather than coverage.
 * Measured on the live cluster (2026-09-10), 40 countries have at least one
 * article in 30 days, and the tail is Sudan on 8, Tunisia on 4 and Chad on 2.
 * Publishing "live in 40 African countries" off that tail would be false.
 *
 * 500/30 days is where the corpus actually breaks, and it has stayed there:
 *
 *   … CM 658 · ET 533 · LS 511 · TZ 505  |  SO 390 · GN 359 · RW 340 · MA 331 …
 *
 * The 17th country is 23% below the 16th. Any bar between 391 and 505 gives the
 * same answer today, so this is a real discontinuity rather than a number
 * chosen to land on a wanted total.
 *
 * These two are the ONLY policy knobs. Lower the bar and more countries are
 * claimed sooner; nothing else needs editing, and no country list needs
 * touching, because the list is a query result.
 */
export const LIVE_COUNTRY_MIN_RECENT_ARTICLES = 500
export const LIVE_COUNTRY_WINDOW_DAYS = 30

/**
 * Every country the platform is currently aggregating from, busiest first.
 *
 * This REPLACES a hand-maintained list of sixteen country codes. The list was
 * accurate when it was measured and would have been wrong the moment a new
 * source started producing — a country would have been live in the data and
 * "coming soon" on the site until somebody remembered to edit a constant. The
 * count is now a fact about the corpus, so a country that starts producing
 * appears on its own and one that goes dark drops off on its own.
 *
 * Fail-soft, and the failure mode matters more here than usual: an empty result
 * must never be rendered as "live in 0 African countries". Callers pair this
 * with `FALLBACK_LIVE_COUNTRY_CODES` and use the fallback whenever this comes
 * back empty — see `getLiveCoverageAction`.
 */
export async function getLiveCountries(): Promise<CoveredCountry[]> {
  // Filtered AFTER counting: the threshold is on the country's total, not on
  // any one article, so it cannot be pushed into the search filter.
  return (await getWindowCountries()).filter((r) => r.recent >= LIVE_COUNTRY_MIN_RECENT_ARTICLES)
}

/**
 * EVERY country with at least one article in the live window, busiest first.
 *
 * The same read `getLiveCountries` filters, unfiltered — because the threshold
 * answers a different question than a country card does.
 *
 * `LIVE_COUNTRY_MIN_RECENT_ARTICLES` is a policy bar for what the site may
 * CLAIM: "live in N African countries" has to mean something, and a country on
 * two articles is an artefact rather than coverage. But a card that says
 * "Coming soon" over a country the corpus holds 487 articles for is simply
 * wrong, and it is wrong in the direction that hides real work. Measured
 * 2026-09-14: 48 countries have articles in the window and 18 clear the bar, so
 * the old grid showed a placeholder over 30 countries it had real figures for —
 * Somalia on 487, Rwanda on 371, Libya on 293.
 *
 * So the claim keeps the bar and the grid does not. A country below it renders
 * its true counts; only a country with nothing at all says "Coming soon", which
 * is then the honest word for it.
 */
export async function getWindowCountries(): Promise<CoveredCountry[]> {
  try {
    const since = new Date(Date.now() - LIVE_COUNTRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    return await countriesInWindow(since)
  } catch (error) {
    console.error('[coverage.getWindowCountries]', error)
    return []
  }
}
