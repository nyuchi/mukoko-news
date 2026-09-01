import { getPublicInsightsAction, getInsightsBundleAction } from '@/lib/actions/insights'
import { isViewerSignedIn } from '@/lib/auth/guard'
import InsightsClient from './insights-client'

// Renders per request because the page varies by session: the corpus summary is
// public, the breakdowns below it are not. The 10-minute cache moved down to the
// DATA (`unstable_cache` in the actions) — caching the HTML here would serve one
// visitor's access level to the next, which is the classic way an auth gate on a
// cached page becomes decorative.
//
// The read layer never throws (each metric degrades to an empty-but-typed
// result), so a degraded cluster renders empty sections rather than a 500.
export const dynamic = 'force-dynamic'

export default async function InsightsPage() {
  const signedIn = await isViewerSignedIn()

  // An anonymous visitor's response never CONTAINS the gated figures — they are
  // not fetched, not serialized, and not hidden with CSS. "Rendered but not
  // displayed" would still ship the whole dataset in the RSC payload.
  if (!signedIn) {
    const publicData = await getPublicInsightsAction()
    return <InsightsClient summary={publicData.summary} detail={null} signedIn={false} />
  }

  const data = await getInsightsBundleAction()
  return <InsightsClient summary={data.summary} detail={data} signedIn />
}
