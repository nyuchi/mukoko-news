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

/**
 * A `$searchMeta` reply: `count.total` plus one `facet.<name>.buckets` array.
 * Every panel below now reads this shape rather than a `$group` result, because
 * the `$group`s all opened with `BASE_MATCH` — whose `$ne` pair no index can
 * serve — and so read all 65,203 documents. Measured on the live cluster:
 * 27,529 ms, zero index keys. The panels never rendered.
 */
function metaCursor(total: number, facets: Record<string, Array<[string | Date, number]>>) {
  return cursor([
    {
      count: { total },
      facet: Object.fromEntries(
        Object.entries(facets).map(([name, buckets]) => [
          name,
          { buckets: buckets.map(([_id, count]) => ({ _id, count })) },
        ])
      ),
    },
  ])
}

describe('getPublishingVolume', () => {
  it('zero-fills a daily series across the window and sums the total', async () => {
    const today = new Date()
    const midnight = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    )
    const articles = coll()
    articles.aggregate.mockReturnValue(
      metaCursor(5, { day: [[midnight, 5]], source: [['src-1', 5]] })
    )
    const feedSources = coll()
    feedSources.find.mockReturnValue(findCursor([[{ _id: 'src-1', name: 'The Herald' }]]))
    useDb({ articles, feedSources })

    const result = await getPublishingVolume({ days: 7 })

    expect(result.ok).toBe(true)
    expect(result.days).toBe(7)
    expect(result.series).toHaveLength(7)
    expect(result.total).toBe(5)
    // Today's bucket carries the count; earlier days are zero-filled.
    expect(result.series[result.series.length - 1]).toEqual({ date: todayKey, count: 5 })
    expect(result.series[0].count).toBe(0)
    expect(result.topSources).toEqual([{ sourceId: 'src-1', name: 'The Herald', count: 5 }])
    // ONE round trip. A date facet's bucket id is its lower boundary and a
    // string facet's is the token, so one call carries the daily series and
    // the top-sources list together.
    expect(articles.aggregate).toHaveBeenCalledTimes(1)
  })

  it('counts days with a DATE FACET, not a $group over every document', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(metaCursor(0, { day: [], source: [] }))
    useDb({ articles })

    await getPublishingVolume({ days: 7 })
    const pipeline = articles.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>
    const meta = pipeline[0].$searchMeta as Record<string, unknown>
    expect(meta).toBeDefined()
    expect(JSON.stringify(pipeline)).not.toContain('$ne')
    // N days needs N+1 boundaries, or the last day is silently dropped.
    const facets = (meta.facet as { facets: Record<string, { boundaries: unknown[] }> }).facets
    expect(facets.day.boundaries).toHaveLength(8)
  })

  it('clamps an absurd day count and never throws', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(metaCursor(0, { day: [], source: [] }))
    useDb({ articles })
    const result = await getPublishingVolume({ days: 99999 })
    expect(result.days).toBe(365)
    expect(result.series).toHaveLength(365)
  })

  it('marks a failed read as NOT ok rather than an empty window', async () => {
    vi.mocked(getDb).mockRejectedValue(new Error('atlas down'))
    const result = await getPublishingVolume({ days: 30 })
    expect(result.ok).toBe(false)
    expect(result.total).toBe(0)
    expect(result.series).toEqual([])
    expect(result.topSources).toEqual([])
  })
})

