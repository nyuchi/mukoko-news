'use server'

import { unstable_cache } from 'next/cache'

import { getLiveCountries } from '@/lib/mongodb/coverage'
import {
  FALLBACK_LIVE_COUNTRY_CODES,
  COUNTRY_SCOPE_TOTAL,
  coverageClaim,
  coverageFragment,
} from '@/lib/constants'

/**
 * What the site is allowed to say about its own coverage, resolved from data.
 *
 * `codes` is the set of countries currently clearing the aggregation bar,
 * busiest first; `count` is what every public claim interpolates. `stale` says
 * whether this came from the corpus or from the pinned fallback, so a caller
 * that cares (the sitemap does) can behave differently.
 */
export interface LiveCoverage {
  codes: readonly string[]
  count: number
  scopeTotal: number
  fragment: string
  claim: string
  /**
   * `true` when the live read returned nothing and the pinned fallback was
   * used instead. NOT an error the reader should ever see — the page renders
   * identically. It exists so machine-facing surfaces can decline to assert a
   * precise figure they did not actually measure.
   */
  stale: boolean
}

/**
 * How long a resolved coverage figure is reused.
 *
 * An hour. The number moves when a country crosses a 500-article/30-day
 * threshold, which is a timescale of days, so re-running the aggregation per
 * request would be pure waste on a 1.5 GB collection. An hour is also short
 * enough that a newly-live country appears the same working day, which is the
 * whole point of making it live.
 *
 * `unstable_cache` rather than a module-scope memo because this is read from
 * prerendered and ISR routes across separate render passes, where a
 * per-instance variable would not be shared.
 */
const COVERAGE_TTL_SECONDS = 3600

const loadCoverage = unstable_cache(
  async (): Promise<LiveCoverage> => {
    const live = await getLiveCountries()

    // An empty result means the read failed or the corpus is unreachable — NOT
    // that Mukoko covers nowhere. Rendering the honest zero here would put
    // "live in 0 African countries" into the page title, the NewsMediaOrganization
    // JSON-LD, llms.txt and the MCP server card, and answer engines would cache
    // it. The stale sixteen is a far smaller error than the confident zero.
    const stale = live.length === 0
    const codes: readonly string[] = stale
      ? FALLBACK_LIVE_COUNTRY_CODES
      : live.map((c) => c.code)

    const count = codes.length
    return {
      codes,
      count,
      scopeTotal: COUNTRY_SCOPE_TOTAL,
      fragment: coverageFragment(count),
      claim: coverageClaim(count),
      stale,
    }
  },
  ['live-coverage'],
  { revalidate: COVERAGE_TTL_SECONDS, tags: ['coverage'] }
)

/**
 * The live coverage figure. Safe to call from any server context.
 *
 * Never throws and never returns a zero count: `loadCoverage` already collapses
 * a failed read onto the pinned fallback, and this catch covers the cache layer
 * itself. A coverage claim is decoration on most pages and load-bearing on
 * none of them — it must not be able to fail a render.
 */
export async function getLiveCoverageAction(): Promise<LiveCoverage> {
  try {
    return await loadCoverage()
  } catch (error) {
    console.error('[coverage] falling back to the pinned country list:', error)
    const count = FALLBACK_LIVE_COUNTRY_CODES.length
    return {
      codes: FALLBACK_LIVE_COUNTRY_CODES,
      count,
      scopeTotal: COUNTRY_SCOPE_TOTAL,
      fragment: coverageFragment(count),
      claim: coverageClaim(count),
      stale: true,
    }
  }
}

/**
 * Is this country one we are currently aggregating from?
 *
 * Replaces the old synchronous `isReleasedCountry`, which read a hardcoded Set.
 * It is async now because the answer is a fact about the corpus rather than a
 * fact about the source tree — that is the cost of the number being true.
 *
 * Callers that need it for many codes at once should take `codes` from
 * `getLiveCoverageAction` and build their own Set instead of awaiting per code.
 */
export async function isLiveCountryAction(code: string | null | undefined): Promise<boolean> {
  const trimmed = code?.trim().toUpperCase()
  if (!trimmed) return false
  const { codes } = await getLiveCoverageAction()
  return codes.includes(trimmed)
}
