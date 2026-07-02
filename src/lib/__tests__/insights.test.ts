import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getPublishingVolume,
  getSourceLeaderboard,
  getCategoryDistribution,
  getCountryCoverage,
  getSentimentBreakdown,
  getCorpusSummary,
  getTopTopics,
} from '../mongodb/insights'
import { getDb } from '../mongodb/client'

vi.mock('../mongodb/client', () => ({ getDb: vi.fn() }))

/** A fake aggregation cursor whose toArray resolves the supplied rows. */
function cursor(rows: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(rows) }
}

type Coll = {
  aggregate: ReturnType<typeof vi.fn>
  countDocuments: ReturnType<typeof vi.fn>
  distinct: ReturnType<typeof vi.fn>
}

function coll(overrides: Partial<Coll> = {}): Coll {
  return {
    aggregate: vi.fn(() => cursor([])),
    countDocuments: vi.fn().mockResolvedValue(0),
    distinct: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

function useDb(collections: Record<string, Coll>) {
  const db = {
    collection: vi.fn((name: string) => {
      if (!collections[name]) collections[name] = coll()
      return collections[name]
    }),
  }
  vi.mocked(getDb).mockResolvedValue(db as unknown as never)
  return collections
}

const todayKey = new Date().toISOString().slice(0, 10)

beforeEach(() => {
  vi.mocked(getDb).mockReset()
})

describe('getPublishingVolume', () => {
  it('zero-fills a daily series across the window and sums the total', async () => {
    const articles = coll()
    articles.aggregate
      .mockReturnValueOnce(cursor([{ _id: todayKey, count: 5 }])) // day grouping
      .mockReturnValueOnce(cursor([{ _id: 'src-1', count: 5, name: 'The Herald' }])) // top sources
    useDb({ articles })

    const result = await getPublishingVolume({ days: 7 })

    expect(result.days).toBe(7)
    expect(result.series).toHaveLength(7)
    expect(result.total).toBe(5)
    // Today's bucket carries the count; earlier days are zero-filled.
    expect(result.series[result.series.length - 1]).toEqual({ date: todayKey, count: 5 })
    expect(result.series[0].count).toBe(0)
    expect(result.topSources).toEqual([{ sourceId: 'src-1', name: 'The Herald', count: 5 }])
  })

  it('clamps an absurd day count and never throws', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(cursor([]))
    useDb({ articles })
    const result = await getPublishingVolume({ days: 99999 })
    expect(result.days).toBe(365)
    expect(result.series).toHaveLength(365)
  })

  it('returns an empty-but-typed result when the DB throws', async () => {
    vi.mocked(getDb).mockRejectedValue(new Error('atlas down'))
    const result = await getPublishingVolume({ days: 30 })
    expect(result.total).toBe(0)
    expect(result.series).toEqual([])
    expect(result.topSources).toEqual([])
  })
})

describe('getSourceLeaderboard', () => {
  it('maps grouped rows, joins names/orgs and resolves verification', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(
      cursor([
        {
          _id: 'src-1',
          articleCount: 120,
          avgQualityScore: 0.8123,
          avgWordCount: 640.6,
          countries: ['ZW', 'ZA', null, ''],
          lastPublished: new Date('2026-06-01T00:00:00Z'),
          source: [{ name: 'The Herald', mediaOrganizationId: 'org-1', countryCode: 'ZW' }],
          org: [{ name: 'Zimpapers', verified: true }],
        },
        {
          _id: 'src-2',
          articleCount: 40,
          avgQualityScore: null,
          avgWordCount: null,
          countries: [],
          lastPublished: null,
          source: [{ name: 'Nameless', countryCode: 'KE' }],
          org: [],
        },
      ])
    )
    useDb({ articles })

    const rows = await getSourceLeaderboard({ limit: 10 })

    expect(rows[0]).toMatchObject({
      sourceId: 'src-1',
      name: 'The Herald',
      organization: 'Zimpapers',
      verified: true,
      articleCount: 120,
      avgQualityScore: 0.812,
      avgWordCount: 641,
      countries: ['ZA', 'ZW'],
      lastPublished: '2026-06-01T00:00:00.000Z',
    })
    // Falls back to the source country code when article-level codes are absent.
    expect(rows[1]).toMatchObject({
      name: 'Nameless',
      verified: false,
      avgQualityScore: 0,
      avgWordCount: 0,
      countries: ['KE'],
      lastPublished: null,
    })
  })

  it('returns [] when the DB throws', async () => {
    vi.mocked(getDb).mockRejectedValue(new Error('down'))
    expect(await getSourceLeaderboard({ limit: 5 })).toEqual([])
  })
})

