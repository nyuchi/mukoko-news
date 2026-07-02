import Link from 'next/link'
import {
  ArrowLeft,
  AlertCircle,
  BarChart3,
  Bookmark,
  Eye,
  Heart,
  Layers,
  Newspaper,
  Radio,
  TrendingUp,
} from 'lucide-react'
import {
  getAdminStats,
  getAdminEngagementTotals,
  getAdminCategoryCounts,
  type AdminStats,
  type AdminEngagementTotals,
  type AdminCategoryCount,
} from '@/lib/mongodb/admin'

export const metadata = { title: 'Analytics' }

// Server Component — every number on this page is read live from MongoDB.
export const dynamic = 'force-dynamic'

function StatCard({
  icon: Icon,
  value,
  label,
  tint,
}: {
  icon: typeof Newspaper
  value: number
  label: string
  tint: string
}) {
  return (
    <div className="bg-surface rounded-xl p-5 border border-elevated">
      <Icon className={`w-6 h-6 mb-3 ${tint}`} />
      <div className="text-2xl font-bold text-foreground">{value.toLocaleString()}</div>
      <p className="text-sm text-text-secondary">{label}</p>
    </div>
  )
}

export default async function AdminAnalyticsPage() {
  let stats: AdminStats | null = null
  let engagement: AdminEngagementTotals | null = null
  let categories: AdminCategoryCount[] = []
  let dbError = false

  try {
    ;[stats, engagement, categories] = await Promise.all([
      getAdminStats(),
      getAdminEngagementTotals(),
      getAdminCategoryCounts(8),
    ])
  } catch (err) {
    console.error('[ADMIN] analytics read failed', err)
    dbError = true
  }

  const maxCategory = categories[0]?.count ?? 1

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/admin"
          className="w-10 h-10 flex items-center justify-center rounded-full bg-surface hover:bg-elevated transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-text-secondary">Live platform metrics from the news database</p>
        </div>
      </div>

      {dbError && (
        <div className="mb-8 flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertCircle className="w-5 h-5 shrink-0" />
          Could not reach the database. Analytics are unavailable right now.
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={Newspaper}
            value={stats.totalArticles}
            label="Total Articles"
            tint="text-secondary"
          />
          <StatCard
            icon={Radio}
            value={stats.activeSources}
            label="Active Sources"
            tint="text-success"
          />
          <StatCard
            icon={TrendingUp}
            value={stats.todayArticles}
            label="Published Today"
            tint="text-primary"
          />
          <StatCard
            icon={Layers}
            value={stats.categories}
            label="Curated Categories"
            tint="text-accent"
          />
        </div>
      )}

      {engagement && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Engagement</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={Heart} value={engagement.likes} label="Likes" tint="text-primary" />
            <StatCard icon={Bookmark} value={engagement.saves} label="Saves" tint="text-secondary" />
            <StatCard
              icon={Eye}
              value={engagement.viewEvents}
              label="Tracked View Events"
              tint="text-success"
            />
          </div>
          <p className="text-xs text-text-tertiary mt-2">
            View events are deduplicated per session per day — this is not a raw page-view count.
          </p>
        </section>
      )}

      {/* Top categories — live article counts */}
      {categories.length > 0 && (
        <section className="mb-8">
          <div className="bg-surface rounded-xl border border-elevated p-6">
            <h3 className="font-semibold text-foreground mb-4">Top Categories by Article Count</h3>
            <div className="space-y-3">
              {categories.map((cat) => (
                <div key={cat.slug}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground">{cat.name}</span>
                    <span className="text-text-secondary">{cat.count.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.round((cat.count / maxCategory) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Honest placeholder for metrics with no backing data yet */}
      <section>
        <div className="bg-surface rounded-xl border border-elevated p-6 flex items-start gap-4">
          <BarChart3 className="w-6 h-6 text-text-tertiary shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-foreground mb-1">Not tracked yet</h3>
            <p className="text-sm text-text-secondary">
              Page views, active users, session duration, and traffic-over-time analytics are not
              collected by the frontend yet. They will appear here once real tracking lands.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
