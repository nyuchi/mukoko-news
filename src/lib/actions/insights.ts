'use server'

/**
 * Server Actions for the Insights dashboard.
 *
 * ACCESS (owner decision 2026-09-01): the corpus SUMMARY is public — the
 * headline "how big is this and what does it span" figures that make the
 * open-data claim checkable. Everything below it — the source leaderboard, the
 * category and country breakdowns, sentiment, topics, the publishing series —
 * requires a signed-in account, as does the export that carries the same
 * numbers. Gating the page while leaving the actions or the export open would
 * be no gate at all, so the check lives in each action.
 *
 * These expose the read-only aggregations in `@/lib/mongodb/insights` to the
 * `/insights` page (server component) and, indirectly, to the open-data export
 * route. Per the repo's data-flow rule, reads go straight to the `news` DB via
 * Server Actions — never through the gateway Worker.
 *
 * Inputs are clamped in the MongoDB layer (clampInt); the read functions never
 * throw (each returns an empty-but-typed result on failure), so these thin
 * wrappers stay side-effect free and safe to call from cached server renders.
 */

import { unstable_cache } from 'next/cache'
import {
  getPublishingVolume,
  getSourceLeaderboard,
  getCategoryDistribution,
  getCountryCoverage,
  getSentimentBreakdown,
  getCorpusSummary,
  getTopTopics,
  type PublishingVolume,
  type SourceLeaderboardRow,
  type CategoryDistribution,
  type CountryCoverage,
  type SentimentBreakdown,
  type CorpusSummary,
  type TopTopic,
} from '@/lib/mongodb/insights'

/**
 * The per-panel reads. All PUBLIC, as of the owner's 2026-09-11 reversal —
 * *"open data behind a login is not correct"*.
 *
 * Every one of these carried `requireViewer()` and none does now. They are the
 * same aggregate counts the dashboard and the open-data export publish, so a
 * gate here would have contradicted the page while adding nothing: a Server
 * Action is a public RPC surface, and the figures it returns are already on the
 * page that calls it. Abuse is handled where it can be — at the edge cache and
 * the export's rate limit — not by asking a scraper to sign in.
 *
 * Inputs are still clamped in `@/lib/mongodb/insights`: public does not mean
 * unbounded, and an unclamped `limit` is a denial-of-service parameter.
 */
export async function getPublishingVolumeAction(days = 30): Promise<PublishingVolume> {
  return getPublishingVolume({ days })
}

export async function getSourceLeaderboardAction(limit = 20): Promise<SourceLeaderboardRow[]> {
  return getSourceLeaderboard({ limit })
}

export async function getCategoryDistributionAction(): Promise<CategoryDistribution> {
  return getCategoryDistribution()
}

export async function getCountryCoverageAction(): Promise<CountryCoverage> {
  return getCountryCoverage()
}

export async function getSentimentBreakdownAction(): Promise<SentimentBreakdown> {
  return getSentimentBreakdown()
}

export async function getCorpusSummaryAction(): Promise<CorpusSummary> {
  return getCorpusSummary()
}

export async function getTopTopicsAction(limit = 10): Promise<TopTopic[]> {
  return getTopTopics({ limit })
}

/**
 * Aggregate everything the dashboard + open-data export need in one call, so
 * the page and the route share exactly one data contract.
 */

/**
 * Cached so the dashboard keeps its old ISR cost profile now that the page must
 * render per-request to vary by session. Caching the DATA rather than the HTML
 * is what makes that safe: a cached page would serve one visitor's access level
 * to the next.
 */
const cachedSummary = unstable_cache(() => getCorpusSummary(), ['insights-summary'], {
  revalidate: 600,
  tags: ['insights'],
})

const cachedDetail = unstable_cache(
  () =>
    Promise.all([
      getPublishingVolume({ days: 30 }),
      getSourceLeaderboard({ limit: 20 }),
      getCategoryDistribution(),
      getCountryCoverage(),
      getSentimentBreakdown(),
      getTopTopics({ limit: 12 }),
    ]),
  ['insights-detail'],
  { revalidate: 600, tags: ['insights'] }
)


export interface InsightsBundle {
  summary: CorpusSummary
  volume: PublishingVolume
  leaderboard: SourceLeaderboardRow[]
  categories: CategoryDistribution
  countries: CountryCoverage
  sentiment: SentimentBreakdown
  topics: TopTopic[]
  generatedAt: string
}

/**
 * The whole open-data bundle, PUBLIC.
 *
 * It carried `requireViewer()` from 2026-09-01 until 2026-09-11, when the owner
 * reversed it: *"open data behind a login is not correct... that is not to gate
 * free data, but those should not be able to be mined by bots — have a security
 * layer, it's public data."* Both halves of that matter. A login is the wrong
 * instrument here — this project publishes the dashboard as open data and links
 * a download from it, and a sign-in wall contradicts the claim it is making.
 * Bulk extraction is a real concern, but it is an ABUSE problem, and the answer
 * is upstream of this function: the page and the export are edge-cached, so a
 * scraper is served by the CDN and never reaches MongoDB, and the uncached path
 * is rate-limited per IP. See `app/api/insights/export/route.ts`.
 */
export async function getInsightsBundleAction(): Promise<InsightsBundle> {
  const [summary, [volume, leaderboard, categories, countries, sentiment, topics]] =
    await Promise.all([cachedSummary(), cachedDetail()])
  return {
    summary,
    volume,
    leaderboard,
    categories,
    countries,
    sentiment,
    topics,
    generatedAt: new Date().toISOString(),
  }
}
