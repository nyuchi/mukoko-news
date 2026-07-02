'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  BarChart3,
  Newspaper,
  Radio,
  Building2,
  Globe2,
  Sparkles,
  Gauge,
  CalendarRange,
  Download,
  ArrowUpDown,
  BadgeCheck,
  TrendingUp,
} from 'lucide-react'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { getCategoryEmoji } from '@/lib/constants'
import type { InsightsBundle } from '@/lib/actions/insights'

// ---------------------------------------------------------------------------
// Formatting helpers (pure — unit-testable)
// ---------------------------------------------------------------------------

export function formatNumber(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('en-US')
}

/** Title-case a lowercase slug/tag for display: "arts-culture" → "Arts Culture". */
export function humanize(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function formatDay(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// Fixed diverging semantics for sentiment — never color-alone, always labelled.
const SENTIMENT_STYLE: Record<string, { bar: string; label: string }> = {
  positive: { bar: 'bg-malachite', label: 'Positive' },
  negative: { bar: 'bg-destructive', label: 'Negative' },
  neutral: { bar: 'bg-text-tertiary', label: 'Neutral' },
  mixed: { bar: 'bg-gold', label: 'Mixed' },
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function StatTile({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: typeof Newspaper
  label: string
  value: string
  caption?: string
}) {
  return (
    <div className="bg-surface rounded-2xl p-5 border border-elevated">
      <Icon className="w-6 h-6 text-primary mb-3" aria-hidden="true" />
      <div className="text-2xl font-bold text-foreground font-mono">{value}</div>
      <div className="text-sm text-text-secondary">{label}</div>
      {caption && <div className="text-xs text-text-tertiary mt-1">{caption}</div>}
    </div>
  )
}

/** A single-hue horizontal magnitude bar list (category / country / topics). */
function BarList({
  items,
  colorClass = 'bg-primary',
  href,
}: {
  items: Array<{ key: string; label: string; value: number; share?: number; emoji?: string }>
  colorClass?: string
  href?: (key: string) => string
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ol className="space-y-2">
      {items.map((item) => {
        const pct = Math.max(2, Math.round((item.value / max) * 100))
        const row = (
          <div className="flex items-center gap-3">
            <div className="w-40 shrink-0 truncate text-sm text-foreground flex items-center gap-1.5">
              {item.emoji && <span aria-hidden="true">{item.emoji}</span>}
              <span className="truncate">{item.label}</span>
            </div>
            <div className="flex-1 h-3 rounded-full bg-elevated overflow-hidden">
              <div
                className={`h-full rounded-full ${colorClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="w-24 shrink-0 text-right text-xs text-text-secondary font-mono">
              {formatNumber(item.value)}
              {typeof item.share === 'number' && (
                <span className="text-text-tertiary"> · {item.share}%</span>
              )}
            </div>
          </div>
        )
        return (
          <li key={item.key}>
            {href ? (
              <Link
                href={href(item.key)}
                className="block rounded-lg hover:bg-elevated/50 transition-colors py-1"
              >
                {row}
              </Link>
            ) : (
              <div className="py-1">{row}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Inline SVG bar chart for the daily publishing volume (single-hue, tanzanite). */
function VolumeChart({ series }: { series: InsightsBundle['volume']['series'] }) {
  if (series.length === 0) return null
  const max = Math.max(1, ...series.map((p) => p.count))
  const n = series.length
  const gap = 0.25
  const barW = (100 - gap * (n - 1)) / n
  return (
    <div className="text-primary">
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="w-full h-40"
        role="img"
        aria-label={`Daily publishing volume over ${n} days, peaking at ${formatNumber(max)} articles`}
      >
        {series.map((p, i) => {
          const h = (p.count / max) * 38
          const x = i * (barW + gap)
          const y = 40 - h
          return (
            <rect
              key={p.date}
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, 0.4)}
              rx={0.4}
              fill="currentColor"
            >
              <title>{`${p.date}: ${formatNumber(p.count)} articles`}</title>
            </rect>
          )
        })}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leaderboard (client-sortable table)
// ---------------------------------------------------------------------------

type LeaderRow = InsightsBundle['leaderboard'][number]
type SortKey = 'name' | 'articleCount' | 'avgQualityScore' | 'avgWordCount' | 'countries' | 'lastPublished'

function SourceLeaderboard({ rows }: { rows: LeaderRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('articleCount')
  const [asc, setAsc] = useState(false)

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'countries':
          cmp = a.countries.length - b.countries.length
          break
        case 'lastPublished':
          cmp = (a.lastPublished ?? '').localeCompare(b.lastPublished ?? '')
          break
        default:
          cmp = (a[sortKey] as number) - (b[sortKey] as number)
      }
      return asc ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, asc])

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAsc((v) => !v)
    else {
      setSortKey(key)
      setAsc(key === 'name')
    }
  }

  const header = (key: SortKey, label: string, align = 'text-left') => (
    <th className={`px-3 py-2 ${align}`}>
      <button
        type="button"
        onClick={() => toggle(key)}
        className="inline-flex items-center gap-1 font-semibold text-text-secondary hover:text-foreground transition-colors"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <ArrowUpDown
          className={`w-3 h-3 ${sortKey === key ? 'text-primary' : 'text-text-tertiary'}`}
          aria-hidden="true"
        />
      </button>
    </th>
  )

  return (
    <div className="overflow-x-auto rounded-2xl border border-elevated">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-elevated/40">
          <tr>
            {header('name', 'Source')}
            {header('articleCount', 'Articles', 'text-right')}
            {header('avgQualityScore', 'Avg quality', 'text-right')}
            {header('avgWordCount', 'Avg words', 'text-right')}
            {header('countries', 'Countries', 'text-right')}
            {header('lastPublished', 'Last published', 'text-right')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.sourceId} className="border-t border-elevated hover:bg-elevated/30">
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground truncate max-w-[220px]">
                    {r.name}
                  </span>
                  {r.verified && (
                    <BadgeCheck
                      className="w-4 h-4 text-secondary shrink-0"
                      aria-label="Verified publisher"
                    />
                  )}
                </div>
                {r.organization && r.organization !== r.name && (
                  <div className="text-xs text-text-tertiary truncate max-w-[220px]">
                    {r.organization}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono text-foreground">
                {formatNumber(r.articleCount)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-text-secondary">
                {r.avgQualityScore > 0 ? r.avgQualityScore.toFixed(2) : '—'}
              </td>
              <td className="px-3 py-2 text-right font-mono text-text-secondary">
                {r.avgWordCount > 0 ? formatNumber(r.avgWordCount) : '—'}
              </td>
              <td className="px-3 py-2 text-right font-mono text-text-secondary">
                {r.countries.length > 0 ? r.countries.join(', ') : '—'}
              </td>
              <td className="px-3 py-2 text-right text-text-secondary whitespace-nowrap">
                {formatDay(r.lastPublished)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  title,
  caption,
  children,
}: {
  title: string
  caption?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-10">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        {caption && <p className="text-sm text-text-secondary mt-1">{caption}</p>}
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function InsightsClient({ data }: { data: InsightsBundle }) {
  const { summary, volume, leaderboard, categories, countries, sentiment, topics } = data

  const isEmpty =
    summary.totalArticles === 0 &&
    volume.total === 0 &&
    leaderboard.length === 0 &&
    categories.categories.length === 0 &&
    countries.countries.length === 0

  return (
    <ErrorBoundary
      fallback={
        <div className="p-8 text-center text-text-secondary">Failed to render insights</div>
      }
    >
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="w-8 h-8 text-primary" aria-hidden="true" />
            <h1 className="text-3xl font-bold text-foreground">Open Data &amp; Insights</h1>
          </div>
          <p className="text-text-secondary max-w-2xl">
            A live, public analytics view of the Mukoko News corpus — every figure is computed
            directly from the articles we aggregate across African newsrooms. Open data, free to
            download.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="/api/insights/export?format=json"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
              download
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              Download open data (JSON)
            </a>
            <a
              href="/api/insights/export?format=csv"
              className="inline-flex items-center gap-2 px-4 py-2 bg-surface border border-elevated text-foreground rounded-full text-sm font-medium hover:bg-elevated/50 transition-colors"
              download
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              Download tables (CSV)
            </a>
          </div>
        </header>

        {isEmpty ? (
          <div className="text-center py-16" role="status">
            <span className="text-6xl mb-4 block" aria-hidden="true">
              📊
            </span>
            <h3 className="text-lg font-semibold text-foreground mb-2">No data available yet</h3>
            <p className="text-text-secondary">
              Analytics will appear here once the corpus has been populated. Check back shortly.
            </p>
          </div>
        ) : (
          <>
            {/* Corpus summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
              <StatTile
                icon={Newspaper}
                label="Articles"
                value={formatNumber(summary.totalArticles)}
              />
              <StatTile icon={Radio} label="Sources" value={formatNumber(summary.sources)} />
              <StatTile
                icon={Building2}
                label="Publishers"
                value={formatNumber(summary.organizations)}
              />
              <StatTile
                icon={Globe2}
                label="Countries"
                value={formatNumber(summary.countries)}
              />
              <StatTile
                icon={Sparkles}
                label="AI-enriched"
                value={`${summary.aiEnrichedPct}%`}
                caption="of the corpus"
              />
              <StatTile
                icon={Gauge}
                label="Avg quality"
                value={summary.avgQualityScore > 0 ? summary.avgQualityScore.toFixed(2) : '—'}
                caption="0–1 quality score"
              />
              <StatTile
                icon={CalendarRange}
                label="Earliest"
                value={formatDay(summary.earliest)}
              />
              <StatTile icon={CalendarRange} label="Latest" value={formatDay(summary.latest)} />
            </div>

            {/* Publishing volume */}
            {volume.total > 0 && (
              <Section
                title="Publishing volume"
                caption={`${formatNumber(volume.total)} articles over the last ${volume.days} days (${formatDay(
                  volume.from
                )} – ${formatDay(volume.to)}).`}
              >
                <div className="bg-surface rounded-2xl border border-elevated p-5">
                  <VolumeChart series={volume.series} />
                  <div className="flex justify-between mt-2 text-xs text-text-tertiary font-mono">
                    <span>{formatDay(volume.from)}</span>
                    <span>{formatDay(volume.to)}</span>
                  </div>
                  {volume.topSources.length > 0 && (
                    <p className="text-xs text-text-secondary mt-4">
                      Most active sources in this window:{' '}
                      {volume.topSources
                        .slice(0, 5)
                        .map((s) => `${s.name} (${formatNumber(s.count)})`)
                        .join(', ')}
                      .
                    </p>
                  )}
                </div>
              </Section>
            )}

            {/* Source / organization leaderboard */}
            {leaderboard.length > 0 && (
              <Section
                title="Media organizations"
                caption="Sources ranked by output, with average article quality and length, countries covered and last-published time. Click a column to sort."
              >
                <SourceLeaderboard rows={leaderboard} />
              </Section>
            )}

            <div className="grid md:grid-cols-2 gap-10">
              {/* Category distribution */}
              {categories.categories.length > 0 && (
                <Section
                  title="Topic distribution"
                  caption={`Share of ${formatNumber(
                    categories.totalAssignments
                  )} category assignments — top ${categories.categories.length} cover ${categories.coverage}%.`}
                >
                  <BarList
                    colorClass="bg-cobalt"
                    href={(slug) => `/discover?category=${encodeURIComponent(slug)}`}
                    items={categories.categories.map((c) => ({
                      key: c.slug,
                      label: humanize(c.slug),
                      emoji: getCategoryEmoji(c.slug),
                      value: c.count,
                      share: c.share,
                    }))}
                  />
                </Section>
              )}

              {/* Country coverage */}
              {countries.countries.length > 0 && (
                <Section
                  title="Country coverage"
                  caption={`Articles by country of publication, across ${countries.countries.length} countries.`}
                >
                  <BarList
                    colorClass="bg-malachite"
                    items={countries.countries.slice(0, 15).map((c) => ({
                      key: c.code,
                      label: c.name,
                      value: c.count,
                      share: c.share,
                    }))}
                  />
                </Section>
              )}
            </div>

            {/* Sentiment breakdown */}
            {sentiment.breakdown.length > 0 && (
              <Section
                title="Sentiment"
                caption={`AI-assessed tone. Coverage: ${sentiment.coverage}% of the corpus is enriched with a sentiment label (${formatNumber(
                  sentiment.total
                )} articles) — the rest is not yet processed.`}
              >
                <div className="bg-surface rounded-2xl border border-elevated p-5 space-y-3">
                  {sentiment.breakdown.map((s) => {
                    const style = SENTIMENT_STYLE[s.sentiment] ?? {
                      bar: 'bg-text-tertiary',
                      label: humanize(s.sentiment),
                    }
                    return (
                      <div key={s.sentiment} className="flex items-center gap-3">
                        <div className="w-24 shrink-0 text-sm text-foreground">{style.label}</div>
                        <div className="flex-1 h-3 rounded-full bg-elevated overflow-hidden">
                          <div
                            className={`h-full rounded-full ${style.bar}`}
                            style={{ width: `${Math.max(2, s.share)}%` }}
                          />
                        </div>
                        <div className="w-28 shrink-0 text-right text-xs text-text-secondary font-mono">
                          {formatNumber(s.count)} · {s.share}%
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* Trending topics */}
            {topics.length > 0 && (
              <Section
                title="Trending topics"
                caption="Most-tagged topics across the last 7 days."
              >
                <div className="flex flex-wrap gap-2">
                  {topics.map((t) => (
                    <Link
                      key={t.tag}
                      href={`/search?q=${encodeURIComponent(t.tag)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-container-tanzanite text-on-container-tanzanite text-sm hover:opacity-90 transition-opacity"
                    >
                      <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                      {humanize(t.tag)}
                      <span className="font-mono text-xs opacity-70">{formatNumber(t.count)}</span>
                    </Link>
                  ))}
                </div>
              </Section>
            )}

            <footer className="mt-8 pt-6 border-t border-elevated text-xs text-text-tertiary">
              Figures are computed live from the Mukoko News corpus and cached for up to 10 minutes.
              Metrics over enriched subsets (sentiment, quality) are labelled with their coverage.
              Data generated {formatDay(data.generatedAt)}.
            </footer>
          </>
        )}
      </div>
    </ErrorBoundary>
  )
}
