'use client'

import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Download,
  Globe2,
  Loader2,
  Search,
  Tags,
  Users,
} from 'lucide-react'
import type {
  CorpusQueryResult,
  CoverageConcentration,
  QueryFacets,
  SeriesPoint,
  TermRow,
} from '@/lib/mongodb/analytics'
import { ErrorBoundary } from '@/components/ui/error-boundary'

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const nf = new Intl.NumberFormat('en-US')
const formatNumber = (n: number) => nf.format(n)

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// Presets — the questions an analyst actually arrives with
// ---------------------------------------------------------------------------

interface Preset {
  label: string
  href: string
}

const PRESETS: Preset[] = [
  { label: 'Accidents in Zimbabwe', href: '/analytics?q=accident&country=ZW' },
  { label: 'Corruption across Africa', href: '/analytics?q=corruption' },
  { label: 'Elections', href: '/analytics?q=election' },
  { label: 'Load shedding', href: '/analytics?q=load+shedding' },
  { label: 'Mining & minerals', href: '/analytics?q=mining' },
  { label: 'Health systems', href: '/analytics?q=hospital+OR+clinic+OR+health' },
  { label: 'Zimbabwe, all coverage', href: '/analytics?country=ZW' },
]

// ---------------------------------------------------------------------------
// Volume chart — one series, so no legend: the section title names it.
// ---------------------------------------------------------------------------

