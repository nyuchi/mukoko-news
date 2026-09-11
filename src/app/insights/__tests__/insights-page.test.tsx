import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import InsightsPage from '../page'
import type { InsightsBundle } from '@/lib/actions/insights'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Pages read via Server Actions — mock the insights action module (Rule 4).
const mockBundle = vi.fn()
vi.mock('@/lib/actions/insights', () => ({
  getInsightsBundleAction: () => mockBundle(),
}))

const bundle: InsightsBundle = {
  summary: {
    ok: true,
    totalArticles: 1234,
    sources: 10,
    organizations: 8,
    countries: 5,
    aiEnrichedPct: 60,
    avgQualityScore: 0.65,
    earliest: '2025-01-01T00:00:00.000Z',
    latest: '2026-06-30T00:00:00.000Z',
  },
  volume: { ok: true, days: 30, from: '2026-06-01', to: '2026-06-30', total: 200, series: [], topSources: [] },
  leaderboard: [],
  categories: { ok: true, totalAssignments: 0, coverage: 0, categories: [] },
  countries: { total: 0, countries: [] },
  sentiment: { ok: true, total: 0, coverage: 0, breakdown: [] },
  topics: [],
  generatedAt: '2026-07-02T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBundle.mockResolvedValue(bundle)
})

describe('InsightsPage (server component)', () => {
  it('awaits the bundle action and renders the dashboard', async () => {
    mockBundle.mockResolvedValue(bundle)
    render(await InsightsPage())
    expect(screen.getByRole('heading', { name: /Open Data/i })).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(mockBundle).toHaveBeenCalledOnce()
  })

  /**
   * The dashboard is OPEN DATA and takes no session input at all (owner
   * decision 2026-09-11 — *"open data behind a login is not correct"*). It was
   * split by session between 2026-09-01 and then, with anonymous visitors shown
   * only the corpus summary under a "Sign in for the full picture" card.
   *
   * Asserted structurally rather than by rendering an anonymous visitor,
   * because the gate that existed was not in `access.ts` — it was a direct
   * `isViewerSignedIn()` call, which is exactly why `access.test.ts` went on
   * asserting "no gate for insights" throughout the ten days there was one.
   */
  it('reads no session', async () => {
    const src = readFileSync(join(process.cwd(), 'src/app/insights/page.tsx'), 'utf8')
    expect(src).not.toMatch(/isViewerSignedIn|requireViewer|withAuth|useAuth/)
  })

  it('serves one cached copy to everybody rather than rendering per request', async () => {
    // The cache IS the anti-mining control: a scraper is answered by the CDN and
    // never reaches MongoDB. It is only safe while nothing varies by session —
    // hence the assertion above, which must fail first if that ever changes.
    const mod = await import('../page')
    expect(mod.revalidate).toBe(600)
    expect((mod as Record<string, unknown>).dynamic).toBeUndefined()
  })

  it('renders the breakdowns to a visitor with no session', async () => {
    render(await InsightsPage())
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.queryByText(/Sign in for the full picture/i)).not.toBeInTheDocument()
    expect(mockBundle).toHaveBeenCalledOnce()
  })
})
