import Link from 'next/link'
import { AlertCircle, Globe, Layers, Newspaper, Radio, TrendingUp } from 'lucide-react'
import {
  getStatsAction,
  getTrendingCategoriesAction,
  getSourcesAction,
} from '@/lib/actions/feed'
import { COUNTRIES, getCategoryEmoji } from '@/lib/constants'

export const metadata = { title: 'Open Analytics' }

// Server Component — reads via Server Actions → MongoDB (news DB), the same
// path every other page uses. No client fetch, no phantom API route.
export const dynamic = 'force-dynamic'

interface TrendingCategory {
  id: string
  name: string
  slug: string
  article_count: number
}

interface CountryCount {
  country: string
  count: number
}

const COUNTRY_NAMES = new Map<string, string>(COUNTRIES.map((c) => [c.code, c.name]))

export default async function AnalyticsPage() {
  let stats: Awaited<ReturnType<typeof getStatsAction>> | null = null
  let trending: TrendingCategory[] = []
  let countryBreakdown: CountryCount[] = []
  let loadError = false

  try {
    const [statsResult, trendingResult, sources] = await Promise.all([
      getStatsAction(),
      getTrendingCategoriesAction(12),
      getSourcesAction(),
    ])
    stats = statsResult
    trending = trendingResult

    // Articles per country, aggregated from each active source's article count.
    const byCountry = new Map<string, number>()
    for (const source of sources) {
      if (!source.country_id) continue
      byCountry.set(source.country_id, (byCountry.get(source.country_id) ?? 0) + (source.article_count ?? 0))
    }
    countryBreakdown = [...byCountry.entries()]
      .map(([country, count]) => ({ country, count }))
      .filter(({ count }) => count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
  } catch (err) {
    console.error('[/analytics] load failed', err)
    loadError = true
  }

  const maxCountry = countryBreakdown[0]?.count ?? 1
  const maxCategory = trending[0]?.article_count ?? 1

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-1">Open Analytics</h1>
        <p className="text-text-secondary text-sm">
          Live data across African news — no paywall, no account required.
        </p>
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          Unable to load analytics right now. Please try again later.
        </div>
      )}

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              icon: <Newspaper className="w-5 h-5" />,
              label: 'Articles',
              value: stats.database.total_articles.toLocaleString(),
            },
            {
              icon: <Radio className="w-5 h-5" />,
              label: 'Active Sources',
              value: stats.database.active_sources.toLocaleString(),
            },
            {
              icon: <Layers className="w-5 h-5" />,
              label: 'Categories',
              value: stats.database.categories.toLocaleString(),
            },
            {
              icon: <TrendingUp className="w-5 h-5" />,
              label: 'Published Today',
              value: stats.database.today_articles.toLocaleString(),
            },
          ].map(({ icon, label, value }) => (
            <div key={label} className="bg-surface rounded-2xl p-5 border border-elevated">
              <div className="text-primary mb-2">{icon}</div>
              <div className="text-2xl font-bold text-foreground">{value}</div>
              <div className="text-xs text-text-secondary mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Trending categories */}
      {trending.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" /> Trending Categories
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {trending.map((t, i) => (
              <Link
                key={t.id}
                href={`/search?q=${encodeURIComponent(t.name)}`}
                className="bg-surface rounded-xl p-4 border border-elevated hover:border-primary/50 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-2xl">{getCategoryEmoji(t.slug)}</span>
                  {i < 3 && (
                    <span className="w-6 h-6 rounded-full bg-primary text-on-primary text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                  )}
                </div>
                <p className="font-semibold text-foreground truncate text-sm">{t.name}</p>
                <p className="text-xs text-text-secondary mt-1">
                  {t.article_count.toLocaleString()} articles
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Two-column: Country + Category */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Country breakdown */}
        {countryBreakdown.length > 0 && (
          <section className="bg-surface rounded-2xl border border-elevated p-6">
            <h2 className="text-lg font-bold text-foreground mb-1 flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" /> By Country
            </h2>
            <p className="text-xs text-text-tertiary mb-5">
              Articles aggregated per source country
            </p>
            <div className="space-y-3">
              {countryBreakdown.map(({ country, count }) => (
                <div key={country}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground font-medium">
                      {COUNTRY_NAMES.get(country) ?? country}
                    </span>
                    <span className="text-text-secondary">{count.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.round((count / maxCountry) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Category breakdown */}
        {trending.length > 0 && (
          <section className="bg-surface rounded-2xl border border-elevated p-6">
            <h2 className="text-lg font-bold text-foreground mb-1 flex items-center gap-2">
              <Layers className="w-5 h-5 text-primary" /> By Category
            </h2>
            <p className="text-xs text-text-tertiary mb-5">Article counts per category</p>
            <div className="space-y-3">
              {trending.slice(0, 8).map(({ slug, name, article_count }) => (
                <div key={slug}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground font-medium flex items-center gap-1">
                      {getCategoryEmoji(slug)} {name}
                    </span>
                    <span className="text-text-secondary">{article_count.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-secondary rounded-full transition-all"
                      style={{ width: `${Math.round((article_count / maxCategory) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Open data notice */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
        <p className="text-sm text-text-secondary">
          Mukoko News operates under an{' '}
          <strong className="text-foreground">open data policy</strong> — these analytics are
          freely available to journalists, researchers, and the public. Access programmatically
          via our{' '}
          <Link
            href="https://news.mukoko.dev/mcp"
            className="text-primary underline underline-offset-2"
          >
            MCP server
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
