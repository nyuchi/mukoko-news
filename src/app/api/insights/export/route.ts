import { NextRequest, NextResponse } from 'next/server'
import { getInsightsBundleAction } from '@/lib/actions/insights'
import { checkRateLimit, getRequestIp } from '@/lib/rate-limit'

// Public, read-only open-data endpoint. Node runtime (MongoDB driver via the
// Server Action) and edge-cached: a fresh aggregate every 10 minutes matches
// the /insights page's ISR window.
export const runtime = 'nodejs'
export const revalidate = 600

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

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
  const ip = getRequestIp(request)
  if (!(await checkRateLimit(`insights-export:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(RATE_LIMIT_WINDOW_MS / 1000) } }
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
    return NextResponse.json({ error: 'Failed to build export' }, { status: 500 })
  }
}