describe('getCategoryDistribution', () => {
  it('computes per-slug counts, shares and top-N coverage', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(
      cursor([
        {
          top: [
            { _id: 'politics', count: 60 },
            { _id: 'business', count: 40 },
          ],
          totals: [{ total: 200 }],
        },
      ])
    )
    useDb({ articles })

    const result = await getCategoryDistribution()
    expect(result.totalAssignments).toBe(200)
    expect(result.categories).toEqual([
      { slug: 'politics', count: 60, share: 30 },
      { slug: 'business', count: 40, share: 20 },
    ])
    // Top slugs cover (60+40)/200 = 50%.
    expect(result.coverage).toBe(50)
  })

  it('returns the empty shape when there are no assignments', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(cursor([{ top: [], totals: [] }]))
    useDb({ articles })
    const result = await getCategoryDistribution()
    expect(result).toEqual({ totalAssignments: 0, coverage: 0, categories: [] })
  })
})

describe('getCountryCoverage', () => {
  it('maps country codes to names and computes shares', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(
      cursor([
        { _id: 'ZW', count: 75 },
        { _id: 'ZA', count: 25 },
        { _id: 'XX', count: 0 },
      ])
    )
    useDb({ articles })

    const result = await getCountryCoverage()
    expect(result.total).toBe(100)
    expect(result.countries[0]).toEqual({ code: 'ZW', name: 'Zimbabwe', count: 75, share: 75 })
    // Unknown code keeps the raw code as its display name.
    expect(result.countries[2]).toEqual({ code: 'XX', name: 'XX', count: 0, share: 0 })
  })
})

describe('getSentimentBreakdown', () => {
  it('reports per-sentiment counts and corpus coverage', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(
      cursor([
        { _id: 'positive', count: 30 },
        { _id: 'neutral', count: 50 },
        { _id: 'negative', count: 20 },
      ])
    )
    articles.countDocuments.mockResolvedValue(400) // whole corpus
    useDb({ articles })

    const result = await getSentimentBreakdown()
    expect(result.total).toBe(100)
    // 100 enriched-with-sentiment out of 400 total = 25% coverage.
    expect(result.coverage).toBe(25)
    expect(result.breakdown[0]).toEqual({ sentiment: 'positive', count: 30, share: 30 })
  })

  it('returns the empty shape when nothing is enriched', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(cursor([]))
    articles.countDocuments.mockResolvedValue(400)
    useDb({ articles })
    const result = await getSentimentBreakdown()
    expect(result).toEqual({ total: 0, coverage: 0, breakdown: [] })
  })
})

describe('getCorpusSummary', () => {
  it('aggregates totals, enrichment %, avg quality, date range and distinct countries', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(
      cursor([
        {
          totalArticles: [{ n: 1000 }],
          aiEnriched: [{ n: 750 }],
          quality: [{ avg: 0.7266 }],
          range: [
            { earliest: new Date('2025-01-01T00:00:00Z'), latest: new Date('2026-06-30T00:00:00Z') },
          ],
        },
      ])
    )
    articles.distinct.mockResolvedValue(['ZW', 'ZA', 'KE', '', null])
    const feedSources = coll()
    feedSources.countDocuments.mockResolvedValue(42)
    const newsMediaOrganizations = coll()
    newsMediaOrganizations.countDocuments.mockResolvedValue(30)
    useDb({ articles, feedSources, newsMediaOrganizations })

    const result = await getCorpusSummary()
    expect(result).toEqual({
      totalArticles: 1000,
      sources: 42,
      organizations: 30,
      countries: 3,
      aiEnrichedPct: 75,
      avgQualityScore: 0.727,
      earliest: '2025-01-01T00:00:00.000Z',
      latest: '2026-06-30T00:00:00.000Z',
    })
  })

  it('returns the empty summary when the DB throws', async () => {
    vi.mocked(getDb).mockRejectedValue(new Error('down'))
    const result = await getCorpusSummary()
    expect(result.totalArticles).toBe(0)
    expect(result.earliest).toBeNull()
  })
})

describe('getTopTopics', () => {
  it('returns tag counts and clamps the limit', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(
      cursor([
        { _id: 'elections', count: 12 },
        { _id: 'load-shedding', count: 8 },
      ])
    )
    useDb({ articles })
    const result = await getTopTopics({ limit: 5 })
    expect(result).toEqual([
      { tag: 'elections', count: 12 },
      { tag: 'load-shedding', count: 8 },
    ])
  })

  it('returns [] when the DB throws', async () => {
    vi.mocked(getDb).mockRejectedValue(new Error('down'))
    expect(await getTopTopics({ limit: 5 })).toEqual([])
  })
})
