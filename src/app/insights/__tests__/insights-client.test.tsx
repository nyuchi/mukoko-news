import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import InsightsClient, { formatNumber, humanize, formatDay } from '../insights-client'
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

const bundle: InsightsBundle = {
  summary: {
    totalArticles: 18081,
    sources: 42,
    organizations: 30,
    countries: 12,
    aiEnrichedPct: 75,
    avgQualityScore: 0.73,
    earliest: '2025-01-01T00:00:00.000Z',
    latest: '2026-06-30T00:00:00.000Z',
  },
  volume: {
    days: 30,
    from: '2026-06-01',
    to: '2026-06-30',
    total: 500,
    series: [
      { date: '2026-06-29', count: 10 },
      { date: '2026-06-30', count: 20 },
    ],
    topSources: [{ sourceId: 'src-1', name: 'The Herald', count: 120 }],
  },
  leaderboard: [
    {
      sourceId: 'src-1',
      name: 'The Herald',
      organization: 'Zimpapers',
      verified: true,
      articleCount: 120,
      avgQualityScore: 0.81,
      avgWordCount: 640,
      countries: ['ZW'],
      lastPublished: '2026-06-01T00:00:00.000Z',
    },
    {
      sourceId: 'src-2',
      name: 'Daily Maverick',
      verified: false,
      articleCount: 300,
      avgQualityScore: 0.7,
      avgWordCount: 800,
      countries: ['ZA'],
      lastPublished: '2026-06-15T00:00:00.000Z',
    },
  ],
  categories: {
    totalAssignments: 200,
    coverage: 50,
    categories: [{ slug: 'politics', count: 60, share: 30 }],
  },
  countries: {
    total: 100,
    countries: [{ code: 'ZW', name: 'Zimbabwe', count: 75, share: 75 }],
  },
  sentiment: {
    total: 100,
    coverage: 25,
    breakdown: [{ sentiment: 'positive', count: 30, share: 30 }],
  },
  topics: [{ tag: 'elections', count: 12 }],
  generatedAt: '2026-07-02T00:00:00.000Z',
}

const emptyBundle: InsightsBundle = {
  summary: {
    totalArticles: 0,
    sources: 0,
    organizations: 0,
    countries: 0,
    aiEnrichedPct: 0,
    avgQualityScore: 0,
    earliest: null,
    latest: null,
  },
  volume: { days: 30, from: '2026-06-01', to: '2026-06-30', total: 0, series: [], topSources: [] },
  leaderboard: [],
  categories: { totalAssignments: 0, coverage: 0, categories: [] },
  countries: { total: 0, countries: [] },
  sentiment: { total: 0, coverage: 0, breakdown: [] },
  topics: [],
  generatedAt: '2026-07-02T00:00:00.000Z',
}

describe('pure helpers', () => {
  it('formatNumber groups thousands and guards non-finite input', () => {
    expect(formatNumber(18081)).toBe('18,081')
    expect(formatNumber(NaN)).toBe('0')
  })
  it('humanize title-cases slugs', () => {
    expect(humanize('arts-culture')).toBe('Arts Culture')
  })
  it('formatDay renders a friendly date and handles null', () => {
    expect(formatDay(null)).toBe('—')
    expect(formatDay('2026-06-30T00:00:00.000Z')).toMatch(/2026/)
  })
})

describe('InsightsClient', () => {
  it('renders the corpus summary, sections and open-data links', () => {
    render(<InsightsClient data={bundle} />)

    expect(screen.getByRole('heading', { name: /Open Data/i })).toBeInTheDocument()
    expect(screen.getByText('18,081')).toBeInTheDocument()
    expect(screen.getByText('Media organizations')).toBeInTheDocument()
    expect(screen.getByText('Topic distribution')).toBeInTheDocument()
    expect(screen.getByText('Country coverage')).toBeInTheDocument()
    expect(screen.getByText('Sentiment')).toBeInTheDocument()

    const jsonLink = screen.getByRole('link', { name: /Download open data \(JSON\)/i })
    expect(jsonLink).toHaveAttribute('href', '/api/insights/export?format=json')
    const csvLink = screen.getByRole('link', { name: /Download tables \(CSV\)/i })
    expect(csvLink).toHaveAttribute('href', '/api/insights/export?format=csv')
  })

  it('labels sentiment with its coverage percentage (honest thin-data caveat)', () => {
    render(<InsightsClient data={bundle} />)
    expect(screen.getByText(/Coverage: 25% of the corpus/i)).toBeInTheDocument()
  })

  it('sorts the leaderboard when a column header is clicked', () => {
    render(<InsightsClient data={bundle} />)
    const table = screen.getByRole('table')
    const rowNames = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0].textContent)

    // Default sort is by article count desc → Daily Maverick (300) first.
    expect(rowNames()[0]).toContain('Daily Maverick')

    // Sort by source name asc → Daily Maverick before The Herald.
    fireEvent.click(screen.getByRole('button', { name: /Sort by Source/i }))
    expect(rowNames()[0]).toContain('Daily Maverick')

    // Sort by average words desc → Daily Maverick (800) first.
    fireEvent.click(screen.getByRole('button', { name: /Sort by Avg words/i }))
    expect(rowNames()[0]).toContain('Daily Maverick')
  })

  it('renders the empty state when the corpus has no data', () => {
    render(<InsightsClient data={emptyBundle} />)
    expect(screen.getByText('No data available yet')).toBeInTheDocument()
    // Download affordances remain available even when empty.
    expect(screen.getByRole('link', { name: /Download open data \(JSON\)/i })).toBeInTheDocument()
  })
})