function VolumeChart({ series }: { series: SeriesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const W = 900
  const H = 200
  const PAD_TOP = 12
  const PAD_BOTTOM = 22

  const max = Math.max(1, ...series.map((p) => p.count))
  const stepX = series.length > 1 ? W / (series.length - 1) : W
  const plotH = H - PAD_TOP - PAD_BOTTOM

  const points = series.map((p, i) => ({
    x: i * stepX,
    y: PAD_TOP + plotH - (p.count / max) * plotH,
    ...p,
  }))

  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${points[0]?.x ?? 0},${H - PAD_BOTTOM} ${line} ${
    points[points.length - 1]?.x ?? 0
  },${H - PAD_BOTTOM}`

  // Four recessive gridlines give the eye a magnitude reference without competing
  // with the data. Values are labelled on the axis, not on every point.
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f))

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || series.length === 0) return
    const ratio = (e.clientX - rect.left) / rect.width
    setHover(Math.max(0, Math.min(series.length - 1, Math.round(ratio * (series.length - 1)))))
  }

  const active = hover !== null ? points[hover] : null

  if (series.length === 0) return null

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[200px] touch-none"
        role="img"
        aria-label={`Daily article volume, ${series.length} days, peak ${max}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {gridValues.map((v, i) => {
          const y = PAD_TOP + plotH - (i / 4) * plotH
          return (
            <g key={v + '-' + i}>
              <line
                x1={0}
                x2={W}
                y1={y}
                y2={y}
                stroke="var(--chart-grid)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text x={4} y={y - 4} className="fill-text-tertiary text-[10px] font-mono">
                {formatNumber(v)}
              </text>
            </g>
          )
        })}

        <polygon points={area} fill="var(--chart-primary)" opacity={0.14} />
        <polyline
          points={line}
          fill="none"
          stroke="var(--chart-primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active && (
          <g>
            <line
              x1={active.x}
              x2={active.x}
              y1={PAD_TOP}
              y2={H - PAD_BOTTOM}
              stroke="var(--chart-primary)"
              strokeWidth={1}
              opacity={0.5}
            />
            {/* 2px surface ring keeps the marker legible over the area fill. */}
            <circle
              cx={active.x}
              cy={active.y}
              r={5}
              fill="var(--chart-primary)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute -top-1 rounded-lg border border-elevated bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: `min(max(0px, ${(active.x / W) * 100}% - 60px), calc(100% - 130px))` }}
          role="status"
        >
          <div className="font-mono text-text-secondary">{formatDay(active.date)}</div>
          <div className="font-semibold text-foreground">
            {formatNumber(active.count)} article{active.count === 1 ? '' : 's'}
          </div>
        </div>
      )}

      <div className="mt-1 flex justify-between font-mono text-[11px] text-text-tertiary">
        <span>{formatDay(series[0].date)}</span>
        <span>{formatDay(series[series.length - 1].date)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Magnitude bar list — single hue, because these encode "how much", not identity.
// ---------------------------------------------------------------------------

interface BarItem {
  key: string
  label: string
  value: number
  meta?: string
  href?: string
}

function BarList({ items, total }: { items: BarItem[]; total: number }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.length === 0) {
    return <p className="text-sm text-text-tertiary">No data for this query.</p>
  }
  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const pct = (item.value / max) * 100
        const shareOfTotal = total > 0 ? (item.value / total) * 100 : 0
        const row = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-foreground">{item.label}</span>
              <span className="shrink-0 font-mono text-xs text-text-secondary">
                {formatNumber(item.value)}
                <span className="ml-1.5 text-text-tertiary">{shareOfTotal.toFixed(1)}%</span>
              </span>
            </div>
            {/* 6px track, 4px rounded data-end anchored at the baseline. */}
            <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(pct, 1.5)}%`, backgroundColor: 'var(--chart-primary)' }}
              />
            </div>
            {item.meta && <p className="mt-1 text-[11px] text-text-tertiary">{item.meta}</p>}
          </>
        )
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Sentiment — four states, so identity matters: legend + direct labels, never
// hue alone. Coverage is stated because it is computed over enriched articles only.
// ---------------------------------------------------------------------------

const SENTIMENT_SLOTS = [
  { key: 'positive', label: 'Positive', color: 'var(--chart-positive)' },
  { key: 'neutral', label: 'Neutral', color: 'var(--chart-neutral)' },
  { key: 'negative', label: 'Negative', color: 'var(--chart-negative)' },
  { key: 'mixed', label: 'Mixed', color: 'var(--chart-mixed)' },
] as const

function SentimentBar({ sentiment }: { sentiment: CorpusQueryResult['sentiment'] }) {
  const covered = sentiment.covered
  if (covered === 0) {
    return (
      <p className="text-sm text-text-tertiary">
        No article in this result set has been through AI enrichment yet, so there is no sentiment
        to report.
      </p>
    )
  }

  const segments = SENTIMENT_SLOTS.map((slot) => ({
    ...slot,
    count: sentiment[slot.key],
    pct: (sentiment[slot.key] / covered) * 100,
  })).filter((s) => s.count > 0)

  return (
    <div>
      {/* 2px surface gaps separate adjacent segments so the boundary reads even
          where two fills sit close under colour-vision deficiency. */}
      <div className="flex h-8 gap-[2px] overflow-hidden rounded-lg" role="img"
        aria-label={segments.map((s) => `${s.label} ${s.pct.toFixed(1)}%`).join(', ')}>
        {segments.map((s) => (
          <div
            key={s.key}
            className="flex items-center justify-center first:rounded-l-lg last:rounded-r-lg"
            style={{ width: `${s.pct}%`, backgroundColor: s.color }}
            title={`${s.label}: ${formatNumber(s.count)} (${s.pct.toFixed(1)}%)`}
          >
            {/* No text on the fill: 11px white measured 2.5-4.2:1 against these
                segment colours in both themes — below AA's 4.5:1, in a repo
                that targets AAA. The share is carried by the legend below,
                which sits on the page surface at full contrast, so identity
                and value are still never colour-alone. */}
          </div>
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {SENTIMENT_SLOTS.map((slot) => (
          <li key={slot.key} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: slot.color }}
              aria-hidden="true"
            />
            <span className="text-text-secondary">{slot.label}</span>
            <span className="font-mono text-text-tertiary">
              {formatNumber(sentiment[slot.key])}
              {covered > 0 && (
                <span className="ml-1">
                  ({((sentiment[slot.key] / covered) * 100).toFixed(0)}%)
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] text-text-tertiary">
        Computed over the {formatNumber(covered)} AI-enriched article
        {covered === 1 ? '' : 's'} in this result — {sentiment.coverage}% of the match. The rest
        have not been enriched yet and are excluded rather than counted as neutral.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Entity chips, grouped by the type the enrichment model assigned
// ---------------------------------------------------------------------------

const ENTITY_TYPE_LABELS: Record<string, string> = {
  PERSON: 'People',
  ORGANIZATION: 'Organizations',
  LOCATION: 'Places',
  EVENT: 'Events',
}

function EntityGroups({ entities }: { entities: CorpusQueryResult['byEntity'] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, CorpusQueryResult['byEntity']>()
    for (const e of entities) {
      const list = map.get(e.type) ?? []
      list.push(e)
      map.set(e.type, list)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [entities])

  if (grouped.length === 0) {
    return <p className="text-sm text-text-tertiary">No named entities extracted for this query.</p>
  }

  return (
    <div className="space-y-4">
      {grouped.map(([type, list]) => (
        <div key={type}>
          <h4 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            {ENTITY_TYPE_LABELS[type] ?? humanize(type)}
          </h4>
          <ul className="flex flex-wrap gap-1.5">
            {list.slice(0, 12).map((e) => (
              <li key={`${type}-${e.name}`}>
                <Link
                  href={`/analytics?q=${encodeURIComponent(e.name)}`}
                  className="inline-flex min-h-[var(--touch-chip)] items-center gap-1.5 rounded-full border border-elevated bg-elevated/40 px-3 text-xs text-foreground transition-colors hover:border-primary/50"
                >
                  {e.name}
                  <span className="font-mono text-text-tertiary">{formatNumber(e.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Coverage concentration — the "one newspaper per country" panel
// ---------------------------------------------------------------------------

function concentrationTone(row: CoverageConcentration['countries'][number]): {
  label: string
  className: string
} {
  if (row.sources === 1) {
    return { label: 'Single source', className: 'text-chart-negative' }
  }
  if (row.topSourceShare >= 60) {
    return { label: 'Highly concentrated', className: 'text-chart-mixed' }
  }
  if (row.topSourceShare >= 40) {
    return { label: 'Concentrated', className: 'text-text-secondary' }
  }
  return { label: 'Plural', className: 'text-chart-positive' }
}

function ConcentrationPanel({ data }: { data: CoverageConcentration }) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? data.countries : data.countries.slice(0, 12)

  if (data.countries.length === 0) {
    return <p className="text-sm text-text-tertiary">No coverage data for this window.</p>
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-elevated bg-surface p-3">
          <div className="text-xl font-bold text-foreground">{data.countries.length}</div>
          <div className="text-[11px] text-text-secondary">Countries with coverage</div>
        </div>
        <div className="rounded-xl border border-elevated bg-surface p-3">
          <div className="text-xl font-bold text-chart-negative">{data.singleSourceCount}</div>
          <div className="text-[11px] text-text-secondary">Served by one source</div>
        </div>
        <div className="rounded-xl border border-elevated bg-surface p-3">
          <div className="text-xl font-bold text-foreground">{data.uncovered.length}</div>
          <div className="text-[11px] text-text-secondary">Countries with none</div>
        </div>
        <div className="rounded-xl border border-elevated bg-surface p-3">
          <div className="text-xl font-bold text-foreground">{data.days}d</div>
          <div className="text-[11px] text-text-secondary">Window</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-elevated text-left text-xs text-text-tertiary">
              <th className="pb-2 font-medium">Country</th>
              <th className="pb-2 text-right font-medium">Articles</th>
              <th className="pb-2 text-right font-medium">Sources</th>
              <th className="pb-2 font-medium">Largest source</th>
              <th className="pb-2 text-right font-medium">Its share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = concentrationTone(row)
              return (
                <tr key={row.code} className="border-b border-elevated/60 last:border-0">
                  <td className="py-2">
                    <Link
                      href={`/analytics?country=${row.code}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {row.name}
                    </Link>
                    <span className={`ml-2 text-[11px] ${tone.className}`}>{tone.label}</span>
                  </td>
                  <td className="py-2 text-right font-mono text-text-secondary">
                    {formatNumber(row.articles)}
                  </td>
                  <td className="py-2 text-right font-mono text-text-secondary">{row.sources}</td>
                  <td className="max-w-[200px] truncate py-2 text-text-secondary">
                    {row.topSourceName}
                  </td>
                  <td className="py-2 text-right font-mono text-text-secondary">
                    {row.topSourceShare}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {data.countries.length > 12 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 min-h-[var(--touch-compact)] text-xs font-medium text-primary hover:underline"
        >
          {showAll ? 'Show fewer' : `Show all ${data.countries.length} countries`}
        </button>
      )}

      {data.uncovered.length > 0 && (
        <div className="mt-5 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
            {data.uncovered.length} countries have no coverage at all
          </p>
          <p className="text-xs text-text-secondary">
            {data.uncovered.map((c) => c.name).join(', ')}.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section shell
// ---------------------------------------------------------------------------

function Section({
  title,
  caption,
  icon: Icon,
  children,
}: {
  title: string
  caption?: string
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-elevated bg-surface p-5">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          {Icon && <Icon className="h-4 w-4 text-primary" />}
          {title}
        </h2>
        {caption && <p className="mt-1 text-xs text-text-secondary">{caption}</p>}
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function AnalyticsClient({
  result,
  facets,
  concentration,
}: {
  result: CorpusQueryResult
  facets: QueryFacets
  concentration: CoverageConcentration
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const { query } = result
  const [q, setQ] = useState(query.q ?? '')
  const [country, setCountry] = useState(query.countries[0] ?? '')
  const [category, setCategory] = useState(query.categories[0] ?? '')
  const [from, setFrom] = useState(query.from)
  const [to, setTo] = useState(query.to)

  /**
   * Serialize the ACTIVE query back to a query string.
   *
   * `sources` and `sentiments` must be carried even though the form has no
   * control for them: the "Who is covering it" panel links to
   * `/analytics?source=<id>`, and the page reads and applies both. Omitting
   * them made "Run" silently discard the filter the user had arrived with, and
   * made "Export CSV" download the *unfiltered* corpus under a filename
   * implying it was the query on screen — the file even misreported itself,
   * since the CSV's provenance header is built from the same params.
   */
  const buildParams = useCallback(
    (overrides?: { q?: string; country?: string; category?: string; from?: string; to?: string }) => {
      const sp = new URLSearchParams()
      const term = overrides?.q ?? query.q ?? ''
      if (term.trim()) sp.set('q', term.trim())

      const countries = overrides ? (overrides.country ? [overrides.country] : []) : query.countries
      for (const c of countries) sp.append('country', c)

      const categories = overrides ? (overrides.category ? [overrides.category] : []) : query.categories
      for (const c of categories) sp.append('category', c)

      // Not editable in the form, so they always come from the active query.
      for (const s of query.sources) sp.append('source', s)
      for (const s of query.sentiments) sp.append('sentiment', s)

      const fromValue = overrides?.from ?? query.from
      const toValue = overrides?.to ?? query.to
      if (fromValue) sp.set('from', fromValue)
      if (toValue) sp.set('to', toValue)
      return sp
    },
    [query]
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const sp = buildParams({ q, country, category, from, to })
    startTransition(() => router.push(`/analytics?${sp.toString()}`))
  }

  const exportHref = useMemo(() => {
    const sp = buildParams()
    sp.set('format', 'csv')
    return `/api/analytics/export?${sp.toString()}`
  }, [buildParams])

  const describeQuery = [
    query.q ? `“${query.q}”` : 'all articles',
    query.countries.length ? `in ${query.countries.join(', ')}` : null,
    query.categories.length ? `categorised ${query.categories.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' ')

  const keywordItems: BarItem[] = result.byKeyword.slice(0, 12).map((k: TermRow) => ({
    key: k.term,
    label: k.term,
    value: k.count,
    href: `/analytics?q=${encodeURIComponent(k.term)}`,
  }))

  return (
    <ErrorBoundary
      fallback={<div className="p-8 text-center text-text-secondary">Failed to render analytics</div>}
    >
      <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
        {/* Header */}
        <header className="mb-6">
          <div className="mb-2 flex items-center gap-3">
            <BarChart3 className="h-7 w-7 text-primary" aria-hidden="true" />
            <h1 className="text-3xl font-bold text-foreground">Analytics</h1>
          </div>
          <p className="max-w-2xl text-text-secondary">
            Query the corpus directly: any topic, any country, any window. Every figure is computed
            live from the articles we aggregate.{' '}
            <Link href="/insights" className="text-primary underline underline-offset-2">
              Insights
            </Link>{' '}
            is the headline view; this is the deep dive.
          </p>
        </header>

        {/* Query controls — one row above the charts */}
        <form
          onSubmit={submit}
          className="mb-4 rounded-2xl border border-elevated bg-surface p-4"
          role="search"
        >
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">Topic</span>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="accidents, corruption, elections…"
                  className="min-h-[var(--touch-a11y)] w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">Country</span>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="min-h-[var(--touch-a11y)] w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">All countries</option>
                {facets.countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({formatNumber(c.articles)})
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="min-h-[var(--touch-a11y)] w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">All categories</option>
                {facets.categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {humanize(c.slug)} ({formatNumber(c.articles)})
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={pending}
                className="inline-flex min-h-[var(--touch-default)] w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-60 md:w-auto"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="h-4 w-4" aria-hidden="true" />
                )}
                Run
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="min-h-[var(--touch-compact)] rounded-lg border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="min-h-[var(--touch-compact)] rounded-lg border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-primary"
              />
            </label>
          </div>
        </form>

        {/* Presets */}
        <ul className="mb-6 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                className="inline-flex min-h-[var(--touch-chip)] items-center rounded-full border border-elevated bg-surface px-3 text-xs text-text-secondary transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {p.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Result header */}
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-elevated pb-4">
          <div>
            <p className="text-2xl font-bold text-foreground">
              {formatNumber(result.total)} article{result.total === 1 ? '' : 's'}
            </p>
            <p className="text-sm text-text-secondary">
              {describeQuery} · {formatDay(query.from)} – {formatDay(query.to)} ({query.days} days)
              {query.q && !result.usedSearchIndex && (
                <span className="ml-2 text-warning">
                  · substring match (full-text index unavailable)
                </span>
              )}
            </p>
          </div>
          {result.total > 0 && (
            <a
              href={exportHref}
              className="inline-flex min-h-[var(--touch-compact)] items-center gap-2 rounded-full border border-elevated bg-surface px-4 text-xs font-medium text-foreground transition-colors hover:bg-elevated/50"
              download
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export CSV
            </a>
          )}
        </div>

        {result.total === 0 ? (
          <div className="py-16 text-center" role="status">
            <p className="mb-2 text-lg font-semibold text-foreground">Nothing matched</p>
            <p className="text-sm text-text-secondary">
              Try a broader term, a wider date range, or clear the country filter.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <Section
              title="Volume over time"
              caption={`Articles per day matching this query. Peak day: ${formatNumber(
                Math.max(...result.series.map((s) => s.count))
              )}.`}
            >
              <VolumeChart series={result.series} />
            </Section>

            <div className="grid gap-6 lg:grid-cols-2">
              <Section
                title="Who is covering it"
                caption="Sources ranked by article count, with each one's share of the match."
                icon={Building2}
              >
                <BarList
                  total={result.total}
                  items={result.bySource.slice(0, 12).map((s) => ({
                    key: s.sourceId,
                    label: s.name,
                    value: s.count,
                    meta: s.country ? `${s.country}` : undefined,
                    href: `/analytics?source=${encodeURIComponent(s.sourceId)}`,
                  }))}
                />
              </Section>

              <Section
                title="Where it is being covered"
                caption="Country of publication, with how many distinct sources contributed."
                icon={Globe2}
              >
                <BarList
                  total={result.total}
                  items={result.byCountry.slice(0, 12).map((c) => ({
                    key: c.code,
                    label: c.name,
                    value: c.count,
                    meta: `${c.sources} source${c.sources === 1 ? '' : 's'}`,
                    href: `/analytics?${query.q ? `q=${encodeURIComponent(query.q)}&` : ''}country=${c.code}`,
                  }))}
                />
              </Section>

              <Section
                title="Topics"
                caption="Ranked from AI-extracted keywords — not raw feed categories, which are mostly section boilerplate."
                icon={Tags}
              >
                <BarList total={result.total} items={keywordItems} />
              </Section>

              <Section
                title="Named entities"
                caption="People, organizations and places the enrichment model identified. Click to pivot the query."
              >
                <EntityGroups entities={result.byEntity} />
              </Section>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Section
                title="Sentiment"
                caption="How the enrichment model scored the tone of this coverage."
              >
                <SentimentBar sentiment={result.sentiment} />
              </Section>

              <Section title="Bylines" caption="Which journalists are credited on this coverage." icon={Users}>
                {result.byAuthor.length > 0 ? (
                  <>
                    <BarList
                      total={result.bylineCoverage.covered}
                      items={result.byAuthor.slice(0, 10).map((a) => ({
                        key: a.name,
                        label: a.name,
                        value: a.count,
                      }))}
                    />
                    <p className="mt-3 text-[11px] text-text-tertiary">
                      Only {formatNumber(result.bylineCoverage.covered)} of{' '}
                      {formatNumber(result.total)} matching articles ({result.bylineCoverage.coverage}
                      %) carry a byline, so this ranks a small slice — not the newsroom.
                    </p>
                  </>
                ) : (
                  <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
                    <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                      No bylines on this result
                    </p>
                    <p className="text-xs text-text-secondary">
                      The RSS ingestion path does not currently persist the author field, so almost
                      no article carries a byline. Author analytics stay unavailable until the
                      pipeline stores it.
                    </p>
                  </div>
                )}
              </Section>
            </div>

            <Section
              title="Coverage concentration"
              caption="How many outlets actually serve each country — and how much of it comes from just one. Independent of the query above."
              icon={Globe2}
            >
              <ConcentrationPanel data={concentration} />
            </Section>

            <Section title="Matching articles" caption="Most recent first.">
              <ul className="divide-y divide-elevated">
                {result.sample.map((a) => (
                  <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                    <Link
                      href={`/article/${a.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {a.headline}
                    </Link>
                    <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-text-tertiary">
                      <span>{a.source}</span>
                      {a.country && <span>{a.country}</span>}
                      {a.publishedAt && <span>{formatDay(a.publishedAt.slice(0, 10))}</span>}
                      {a.sentiment && <span>{a.sentiment}</span>}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
