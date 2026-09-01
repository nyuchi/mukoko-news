import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import AnalyticsPage from '../page'
import type {
  CorpusQueryResult,
  CoverageConcentration,
  QueryFacets,
} from '@/lib/mongodb/analytics'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/analytics',
}))

// The page reads via Server Actions, so mock the action module (not mongodb/).
const mockRunCorpusQuery = vi.fn()
const mockGetQueryFacets = vi.fn()
const mockGetCoverageConcentration = vi.fn()
vi.mock('@/lib/actions/analytics', () => ({
  runCorpusQueryAction: (...args: unknown[]) => mockRunCorpusQuery(...args),
  getQueryFacetsAction: (...args: unknown[]) => mockGetQueryFacets(...args),
  getCoverageConcentrationAction: (...args: unknown[]) => mockGetCoverageConcentration(...args),
}))

const baseResult: CorpusQueryResult = {
  query: {
    q: 'accident',
    countries: ['ZW'],
    categories: [],
    sources: [],
    from: '2026-08-02',
    to: '2026-08-31',
    sentiments: [],
    minQuality: null,
    days: 30,
  },
  total: 412,
  usedSearchIndex: true,
  series: [
    { date: '2026-08-29', count: 10 },
    { date: '2026-08-30', count: 25 },
    { date: '2026-08-31', count: 17 },
  ],
  bySource: [
    { sourceId: 'src-herald', name: 'The Herald', country: 'ZW', count: 220, share: 53.4 },
    { sourceId: 'src-chron', name: 'Chronicle', country: 'ZW', count: 192, share: 46.6 },
  ],
  byCountry: [{ code: 'ZW', name: 'Zimbabwe', count: 412, share: 100, sources: 2 }],
  byCategory: [{ term: 'transport', count: 88 }],
  byKeyword: [
    { term: 'road safety', count: 140 },
    { term: 'kombi', count: 62 },
  ],
  byEntity: [
    { name: 'Harare', type: 'LOCATION', count: 90 },
    { name: 'ZRP', type: 'ORGANIZATION', count: 45 },
  ],
  byAuthor: [],
  bylineCoverage: { covered: 0, coverage: 0 },
  sentiment: {
    positive: 12,
    neutral: 90,
    negative: 140,
    mixed: 8,
    covered: 250,
    coverage: 60.7,
  },
  quality: { avg: 0.62, covered: 250, coverage: 60.7 },
  sample: [
    {
      id: 'a1',
      headline: 'Bus crash on Harare-Bulawayo road',
      description: 'Several injured.',
      source: 'The Herald',
      country: 'ZW',
      publishedAt: '2026-08-31T09:00:00.000Z',
      url: 'https://herald.co.zw/a1',
      sentiment: 'negative',
      qualityScore: 0.71,
    },
  ],
  generatedAt: '2026-09-01T00:00:00.000Z',
}

const baseFacets: QueryFacets = {
  countries: [
    { code: 'ZW', name: 'Zimbabwe', articles: 997 },
    { code: 'NG', name: 'Nigeria', articles: 4729 },
  ],
  categories: [{ slug: 'transport', articles: 300 }],
}

const baseConcentration: CoverageConcentration = {
  days: 30,
  from: '2026-08-02',
  to: '2026-08-31',
  countries: [
    {
      code: 'ZW',
      name: 'Zimbabwe',
      articles: 997,
      sources: 13,
      topSourceShare: 41,
      topSourceName: 'The Herald',
      hhi: 1800,
    },
    {
      code: 'LS',
      name: 'Lesotho',
      articles: 239,
      sources: 1,
      topSourceShare: 100,
      topSourceName: 'Lesotho Times',
      hhi: 10000,
    },
  ],
  uncovered: [{ code: 'BI', name: 'Burundi' }],
  singleSourceCount: 1,
}

async function renderPage(sp: Record<string, string | string[]> = {}) {
  return render(await AnalyticsPage({ searchParams: Promise.resolve(sp) }))
}

