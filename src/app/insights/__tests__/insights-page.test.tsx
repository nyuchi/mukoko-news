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
const mockPublic = vi.fn()
vi.mock('@/lib/actions/insights', () => ({
  getInsightsBundleAction: () => mockBundle(),
  getPublicInsightsAction: () => mockPublic(),
}))

const mockSignedIn = vi.fn()
vi.mock('@/lib/auth/guard', () => ({
  isViewerSignedIn: () => mockSignedIn(),
}))

const bundle: InsightsBundle = {
  summary: {
    totalArticles: 1234,
    sources: 10,
    organizations: 8,
    countries: 5,
    aiEnrichedPct: 60,
    avgQualityScore: 0.65,
    earliest: '2025-01-01T00:00:00.000Z',
    latest: '2026-06-30T00:00:00.000Z',
  },
  volume: { days: 30, from: '2026-06-01', to: '2026-06-30', total: 200, series: [], topSources: [] },
  leaderboard: [],
  categories: { totalAssignments: 0, coverage: 0, categories: [] },
  countries: { total: 0, countries: [] },
  sentiment: { total: 0, coverage: 0, breakdown: [] },
  topics: [],
  generatedAt: '2026-07-02T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSignedIn.mockResolvedValue(true)
  mockPublic.mockResolvedValue({ summary: bundle.summary, generatedAt: bundle.generatedAt })
})

describe('InsightsPage (server component)', () => {
  it('awaits the bundle action and renders the dashboard', async () => {
    mockBundle.mockResolvedValue(bundle)
    render(await InsightsPage())
    expect(screen.getByRole('heading', { name: /Open Data/i })).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(mockBundle).toHaveBeenCalledOnce()
  })

  it('renders per request so the response can vary by session', async () => {
    // Regression guard: this page used ISR (`revalidate = 600`). Now that the
    // breakdowns are gated, a cached HTML page would serve one visitor's access
    // level to the next. The 10-minute window moved onto the DATA instead.
    const mod = await import('../page')
    expect(mod.dynamic).toBe('force-dynamic')
    expect((mod as Record<string, unknown>).revalidate).toBeUndefined()
  })

  describe('anonymous visitor', () => {
    beforeEach(() => mockSignedIn.mockResolvedValue(false))

    it('never fetches the gated bundle', async () => {
      render(await InsightsPage())
      expect(mockBundle).not.toHaveBeenCalled()
      expect(mockPublic).toHaveBeenCalledOnce()
    })

    it('still shows the public corpus summary', async () => {
      render(await InsightsPage())
      expect(screen.getByText('1,234')).toBeInTheDocument()
    })

    it('prompts for sign-in instead of the breakdowns', async () => {
      render(await InsightsPage())
      expect(screen.getByText(/Sign in for the full picture/i)).toBeInTheDocument()
    })
  })
})
