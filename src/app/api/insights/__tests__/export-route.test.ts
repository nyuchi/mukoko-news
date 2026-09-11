import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/insights/export/route'
import { getInsightsBundleAction } from '@/lib/actions/insights'

vi.mock('@/lib/actions/insights', () => ({
  getInsightsBundleAction: vi.fn(),
}))

// The bundle is signed-in only now, so the route is too. The guard wraps WorkOS,
// which cannot resolve under jsdom.
const mockSignedIn = vi.fn()
vi.mock('@/lib/auth/guard', () => ({
  isViewerSignedIn: () => mockSignedIn(),
}))

const bundle = {
  summary: {
    totalArticles: 1000,
    sources: 42,
    organizations: 30,
    countries: 3,
    aiEnrichedPct: 75,
    avgQualityScore: 0.73,
    earliest: '2025-01-01T00:00:00.000Z',
    latest: '2026-06-30T00:00:00.000Z',
  },
  volume: { days: 30, from: '2026-06-01', to: '2026-06-30', total: 500, series: [], topSources: [] },
  leaderboard: [
    {
      sourceId: 'src-1',
      name: 'The Herald, ZW',
      organization: 'Zimpapers',
      verified: true,
      articleCount: 120,
      avgQualityScore: 0.81,
      avgWordCount: 640,
      countries: ['ZW', 'ZA'],
      lastPublished: '2026-06-01T00:00:00.000Z',
    },
  ],
  categories: {
    totalAssignments: 200,
    coverage: 50,
    categories: [{ slug: 'politics', count: 60, share: 30 }],
  },
  countries: { total: 100, countries: [{ code: 'ZW', name: 'Zimbabwe', count: 75, share: 75 }] },
  sentiment: { total: 100, coverage: 25, breakdown: [{ sentiment: 'positive', count: 30, share: 30 }] },
  topics: [{ tag: 'elections', count: 12 }],
  generatedAt: '2026-07-02T00:00:00.000Z',
}

// Unique IP per test so the module-global rate-limit windows never collide.
let ipCounter = 0
function nextIp(): string {
  ipCounter += 1
  return `172.16.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`
}

function makeRequest(ip: string, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/insights/export${query}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  })
}

beforeEach(() => {
  mockSignedIn.mockReset()
  mockSignedIn.mockResolvedValue(true)
  vi.mocked(getInsightsBundleAction).mockReset()
  vi.mocked(getInsightsBundleAction).mockResolvedValue(bundle as never)
})

describe('GET /api/insights/export', () => {
  it('returns the full bundle as JSON to a signed-in caller', async () => {
    const res = await GET(makeRequest(nextIp()))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body).toEqual(bundle)
  })

  /**
   * Open data, served without a session (owner decision 2026-09-11 — *"open
   * data behind a login is not correct... that is not to gate free data, but
   * those should not be able to be mined by bots"*).
   *
   * The 401 that stood here from 2026-09-01 stopped researchers and answer
   * engines and did not stop a miner, who can simply sign up.
   */
  it('exports to a caller with no session', async () => {
    const res = await GET(makeRequest(nextIp()))
    expect(res.status).toBe(200)
    expect(getInsightsBundleAction).toHaveBeenCalled()
  })

  it('reads no session at all', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/insights/export/route.ts'),
      'utf8'
    ).replace(/\/\*[\s\S]*?\*\//g, ' ')
    expect(src).not.toMatch(/isViewerSignedIn|requireViewer|withAuth/)
  })

  /**
   * The shared cache IS the anti-mining control: a thousand scraped requests in
   * ten minutes are answered by the CDN and reach this function at most once, so
   * bulk extraction costs the platform nothing.
   *
   * It is only safe while the response does not vary by session, which is why
   * the assertion above sits directly before it — a future per-caller field must
   * fail THAT test first, and take this cache off in the same commit.
   */
  it('is shared-cacheable, because there is one payload for every caller', async () => {
    const res = await GET(makeRequest(nextIp()))
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('public')
    expect(cc).toContain('s-maxage=600')
    expect(cc).toContain('stale-while-revalidate')
  })

  /**
   * A 429 is about ONE caller. Stored in a shared cache it would hand a single
   * abuser's rejection to every reader behind the same CDN node — turning a
   * rate limit into an outage.
   */
  it('never shares a rate-limit rejection', async () => {
    const ip = nextIp()
    let rejected: Response | undefined
    for (let i = 0; i < 40; i++) {
      const res = await GET(makeRequest(ip))
      if (res.status === 429) {
        rejected = res
        break
      }
    }
    expect(rejected).toBeDefined()
    const cc = rejected!.headers.get('cache-control') ?? ''
    expect(cc).toContain('no-store')
    expect(cc).not.toContain('s-maxage')
    expect(rejected!.headers.get('retry-after')).toBe('60')
  })

  it('returns CSV with the three labelled tables when format=csv', async () => {
    const res = await GET(makeRequest(nextIp(), '?format=csv'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('mukoko-insights.csv')

    const text = await res.text()
    expect(text).toContain('## media_organizations')
    expect(text).toContain('## topic_distribution')
    expect(text).toContain('## country_coverage')
    // Header rows
    expect(text).toContain('source_id,name,organization,verified,article_count')
    expect(text).toContain('slug,article_count,share_pct')
    expect(text).toContain('country_code,country_name,article_count,share_pct')
    // Data rows — a comma inside a field is RFC-4180 quoted.
    expect(text).toContain('"The Herald, ZW"')
    expect(text).toContain('ZW|ZA')
    expect(text).toContain('politics,60,30')
    expect(text).toContain('ZW,Zimbabwe,75,75')
  })

  it('rate limits after 20 requests/minute per IP with a Retry-After header', async () => {
    const ip = nextIp()
    for (let i = 0; i < 20; i++) {
      const ok = await GET(makeRequest(ip))
      expect(ok.status).toBe(200)
    }
    const blocked = await GET(makeRequest(ip))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('60')
    expect(await blocked.json()).toEqual({ error: 'Too many requests' })
  })

  it('returns 500 when the aggregate build fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsBundleAction).mockRejectedValue(new Error('boom'))
    const res = await GET(makeRequest(nextIp()))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to build export' })
    consoleSpy.mockRestore()
  })
})
