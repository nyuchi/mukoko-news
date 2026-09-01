import { redirect } from 'next/navigation'
import { isViewerSignedIn } from '@/lib/auth/guard'
import {
  runCorpusQueryAction,
  getQueryFacetsAction,
  getCoverageConcentrationAction,
} from '@/lib/actions/analytics'
import AnalyticsClient from './analytics-client'

// The console answers an arbitrary query from the URL, so it renders per
// request. `/insights` stays the ISR-cached headline view; this is the deep
// dive it links into.
//
// Signed-in only. `/insights` publishes a fixed set of aggregates; this answers
// an arbitrary query and returns sample articles, which is a queryable database
// rather than a published dataset. The redirect below is the affordance — the
// real gate is `requireViewer()` inside each Server Action, because an action id
// is POSTable without ever loading this page.
export const dynamic = 'force-dynamic'

/** Read a repeatable query-string value into a string[] (`?country=ZW&country=ZA` or `?country=ZW,ZA`). */
function readList(value: string | string[] | undefined): string[] {
  if (!value) return []
  const raw = Array.isArray(value) ? value : [value]
  return raw.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)
}

function readOne(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v?.trim() || undefined
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await isViewerSignedIn())) {
    // Preserve the query so a shared link survives the sign-in round trip: the
    // analyst lands back on the exact console they were sent, not on a blank one.
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(await searchParams)) {
      for (const v of Array.isArray(value) ? value : value ? [value] : []) qs.append(key, v)
    }
    const returnTo = qs.size ? `/analytics?${qs}` : '/analytics'
    redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`)
  }

  const sp = await searchParams

  const params = {
    q: readOne(sp.q),
    countries: readList(sp.country),
    categories: readList(sp.category),
    sources: readList(sp.source),
    from: readOne(sp.from),
    to: readOne(sp.to),
    sentiments: readList(sp.sentiment),
    sampleLimit: 20,
  }

  // All three reads are fail-soft (each returns an empty-but-typed result), so
  // a degraded cluster renders an empty console rather than a 500. Only the
  // corpus query actually depends on `params` — the facet list and the
  // concentration table are query-independent and cached inside their actions,
  // so a page view costs one aggregation, not three.
  const [result, facets, concentration] = await Promise.all([
    runCorpusQueryAction(params),
    getQueryFacetsAction(90),
    getCoverageConcentrationAction(30),
  ])

  return <AnalyticsClient result={result} facets={facets} concentration={concentration} />
}
