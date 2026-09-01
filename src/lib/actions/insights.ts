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
import { requireViewer } from '@/lib/auth/guard'
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

export async function getPublishingVolumeAction(days = 30): Promise<PublishingVolume> {
  await requireViewer()
  return getPublishingVolume({ days })
}

export async function getSourceLeaderboardAction(limit = 20): Promise<SourceLeaderboardRow[]> {
  await requireViewer()
  return getSourceLeaderboard({ limit })
}

export async function getCategoryDistributionAction(): Promise<CategoryDistribution> {
  await requireViewer()
  return getCategoryDistribution()
}

export async function getCountryCoverageAction(): Promise<CountryCoverage> {
  await requireViewer()
  return getCountryCoverage()
}

export async function getSentimentBreakdownAction(): Promise<SentimentBreakdown> {
  await requireViewer()
  return getSentimentBreakdown()
}

export async function getCorpusSummaryAction(): Promise<CorpusSummary> {
  return getCorpusSummary()
}

export async function getTopTopicsAction(limit = 10): Promise<TopTopic[]> {
  await requireViewer()
  return getTopTopics({ limit })
}

/**
 * Aggregate everything the dashboard + open-data export need in one call, so
 * the page and the route share exactly one data contract.
 */
/** The slice anyone may read: corpus scale and span, nothing per-source. */
export interface PublicInsights {
  summary: CorpusSummary
  generatedAt: string
}

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

/** Public teaser — no auth. */
export async function getPublicInsightsAction(): Promise<PublicInsights> {
  return { summary: await cachedSummary(), generatedAt: new Date().toISOString() }
}

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

export async function getInsightsBundleAction(): Promise<InsightsBundle> {
  await requireViewer()
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
