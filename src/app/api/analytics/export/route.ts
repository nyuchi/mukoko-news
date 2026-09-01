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

/**
 * Tighter than the Insights export's 20/min, because this endpoint costs more
 * per call and cannot be shared.
 *
 * `/api/insights/export` is one fixed aggregate behind `s-maxage=600`, so the
 * CDN absorbs repeats. This one is per-caller by design (two analysts running
 * different queries must not share a CDN entry), so every request is a real
 * `$search`/`$match` + `$facet` over the matched slice.
 *
 * NOTE for operators: `checkRateLimit` enforces this globally only when
 * `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set. Without them it is an in-memory
 * per-instance window that FAILS OPEN, which on a multi-instance deployment is
 * a much weaker bound than this number suggests.
 */
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

/**
 * A cell a spreadsheet would execute as a formula.
 *
 * Excel, Sheets and LibreOffice evaluate a cell beginning `= + - @` (and, in
 * some locales, a leading tab/CR) as a formula on open. This export carries
 * text this platform does not control — source names, bylines, and `aiKeywords`
 * / `aiNamedEntities`, which the enrichment model extracts from article bodies.
 * A publisher who writes `=HYPERLINK("http://evil","x")` into an article can
 * therefore get it into a public CSV that fires when a reader opens it.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/

/**
 * Quote a CSV cell per RFC 4180, and neutralise spreadsheet formulas.
 *
 * The leading apostrophe is the conventional defence: spreadsheets treat the
 * rest as literal text and do not display the quote itself. Applied before
 * quoting so the apostrophe lands inside the quoted field.
 */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value)
  if (FORMULA_LEAD.test(s)) s = `'${s}`
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
  // Sources and sentiments are filters too — a file that omits them from its
  // own provenance header misreports what it contains.
  lines.push(`# sources,${csvCell(q.sources.join('|') || '(all)')}`)
  lines.push(`# sentiments,${csvCell(q.sentiments.join('|') || '(all)')}`)
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
