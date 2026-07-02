'use server'

/**
 * Server Actions for the public open-data Insights dashboard.
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
  const [summary, volume, leaderboard, categories, countries, sentiment, topics] =
    await Promise.all([
      getCorpusSummary(),
      getPublishingVolume({ days: 30 }),
      getSourceLeaderboard({ limit: 20 }),
      getCategoryDistribution(),
      getCountryCoverage(),
      getSentimentBreakdown(),
      getTopTopics({ limit: 12 }),
    ])
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
