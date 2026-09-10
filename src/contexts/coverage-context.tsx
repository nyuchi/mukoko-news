'use client'

import { createContext, useContext, type ReactNode } from 'react'

import {
  COUNTRY_SCOPE_TOTAL,
  FALLBACK_LIVE_COUNTRY_CODES,
  coverageClaim,
  coverageFragment,
} from '@/lib/constants'
import type { LiveCoverage } from '@/lib/actions/coverage'

/**
 * The live coverage figure, resolved once per render pass and shared.
 *
 * ## Why a context rather than a fetch per component
 *
 * Four client components state the coverage claim — `/about`, `/discover`,
 * `/sources` and the WebMCP tool descriptions. Each could call the Server
 * Action itself, but that is four round trips for one number that is identical
 * across all of them, on a platform whose readers are mostly on metered African
 * mobile connections. Worse, they would resolve at different moments, so a
 * reader could briefly see two different counts on the same screen.
 *
 * The root layout is a Server Component and can await the value during its own
 * render, so it resolves once and every client component below reads it
 * synchronously. No fetch, no waterfall, no flash of a stale number.
 *
 * ## This does not make the app dynamic
 *
 * `getLiveCoverageAction` reads through `unstable_cache`, not through `cookies()`
 * or `headers()`. Awaiting it in the root layout is a cached data read, so
 * routes stay statically renderable — unlike `withAuth()`, which is deliberately
 * kept out of the root layout for exactly that reason (see `user-avatar.tsx`).
 */
const CoverageContext = createContext<LiveCoverage | null>(null)

export function CoverageProvider({
  value,
  children,
}: {
  value: LiveCoverage
  children: ReactNode
}) {
  return <CoverageContext.Provider value={value}>{children}</CoverageContext.Provider>
}

/**
 * The coverage figure for a client component.
 *
 * Falls back to the pinned constant rather than throwing when no provider is
 * present. A missing provider is a wiring mistake, and the cost of that mistake
 * should be a slightly stale number in one paragraph — not a crashed page tree.
 * Tests that render a single component in isolation get the same treatment.
 */
export function useCoverage(): LiveCoverage {
  const value = useContext(CoverageContext)
  if (value) return value

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
