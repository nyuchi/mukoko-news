import { getInsightsBundleAction } from '@/lib/actions/insights'
import InsightsClient from './insights-client'

/**
 * The open-data dashboard — PUBLIC, and cached at the edge rather than gated.
 *
 * It was `force-dynamic` and split by session between 2026-09-01 and
 * 2026-09-11: anonymous visitors got the corpus summary and a "Sign in for the
 * full picture" card over everything else. The owner reversed that — *"open
 * data behind a login is not correct"* — and the reversal is what lets the
 * caching come back. Nothing varies by session any more, so one rendered copy
 * serves everybody.
 *
 * **That cache IS the anti-mining control.** A scraper pulling this page a
 * thousand times an hour is answered a thousand times by Vercel's edge and
 * reaches MongoDB at most once per window, so bulk extraction costs us nothing
 * and degrades nothing for readers. A login would not have stopped mining
 * anyway — a scraper can hold an account — it would only have hidden the data
 * from the researchers and answer engines this page exists to reach.
 *
 * The read layer never throws (each metric degrades to an empty-but-typed
 * result), so a degraded cluster renders empty sections rather than a 500.
 */
export const revalidate = 600

export default async function InsightsPage() {
  const data = await getInsightsBundleAction()
  return <InsightsClient summary={data.summary} detail={data} />
}
