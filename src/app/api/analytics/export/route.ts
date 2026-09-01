import { NextRequest, NextResponse } from 'next/server'
import { runCorpusQueryAction } from '@/lib/actions/analytics'
import { checkRateLimit, getRequestIp } from '@/lib/rate-limit'

/**
 * Export the result of one /analytics query.
 *
 * Public and read-only, like the Insights export — but the response depends on
 * the caller's filters, so it is NOT edge-cached across callers: two analysts
 * running different queries must not share a CDN entry. Rate-limited instead.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

/** Quote a CSV cell per RFC 4180 (wrap + double embedded quotes when needed). */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',')
}

type Result = Awaited<ReturnType<typeof runCorpusQueryAction>>

/**
 * One CSV document with labelled sections, mirroring the panels on the page so
 * a download is traceable back to what the analyst saw. The query itself is in
 * the header comments, so a shared file explains its own provenance.
 */
function toCsv(data: Result): string {
  const lines: string[] = []
  const q = data.query

  lines.push('# Mukoko News — Analytics query export')
  lines.push(`# generated,${data.generatedAt}`)
  lines.push(`# term,${csvCell(q.q ?? '(none)')}`)
  lines.push(`# countries,${csvCell(q.countries.join('|') || '(all)')}`)
  lines.push(`# categories,${csvCell(q.categories.join('|') || '(all)')}`)
  lines.push(`# from,${q.from}`)
  lines.push(`# to,${q.to}`)
  lines.push(`# total_articles,${data.total}`)
  lines.push(`# text_match,${data.usedSearchIndex ? 'atlas_search' : 'substring_fallback'}`)
  lines.push('')

  lines.push('## daily_volume')
  lines.push(csvRow(['date', 'article_count']))
  for (const p of data.series) lines.push(csvRow([p.date, p.count]))
  lines.push('')

  lines.push('## sources')
  lines.push(csvRow(['source_id', 'name', 'country', 'article_count', 'share_pct']))
  for (const s of data.bySource) {
    lines.push(csvRow([s.sourceId, s.name, s.country ?? '', s.count, s.share]))
  }
  lines.push('')

  lines.push('## countries')
  lines.push(csvRow(['country_code', 'country_name', 'article_count', 'share_pct', 'distinct_sources']))
  for (const c of data.byCountry) {
    lines.push(csvRow([c.code, c.name, c.count, c.share, c.sources]))
  }
  lines.push('')

  lines.push('## topics')
  lines.push(csvRow(['keyword', 'article_count']))
  for (const t of data.byKeyword) lines.push(csvRow([t.term, t.count]))
  lines.push('')

  lines.push('## named_entities')
  lines.push(csvRow(['name', 'type', 'article_count']))
  for (const e of data.byEntity) lines.push(csvRow([e.name, e.type, e.count]))
  lines.push('')

  // Coverage columns travel with the numbers so a downstream chart cannot
  // present an enriched-subset metric as if it covered the whole match.
  lines.push('## sentiment')
  lines.push(csvRow(['sentiment', 'article_count', 'coverage_pct_of_match']))
  for (const k of ['positive', 'neutral', 'negative', 'mixed'] as const) {
    lines.push(csvRow([k, data.sentiment[k], data.sentiment.coverage]))
  }
  lines.push('')

  lines.push('## bylines')
  lines.push(csvRow(['author', 'article_count']))
  for (const a of data.byAuthor) lines.push(csvRow([a.name, a.count]))
  lines.push(csvRow(['(articles with any byline)', data.bylineCoverage.covered]))
  lines.push('')

  return lines.join('\n')
}

function readList(sp: URLSearchParams, key: string): string[] {
  return sp
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean)
}

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request)
  if (!(await checkRateLimit(`analytics-export:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(RATE_LIMIT_WINDOW_MS / 1000) } }
    )
  }

  const sp = request.nextUrl.searchParams
  const format = (sp.get('format') || 'json').toLowerCase()

  try {
    // Every field is re-validated by the Server Action's safety schemas, so raw
    // query-string values are safe to forward.
    const data = await runCorpusQueryAction({
      q: sp.get('q') ?? undefined,
      countries: readList(sp, 'country'),
      categories: readList(sp, 'category'),
      sources: readList(sp, 'source'),
      sentiments: readList(sp, 'sentiment'),
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      sampleLimit: 100,
    })

    if (format === 'csv') {
      return new NextResponse(toCsv(data), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="mukoko-analytics-query.csv"',
        },
      })
    }

    return NextResponse.json(data, { status: 200 })
  } catch (error) {
    console.error('[/api/analytics/export]', error)
    return NextResponse.json({ error: 'Failed to build export' }, { status: 500 })
  }
}
