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
  find: ReturnType<typeof vi.fn>
}

/**
 * A chainable `find` cursor. `getCorpusSummary` takes the oldest and newest
 * article off each end of the `{datePublished:-1, status:1}` index rather than
 * aggregating a min/max over every document, so the stub has to survive
 * `.sort().limit().maxTimeMS().toArray()`.
 */
function findCursor(queue: unknown[][]) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.sort = self
  chain.limit = self
  chain.maxTimeMS = self
  chain.project = self
  chain.toArray = vi.fn(() => Promise.resolve(queue.length > 1 ? queue.shift() : (queue[0] ?? [])))
  return chain
}

function coll(overrides: Partial<Coll> = {}): Coll {
  return {
    aggregate: vi.fn(() => cursor([])),
    countDocuments: vi.fn().mockResolvedValue(0),
    distinct: vi.fn().mockResolvedValue([]),
    find: vi.fn(() => findCursor([[]])),
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
  /** The shape `$searchMeta` returns for a string facet. */
  const facetRows = (buckets: Array<{ _id: unknown; count: number }>) =>
    cursor([{ facet: { country: { buckets } } }])

  it('maps country codes to names and computes shares', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(
      facetRows([
        { _id: 'ZW', count: 75 },
        { _id: 'ZA', count: 25 },
        { _id: 'XX', count: 3 },
      ])
    )
    useDb({ articles })

    const result = await getCountryCoverage()
    expect(result.total).toBe(103)
    expect(result.countries[0]).toEqual({ code: 'ZW', name: 'Zimbabwe', count: 75, share: 72.8 })
    // Unknown code keeps the raw code as its display name — a country missing
    // from our table is a gap in the table, not an absence of journalism.
    expect(result.countries[2]).toEqual({ code: 'XX', name: 'XX', count: 3, share: 2.9 })
  })

  it('asks Atlas Search, NOT a $group behind the $ne visibility filter', async () => {
    // This is the measured fix, not a style preference. The `$group` this
    // replaced opened with `{status:{$ne:'rejected'}}`, which no index can
    // serve: explained on the live cluster it scanned all 65,203 documents and
    // took 27.5 SECONDS — longer than the request it was serving was allowed
    // to live, which is why the page rendered "No data available yet".
    const articles = coll()
    articles.aggregate.mockReturnValue(facetRows([{ _id: 'ZW', count: 1 }]))
    useDb({ articles })

    await getCountryCoverage()
    const pipeline = articles.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(pipeline[0]).toHaveProperty('$searchMeta')
    expect(JSON.stringify(pipeline)).not.toContain('$ne')
  })

  it('bounds the read so a slow cluster degrades instead of hanging', async () => {
    // Unbounded, a slow read does not fail — it holds the serverless function
    // until the platform kills the whole request, which a reader sees as a
    // blank page rather than a degraded one.
    const articles = coll()
    articles.aggregate.mockReturnValue(facetRows([]))
    useDb({ articles })

    await getCountryCoverage()
    expect(articles.aggregate.mock.calls[0][1]).toMatchObject({ maxTimeMS: expect.any(Number) })
  })

  it('returns the empty shape when the read throws', async () => {
    vi.mocked(getDb).mockRejectedValue(new Error('down'))
    expect(await getCountryCoverage()).toEqual({ total: 0, countries: [] })
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

/**
 * Rebuilt 2026-09-11. The old implementation was one `$facet` behind the `$ne`
 * visibility filter plus a `distinct('countryCode', BASE_MATCH)` — two full
 * scans of a 1.5 GB collection. Measured on the live cluster: **27,529 ms** for
 * the cheaper half alone, 65,203 documents examined, zero index keys. The
 * Vercel function died first, the catch returned the empty summary, and the
 * page told the reader the corpus was empty.
 */
describe('getCorpusSummary', () => {
  function summaryDb({
    total = 1000,
    countries = ['ZW', 'ZA', 'KE', '', null],
    enriched = 750,
  }: { total?: number; countries?: unknown[]; enriched?: number } = {}) {
    const articles = coll()
    // 1: the $searchMeta count. 2: the countryCode $group.
    articles.aggregate
      .mockReturnValueOnce(cursor([{ count: { total } }]))
      .mockReturnValueOnce(cursor(countries.map((c) => ({ _id: c }))))
    articles.countDocuments.mockResolvedValue(enriched)
    articles.find
      .mockReturnValueOnce(findCursor([[{ datePublished: new Date('2025-01-01T00:00:00Z') }]]))
      .mockReturnValueOnce(findCursor([[{ datePublished: new Date('2026-06-30T00:00:00Z') }]]))
    const feedSources = coll()
    feedSources.countDocuments.mockResolvedValue(42)
    const newsMediaOrganizations = coll()
    newsMediaOrganizations.countDocuments.mockResolvedValue(30)
    useDb({ articles, feedSources, newsMediaOrganizations })
    return { articles }
  }

  it('reports totals, enrichment %, the date range and distinct countries', async () => {
    summaryDb()
    expect(await getCorpusSummary()).toEqual({
      ok: true,
      totalArticles: 1000,
      sources: 42,
      organizations: 30,
      // Blank and null codes are not countries.
      countries: 3,
      aiEnrichedPct: 75,
      // Deliberately not computed — see below.
      avgQualityScore: null,
      earliest: '2025-01-01T00:00:00.000Z',
      latest: '2026-06-30T00:00:00.000Z',
    })
  })

  it('counts the corpus with Atlas Search, exactly rather than as a bound', async () => {
    // `$searchMeta`'s default `count` is a LOWER BOUND. A headline figure that
    // is quietly an underestimate is worse than a slow one.
    const { articles } = summaryDb()
    await getCorpusSummary()
    const pipeline = articles.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>
    const meta = pipeline[0].$searchMeta as Record<string, unknown>
    expect(meta.count).toEqual({ type: 'total' })
  })

  it('counts countries with NO filter, so the query stays a covered index scan', async () => {
    // The whole fix in one assertion. `$group` on `countryCode` alone is a
    // DISTINCT_SCAN on `countryCode_1_feedSourceId_1`: 43 keys examined, ZERO
    // documents, 90 ms. Add `BASE_MATCH` and the same query becomes the 27.5
    // second collection scan — to exclude a set that is measurably empty
    // (an Atlas Search facet over `status` reports one bucket, `approved`,
    // 65,203 of 65,203).
    const { articles } = summaryDb()
    await getCorpusSummary()
    const pipeline = articles.aggregate.mock.calls[1][0] as Array<Record<string, unknown>>
    expect(pipeline).toEqual([{ $group: { _id: '$countryCode' } }])
  })

  it('does not claim an average quality score it cannot compute', async () => {
    // `qualityScore` has no index and no Atlas Search mapping, so averaging it
    // means reading every document. `0` would render as "this corpus scores
    // zero on quality"; null renders as "—, not computed yet".
    summaryDb()
    expect((await getCorpusSummary()).avgQualityScore).toBeNull()
  })

  it('marks a failed read as NOT ok, so nothing reports it as an empty corpus', async () => {
    // The bug this flag exists for: every figure is zero in both cases, and the
    // page rendered the failure as "No data available yet" over 65,203
    // articles. Zero is a number; a failure is not.
    vi.mocked(getDb).mockRejectedValue(new Error('down'))
    const result = await getCorpusSummary()
    expect(result.ok).toBe(false)
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
