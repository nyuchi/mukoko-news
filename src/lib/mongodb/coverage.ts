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
    const db = await getDb()
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const rows = await db
      .collection('articles')
      .aggregate<{ _id: string; recent: number; sources: number; newsrooms: number }>([
        {
          $match: {
            status: { $ne: 'rejected' },
            moderationStatus: { $ne: 'removed' },
            datePublished: { $gte: since },
            countryCode: { $type: 'string', $ne: '' },
          },
        },
        {
          $group: {
            _id: '$countryCode',
            recent: { $sum: 1 },
            feedSources: { $addToSet: '$feedSourceId' },
            newsrooms: { $addToSet: '$mediaOrganizationId' },
          },
        },
        {
          $project: {
            recent: 1,
            sources: { $size: '$feedSources' },
            newsrooms: { $size: '$newsrooms' },
          },
        },
        { $sort: { recent: -1 } },
        { $limit: limit },
      ])
      .toArray()

    return rows.map((r) => ({
      code: String(r._id).trim().toUpperCase(),
      recent: r.recent,
      sources: r.sources,
      newsrooms: r.newsrooms,
    }))
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
  try {
    const db = await getDb()
    const since = new Date(Date.now() - LIVE_COUNTRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const rows = await db
      .collection('articles')
      .aggregate<{ _id: string; recent: number; sources: number; newsrooms: number }>([
        {
          $match: {
            status: { $ne: 'rejected' },
            moderationStatus: { $ne: 'removed' },
            datePublished: { $gte: since },
            countryCode: { $type: 'string', $ne: '' },
          },
        },
        {
          $group: {
            _id: '$countryCode',
            recent: { $sum: 1 },
            // Both sets on the same pass rather than extra queries: the
            // grouping is already the expensive part on a 1.5 GB collection,
            // and each set is bounded by the count for one country (71 at the
            // largest), not by the article count.
            feedSources: { $addToSet: '$feedSourceId' },
            newsrooms: { $addToSet: '$mediaOrganizationId' },
          },
        },
        {
          $project: {
            recent: 1,
            sources: { $size: '$feedSources' },
            newsrooms: { $size: '$newsrooms' },
          },
        },
        // Filter AFTER grouping: the threshold is on the country's total, not
        // on any one article, so it cannot be pushed into the $match.
        { $match: { recent: { $gte: LIVE_COUNTRY_MIN_RECENT_ARTICLES } } },
        { $sort: { recent: -1 } },
      ])
      .toArray()

    return rows.map((r) => ({
      code: String(r._id).trim().toUpperCase(),
      recent: r.recent,
      sources: r.sources,
      newsrooms: r.newsrooms,
    }))
  } catch (error) {
    console.error('[coverage.getLiveCountries]', error)
    return []
  }
}