describe('getSourceLeaderboard', () => {
  it('ranks by facet count and names sources from the small collections', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(
      metaCursor(160, { source: [['src-1', 120], ['src-2', 40]] })
    )
    const feedSources = coll()
    feedSources.find.mockReturnValue(
      findCursor([
        [
          { _id: 'src-1', name: 'The Herald', mediaOrganizationId: 'org-1', countryCode: 'ZW' },
          { _id: 'src-2', name: 'Nameless', countryCode: 'KE' },
        ],
      ])
    )
    const newsMediaOrganizations = coll()
    newsMediaOrganizations.find.mockReturnValue(
      findCursor([[{ _id: 'org-1', name: 'Zimpapers', verified: true }]])
    )
    useDb({ articles, feedSources, newsMediaOrganizations })

    const rows = await getSourceLeaderboard({ limit: 10 })

    expect(rows[0]).toMatchObject({
      sourceId: 'src-1',
      name: 'The Herald',
      organization: 'Zimpapers',
      verified: true,
      articleCount: 120,
      countries: ['ZW'],
    })
    expect(rows[1]).toMatchObject({ name: 'Nameless', verified: false, countries: ['KE'] })
  })

  it('does not claim averages a facet cannot compute', async () => {
    // A facet counts documents per value; it cannot average a field across
    // them, and averaging means the collection scan this panel was rewritten
    // to escape. `0` would render as "this newsroom scores zero on quality"
    // and "articles of zero words" — claims about a real publisher.
    const articles = coll()
    articles.aggregate.mockReturnValue(metaCursor(120, { source: [['src-1', 120]] }))
    useDb({ articles })

    const rows = await getSourceLeaderboard({ limit: 5 })
    expect(rows[0].avgQualityScore).toBeNull()
    expect(rows[0].avgWordCount).toBeNull()
    expect(rows[0].lastPublished).toBeNull()
  })

  it('still names a source it cannot resolve', async () => {
    // A source missing from `feedSources` still published the articles; the id
    // is a worse label than a name and a better one than nothing.
    const articles = coll()
    articles.aggregate.mockReturnValue(metaCursor(3, { source: [['src-orphan', 3]] }))
    useDb({ articles })
    const rows = await getSourceLeaderboard({ limit: 5 })
    expect(rows[0]).toMatchObject({ sourceId: 'src-orphan', name: 'src-orphan', articleCount: 3 })
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
      metaCursor(150, {
        category: [['politics', 60], ['business', 40], ['sport', 100]],
      })
    )
    useDb({ articles })

    const result = await getCategoryDistribution()
    expect(result.ok).toBe(true)
    // Every bucket comes back, so this is the true total rather than the sum
    // of a truncated head. Measured on the live corpus the field carries 52
    // distinct values — the platform's 40 interest categories mixed with the
    // 17-slug vocabulary the pipeline used before them — which is why the
    // request asks for 200 rather than the 50 a "closed set of 40" implies.
    expect(result.totalAssignments).toBe(200)
    expect(result.categories[0]).toEqual({ slug: 'sport', count: 100, share: 50 })
    expect(result.coverage).toBe(100)
  })

  it('reads the interest categories, which only the insights index maps', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(metaCursor(0, { category: [] }))
    useDb({ articles })

    await getCategoryDistribution()
    const meta = (articles.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>)[0]
      .$searchMeta as Record<string, unknown>
    expect(meta.index).toBe('articles_insights')
    const facets = (meta.facet as {
      facets: Record<string, { path: string; numBuckets: number }>
    }).facets
    expect(facets.category.path).toBe('engagement.interest_categories')
    // 52 distinct values live; a tight bucket list truncates the tail AND
    // understates the total every share is computed against.
    expect(facets.category.numBuckets).toBeGreaterThanOrEqual(60)
  })

  it('distinguishes an empty corpus from a failed read', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(metaCursor(0, { category: [] }))
    useDb({ articles })
    expect(await getCategoryDistribution()).toEqual({
      ok: true,
      totalAssignments: 0,
      coverage: 0,
      categories: [],
    })

    vi.mocked(getDb).mockRejectedValue(new Error('down'))
    expect((await getCategoryDistribution()).ok).toBe(false)
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
  it('reports per-sentiment counts and corpus coverage from ONE round trip', async () => {
    // The facet gives the labels and `count: {type:'total'}` gives the
    // denominator, so coverage does not cost a second `countDocuments` — which
    // on this corpus was itself a full scan.
    const articles = coll()
    articles.aggregate.mockReturnValue(
      metaCursor(400, {
        sentiment: [['positive', 30], ['neutral', 50], ['negative', 20]],
      })
    )
    useDb({ articles })

    const result = await getSentimentBreakdown()
    expect(result.ok).toBe(true)
    expect(result.total).toBe(100)
    // 100 labelled out of 400 in the corpus = 25% coverage.
    expect(result.coverage).toBe(25)
    expect(result.breakdown[0]).toEqual({ sentiment: 'neutral', count: 50, share: 50 })
  })

  it('distinguishes an unlabelled corpus from a failed read', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(metaCursor(400, { sentiment: [] }))
    useDb({ articles })
    expect(await getSentimentBreakdown()).toEqual({
      ok: true,
      total: 0,
      coverage: 0,
      breakdown: [],
    })

    vi.mocked(getDb).mockRejectedValue(new Error('down'))
    expect((await getSentimentBreakdown()).ok).toBe(false)
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
      metaCursor(20, { topic: [['elections', 12], ['load-shedding', 8]] })
    )
    useDb({ articles })
    const result = await getTopTopics({ limit: 5 })
    expect(result).toEqual([
      { tag: 'elections', count: 12 },
      { tag: 'load-shedding', count: 8 },
    ])
  })

  it('OVER-fetches, because the stopword filter runs after the counts', async () => {
    // "news", "featured" and the rest are frequent enough to fill a tight
    // bucket list on their own and leave the panel short of real subjects.
    const articles = coll()
    articles.aggregate.mockReturnValue(metaCursor(0, { topic: [] }))
    useDb({ articles })

    await getTopTopics({ limit: 10 })
    const meta = (articles.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>)[0]
      .$searchMeta as Record<string, unknown>
    const facets = (meta.facet as { facets: Record<string, { numBuckets: number }> }).facets
    expect(facets.topic.numBuckets).toBeGreaterThanOrEqual(60)
  })

  it('drops the boilerplate that would otherwise top the list', async () => {
    const articles = coll()
    articles.aggregate.mockReturnValue(
      metaCursor(100, { topic: [['news', 90], ['featured', 80], ['elections', 12]] })
    )
    useDb({ articles })
    expect(await getTopTopics({ limit: 5 })).toEqual([{ tag: 'elections', count: 12 }])
  })

  it('returns [] when the DB throws', async () => {
    vi.mocked(getDb).mockRejectedValue(new Error('down'))
    expect(await getTopTopics({ limit: 5 })).toEqual([])
  })
})
