import { NextRequest, NextResponse } from 'next/server'
import { getInsightsBundleAction } from '@/lib/actions/insights'
import { checkRateLimit, getRequestIp } from '@/lib/rate-limit'

/**
 * The open-data export — PUBLIC, and defended by caching rather than by a login.
 *
 * ## Why the 401 came off (owner decision 2026-09-11)
 *
 * It was signed-in-only from 2026-09-01. The owner reversed it: *"open data
 * behind a login is not correct... that is not to gate free data, but those
 * should not be able to be mined by bots — have a security layer, it's public
 * data."* Both clauses are doing work.
 *
 * A login was the wrong instrument twice over. It contradicted the product —
 * this endpoint is linked from the dashboard as "Download open data", and open
 * data you must authenticate for is not open data. And it did not even solve
 * the problem it was there for: **a scraper can sign up.** An auth wall stops
 * researchers, answer engines and journalists, who will not; it does not stop a
 * determined miner, who will.
 *
 * ## What actually defends it
 *
 * The threat to public data is not that someone reads it — that is the point —
 * it is that reading it repeatedly costs US something. So the defence is to make
 * it cost nothing:
 *
 *  1. **The shared edge cache is the primary control.** `s-maxage=600` means a
 *     thousand scraped requests in ten minutes are answered a thousand times by
 *     Vercel's CDN and reach this function at most once. `stale-while-revalidate`
 *     keeps that true through the refresh. Mining becomes somebody else's
 *     bandwidth bill.
 *  2. **The rate limit guards the ORIGIN path** — the cache misses that do reach
 *     us. It stays deliberately fail-open (see `@/lib/rate-limit`): a limiter
 *     outage must not take a public endpoint down, and with the cache in front
 *     the blast radius of a fail-open window is small.
 *  3. **`robots.txt` disallows `/api/`**, so well-behaved crawlers never pull it
 *     incidentally. That is courtesy, not enforcement, and is not relied on.
 *  4. **The payload is bounded** by the clamps in `@/lib/mongodb/insights`.
 *     Public does not mean unbounded: an unclamped `limit` is a
 *     denial-of-service parameter whoever is holding it.
 *
 * ⚠️ Restoring the shared cache is only safe BECAUSE the response no longer
 * varies by session. The comment this replaced was right on its own terms — a
 * shared cache in front of an authenticated response lets the CDN hand one
 * signed-in caller's payload to the next anonymous one. That hazard is gone
 * with the gate, not in spite of it: there is now exactly one payload, and
 * everybody is entitled to it. If any per-caller field is ever added here, the
 * cache must come off in the same commit.
 *
 * ⚠️ No licence is asserted. Published open data should carry one (CC BY 4.0 is
 * the usual choice for aggregate datasets like this) and choosing it is the
 * owner's call, not a default to be picked here — so the export says nothing
 * about reuse terms rather than inventing permissive ones on a publisher's
 * behalf. Worth closing.
 */
export const runtime = 'nodejs'
export const revalidate = 600

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

/**
 * Shared-cacheable, because there is exactly one payload for every caller.
 *
 * `s-maxage` is the CDN's copy and the thing that absorbs bulk extraction;
 * `stale-while-revalidate` lets it keep serving while one request refreshes
 * behind it, so a scraper never causes a thundering herd on the database.
 */
const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800',
} as const

/** Quote a CSV cell per RFC 4180 (wrap + double embedded quotes when needed). */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',')
}

type Bundle = Awaited<ReturnType<typeof getInsightsBundleAction>>

/**
 * Build a single CSV document with three labelled sections — the source
 * leaderboard, topic distribution and country coverage tables.
 */
function toCsv(data: Bundle): string {
  const lines: string[] = []

  lines.push('# Mukoko News — Open Data export')
  lines.push(`# generated,${data.generatedAt}`)
  lines.push('')

  lines.push('## media_organizations')
  lines.push(
    csvRow([
      'source_id',
      'name',
      'organization',
      'verified',
      'article_count',
      'avg_quality_score',
      'avg_word_count',
      'countries',
      'last_published',
    ])
  )
  for (const r of data.leaderboard) {
    lines.push(
      csvRow([
        r.sourceId,
        r.name,
        r.organization ?? '',
        r.verified,
        r.articleCount,
        r.avgQualityScore,
        r.avgWordCount,
        r.countries.join('|'),
        r.lastPublished ?? '',
      ])
    )
  }
  lines.push('')

  lines.push('## topic_distribution')
  lines.push(csvRow(['slug', 'article_count', 'share_pct']))
  for (const c of data.categories.categories) {
    lines.push(csvRow([c.slug, c.count, c.share]))
  }
  lines.push('')

  lines.push('## country_coverage')
  lines.push(csvRow(['country_code', 'country_name', 'article_count', 'share_pct']))
  for (const c of data.countries.countries) {
    lines.push(csvRow([c.code, c.name, c.count, c.share]))
  }
  lines.push('')

  return lines.join('\n')
}

export async function GET(request: NextRequest) {
  // Guards the origin path only — the edge cache absorbs the repeat traffic
  // before it ever gets here. A 429 is NOT cached: it is about this caller, and
  // storing it shared would hand one abuser's rejection to every reader behind
  // the same CDN node.
  const ip = getRequestIp(request)
  if (!(await checkRateLimit(`insights-export:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'Retry-After': String(RATE_LIMIT_WINDOW_MS / 1000),
          'Cache-Control': 'private, no-store',
        },
      }
    )
  }

  const format = (request.nextUrl.searchParams.get('format') || 'json').toLowerCase()

  try {
    const data = await getInsightsBundleAction()

    if (format === 'csv') {
      return new NextResponse(toCsv(data), {
        status: 200,
        headers: {
          ...CACHE_HEADERS,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="mukoko-insights.csv"',
        },
      })
    }

    return NextResponse.json(data, { status: 200, headers: CACHE_HEADERS })
  } catch (error) {
    console.error('[/api/insights/export]', error)
    // Never cached: a cached 500 would outlive the outage that caused it.
    return NextResponse.json(
      { error: 'Failed to build export' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }
}
