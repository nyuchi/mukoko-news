/**
 * Tests for the public /api/analytics/export route.
 *
 * This is an unauthenticated endpoint that renders text this platform does not
 * control — source names, bylines, and `aiKeywords`/`aiNamedEntities`, which
 * the enrichment model extracts from article bodies. So the CSV escaping is a
 * security boundary, not a formatting detail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { CorpusQueryResult } from '@/lib/mongodb/analytics'

const mockRunCorpusQuery = vi.fn()
vi.mock('@/lib/actions/analytics', () => ({
  runCorpusQueryAction: (...args: unknown[]) => mockRunCorpusQuery(...args),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  getRequestIp: vi.fn().mockReturnValue('127.0.0.1'),
}))

import { GET } from '../route'

function result(overrides: Partial<CorpusQueryResult> = {}): CorpusQueryResult {
  return {
    query: {
      q: 'accident',
      countries: ['ZW'],
      categories: [],
      sources: ['src-herald'],
      from: '2026-08-02',
      to: '2026-08-31',
      sentiments: ['negative'],
      minQuality: null,
      days: 30,
    },
    total: 2,
    usedSearchIndex: true,
    series: [{ date: '2026-08-31', count: 2 }],
    bySource: [{ sourceId: 'src-herald', name: 'The Herald', country: 'ZW', count: 2, share: 100 }],
    byCountry: [{ code: 'ZW', name: 'Zimbabwe', count: 2, share: 100, sources: 1 }],
    byCategory: [],
    byKeyword: [{ term: 'road safety', count: 2 }],
    byEntity: [{ name: 'Harare', type: 'LOCATION', count: 1 }],
    byAuthor: [{ name: 'Joshua Jere', count: 1 }],
    bylineCoverage: { covered: 1, coverage: 50 },
    sentiment: { positive: 0, neutral: 0, negative: 2, mixed: 0, covered: 2, coverage: 100 },
    quality: { avg: 0.6, covered: 2, coverage: 100 },
    sample: [],
    generatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

async function csv(url: string): Promise<string> {
  const res = await GET(new NextRequest(url))
  return res.text()
}

describe('/api/analytics/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunCorpusQuery.mockResolvedValue(result())
  })

  describe('formula injection', () => {
    it.each(['=HYPERLINK("http://evil","x")', '+1+1', '-1+1', '@SUM(A1)'])(
      'neutralises a cell starting with %s',
      async (payload) => {
        mockRunCorpusQuery.mockResolvedValue(
          result({ byKeyword: [{ term: payload, count: 1 }] })
        )
        const body = await csv('http://x/api/analytics/export?format=csv')
        // The dangerous lead character must not start the field a spreadsheet
        // parses. Assert on the neutralising apostrophe immediately before it,
        // rather than on the whole payload: a value containing quotes or commas
        // is ALSO RFC-4180 quoted and its inner quotes doubled, so it does not
        // survive verbatim.
        expect(body).not.toContain(`\n${payload[0]}`)
        expect(body).toMatch(new RegExp(`'\\${payload[0]}`))
      }
    )

    it('neutralises an injected source name and byline too', async () => {
      mockRunCorpusQuery.mockResolvedValue(
        result({
          bySource: [
            { sourceId: 's', name: '=cmd|\'/c calc\'!A0', country: 'ZW', count: 1, share: 100 },
          ],
          byAuthor: [{ name: '@evil', count: 1 }],
        })
      )
      const body = await csv('http://x/api/analytics/export?format=csv')
      expect(body).toContain("'=cmd|")
      expect(body).toContain("'@evil")
    })

    it('leaves an ordinary value untouched', async () => {
      const body = await csv('http://x/api/analytics/export?format=csv')
      expect(body).toContain('road safety')
      expect(body).not.toContain("'road safety")
    })
  })

  describe('RFC 4180 quoting', () => {
    it('quotes and doubles embedded quotes', async () => {
      mockRunCorpusQuery.mockResolvedValue(
        result({ byKeyword: [{ term: 'he said "hello", loudly', count: 1 }] })
      )
      const body = await csv('http://x/api/analytics/export?format=csv')
      expect(body).toContain('"he said ""hello"", loudly"')
    })

    it('quotes a value containing a newline', async () => {
      mockRunCorpusQuery.mockResolvedValue(
        result({ byKeyword: [{ term: 'line one\nline two', count: 1 }] })
      )
      const body = await csv('http://x/api/analytics/export?format=csv')
      expect(body).toContain('"line one\nline two"')
    })
  })

  describe('facets with no on-page consumer', () => {
    // The classifier's category cut and the mean quality score are computed by
    // every query. The console has no room for them, so the export is where
    // they are available — otherwise they are payload nobody can reach.
    it('emits the category breakdown', async () => {
      mockRunCorpusQuery.mockResolvedValue(
        result({ byCategory: [{ term: 'transport', count: 88 }] })
      )
      const body = await csv('http://x/api/analytics/export?format=csv')
      expect(body).toContain('## categories')
      expect(body).toContain('transport,88')
    })

    it('emits the quality score with its coverage', async () => {
      const body = await csv('http://x/api/analytics/export?format=csv')
      expect(body).toContain('## quality')
      expect(body).toContain('0.6,2,100')
    })

    it('forwards a numeric minQuality floor and records it in the header', async () => {
      mockRunCorpusQuery.mockResolvedValue(
        result({ query: { ...result().query, minQuality: 0.6 } })
      )
      const body = await csv('http://x/api/analytics/export?format=csv&minQuality=0.6')
      expect(mockRunCorpusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ minQuality: 0.6 })
      )
      expect(body).toContain('# min_quality,0.6')
    })

    it('does not send a floor when the param is absent', async () => {
      await csv('http://x/api/analytics/export?format=csv')
      expect(mockRunCorpusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ minQuality: undefined })
      )
    })
  })

  describe('provenance header', () => {
    it('records every filter that was applied, including sources and sentiments', async () => {
      // A file that omits filters from its own header misreports what it holds.
      const body = await csv('http://x/api/analytics/export?format=csv')
      expect(body).toContain('# term,accident')
      expect(body).toContain('# countries,ZW')
      expect(body).toContain('# sources,src-herald')
      expect(body).toContain('# sentiments,negative')
      expect(body).toContain('# total_articles,2')
    })
  })

  describe('filter forwarding', () => {
    it('passes source and sentiment filters through to the query', async () => {
      await csv(
        'http://x/api/analytics/export?q=accident&country=ZW&source=src-herald&sentiment=negative&format=csv'
      )
      expect(mockRunCorpusQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'accident',
          countries: ['ZW'],
          sources: ['src-herald'],
          sentiments: ['negative'],
        })
      )
    })
  })

  it('returns JSON by default', async () => {
    const res = await GET(new NextRequest('http://x/api/analytics/export'))
    expect(res.headers.get('content-type')).toContain('application/json')
    await expect(res.json()).resolves.toMatchObject({ total: 2 })
  })
})
