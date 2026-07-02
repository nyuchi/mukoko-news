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
})

describe('InsightsPage (server component)', () => {
  it('awaits the bundle action and renders the dashboard', async () => {
    mockBundle.mockResolvedValue(bundle)
    render(await InsightsPage())
    expect(screen.getByRole('heading', { name: /Open Data/i })).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(mockBundle).toHaveBeenCalledOnce()
  })

  it('is configured for ISR with a 10-minute revalidate window', async () => {
    const mod = await import('../page')
    expect(mod.revalidate).toBe(600)
  })
})
