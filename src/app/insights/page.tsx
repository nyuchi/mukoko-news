import InsightsClient from './insights-client'
import { getInsightsBundleAction } from '@/lib/actions/insights'

// ISR: the dashboard is aggregate open-data — 10 minutes of staleness is fine,
// and the cached HTML paints immediately (server-rendered, no client spinner).
// The read layer never throws (each metric degrades to an empty-but-typed
// result), so a degraded cluster renders empty sections rather than a 500.
export const revalidate = 600

export default async function InsightsPage() {
  const data = await getInsightsBundleAction()
  return <InsightsClient data={data} />
}