describe('AnalyticsPage (query console)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunCorpusQuery.mockResolvedValue(baseResult)
    mockGetQueryFacets.mockResolvedValue(baseFacets)
    mockGetCoverageConcentration.mockResolvedValue(baseConcentration)
  })

  it('forwards the URL query string to the corpus query action', async () => {
    await renderPage({ q: 'accident', country: 'ZW', from: '2026-08-02', to: '2026-08-31' })
    expect(mockRunCorpusQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'accident',
        countries: ['ZW'],
        from: '2026-08-02',
        to: '2026-08-31',
      })
    )
  })

  it('parses a repeated and a comma-joined country param the same way', async () => {
    await renderPage({ country: ['ZW', 'ZA,KE'] })
    expect(mockRunCorpusQuery).toHaveBeenCalledWith(
      expect.objectContaining({ countries: ['ZW', 'ZA', 'KE'] })
    )
  })

  it('renders the match total and the window it was computed over', async () => {
    await renderPage({ q: 'accident', country: 'ZW' })
    expect(screen.getByText('412 articles')).toBeInTheDocument()
    expect(screen.getByText(/30 days/)).toBeInTheDocument()
  })

  it('ranks topics from AI keywords, not feed categories', async () => {
    await renderPage({ q: 'accident' })
    expect(screen.getByText('road safety')).toBeInTheDocument()
    expect(screen.getByText('kombi')).toBeInTheDocument()
  })

  it('groups named entities by the type enrichment assigned', async () => {
    await renderPage({ q: 'accident' })
    expect(screen.getByText('Places')).toBeInTheDocument()
    expect(screen.getByText('Organizations')).toBeInTheDocument()
    expect(screen.getByText('Harare')).toBeInTheDocument()
  })

  it('states sentiment coverage rather than implying it covers the whole match', async () => {
    await renderPage({ q: 'accident' })
    expect(screen.getByText(/60.7% of the match/)).toBeInTheDocument()
    expect(screen.getByText(/excluded rather than counted as neutral/)).toBeInTheDocument()
  })

  it('says bylines are unavailable instead of ranking an empty list', async () => {
    await renderPage({ q: 'accident' })
    expect(screen.getByText('No bylines on this result')).toBeInTheDocument()
    expect(screen.getByText(/does not currently persist the author field/)).toBeInTheDocument()
  })

  it('reports byline coverage when some articles do carry one', async () => {
    mockRunCorpusQuery.mockResolvedValue({
      ...baseResult,
      byAuthor: [{ name: 'Joshua Jere', count: 3 }],
      bylineCoverage: { covered: 3, coverage: 0.7 },
    })
    await renderPage({ q: 'accident' })
    expect(screen.getByText('Joshua Jere')).toBeInTheDocument()
    expect(screen.getByText(/0.7\s*%\) carry a byline/)).toBeInTheDocument()
  })

  it('flags a country served by a single source', async () => {
    await renderPage({})
    const row = screen.getByText('Lesotho').closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Single source')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('100%')).toBeInTheDocument()
  })

  it('names the countries with no coverage at all', async () => {
    await renderPage({})
    expect(screen.getByText('1 countries have no coverage at all')).toBeInTheDocument()
    expect(screen.getByText(/Burundi/)).toBeInTheDocument()
  })

  it('warns when the text match fell back to a substring scan', async () => {
    mockRunCorpusQuery.mockResolvedValue({ ...baseResult, usedSearchIndex: false })
    await renderPage({ q: 'accident' })
    expect(screen.getByText(/full-text index unavailable/)).toBeInTheDocument()
  })

  it('carries the active query into the CSV export link', async () => {
    await renderPage({ q: 'accident', country: 'ZW' })
    const link = screen.getByText('Export CSV').closest('a')
    expect(link?.getAttribute('href')).toContain('/api/analytics/export')
    expect(link?.getAttribute('href')).toContain('q=accident')
    expect(link?.getAttribute('href')).toContain('country=ZW')
    expect(link?.getAttribute('href')).toContain('format=csv')
  })

  it('carries source and sentiment filters into the export link', async () => {
    // Regression: exportHref appended only q/country/category/from/to, so
    // arriving via a "Who is covering it" bar (/analytics?source=…) produced an
    // Export CSV link that downloaded the UNFILTERED corpus under a filename
    // implying it was the query on screen. The old test only asserted q and
    // country, so it could not see this.
    mockRunCorpusQuery.mockResolvedValue({
      ...baseResult,
      query: {
        ...baseResult.query,
        sources: ['newsdata-herald'],
        sentiments: ['negative'],
      },
    })
    await renderPage({ source: 'newsdata-herald', sentiment: 'negative' })
    const href = screen.getByText('Export CSV').closest('a')?.getAttribute('href') ?? ''
    expect(href).toContain('source=newsdata-herald')
    expect(href).toContain('sentiment=negative')
  })

  it('shows an empty state, and no export link, when nothing matched', async () => {
    mockRunCorpusQuery.mockResolvedValue({
      ...baseResult,
      total: 0,
      series: [],
      bySource: [],
      byCountry: [],
      byKeyword: [],
      byEntity: [],
      sample: [],
    })
    await renderPage({ q: 'zzzzz' })
    expect(screen.getByText('Nothing matched')).toBeInTheDocument()
    expect(screen.queryByText('Export CSV')).not.toBeInTheDocument()
  })

  it('links back to the insights headline view', async () => {
    await renderPage({})
    const link = screen.getByText('Insights').closest('a')
    expect(link).toHaveAttribute('href', '/insights')
  })
})
