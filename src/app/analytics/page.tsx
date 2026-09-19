import { viewerCanAccess } from '@/lib/auth/guard'
import {
  runCorpusQueryAction,
  runCorpusPreviewAction,
  getQueryFacetsAction,
  getCoverageConcentrationAction,
} from '@/lib/actions/analytics'
import AnalyticsClient from './analytics-client'
import AnalyticsPreview from './analytics-preview'

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

  // The funnel, not a wall.
  //
  // This used to `redirect('/sign-in?returnTo=…')`. The return trip was correct
  // and the redirect was still the wrong instrument: `/insights` is open and
  // links INTO here, so the moment a reader follows a topic to go deeper is
  // exactly the moment we replaced their page with a login form that does not
  // say what they were about to get. Asking someone to sign up for something
  // they have not been shown converts the ones who already trust us and nobody
  // else.
  //
  // So an anonymous reader now gets the console with their own query answered
  // from the cheap facet pass, and the panels that need the expensive pass are
  // shown as locked rather than hidden — the same "tease, do not vanish" rule
  // the AI summary gate follows. `returnTo` is still built and still exact; it
  // is carried on the unlock link instead of being forced on arrival.
  if (!(await viewerCanAccess('analytics-console'))) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      for (const v of Array.isArray(value) ? value : value ? [value] : []) qs.append(key, v)
    }
    const returnTo = qs.size ? `/analytics?${qs}` : '/analytics'
    // One read, and deliberately not the two cached ones: the controls and the
    // concentration table belong to the working console. A preview that shipped
    // the whole apparatus would be a worse page AND a bigger anonymous cost.
    const preview = await runCorpusPreviewAction(params)
    return <AnalyticsPreview preview={preview} returnTo={returnTo} />
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
