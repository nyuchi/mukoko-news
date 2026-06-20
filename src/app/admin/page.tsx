import Link from 'next/link'
import {
  Newspaper,
  Radio,
  Clock,
  TrendingUp,
  ChevronRight,
  AlertCircle,
} from 'lucide-react'
import { getAdminStats, type AdminStats } from '@/lib/mongodb/admin'

export const metadata = { title: 'Dashboard' }

// Server Component — reads live counts from MongoDB. Mutations live on the
// sources/moderation pages and route through the gateway Worker.
export const dynamic = 'force-dynamic'

const SECTIONS = [
  {
    href: '/admin/sources',
    icon: Radio,
    title: 'Sources',
    description: 'Manage RSS feeds and news sources',
    color: 'bg-success',
  },
  {
    href: '/admin/articles',
    icon: Newspaper,
    title: 'Moderation',
    description: 'Review and moderate the article queue',
    color: 'bg-secondary',
  },
]

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
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg ${tint} flex items-center justify-center`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="text-2xl font-bold text-foreground">{value.toLocaleString()}</div>
      </div>
      <p className="text-sm text-text-secondary">{label}</p>
    </div>
  )
}

export default async function AdminDashboard() {
  let stats: AdminStats | null = null
  let dbError = false
  try {
    stats = await getAdminStats()
  } catch (err) {
    console.error('[ADMIN] dashboard stats failed', err)
    dbError = true
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Admin Dashboard</h1>
        <p className="text-text-secondary">Manage your Mukoko News platform</p>
      </div>

      {dbError && (
        <div className="mb-8 flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertCircle className="w-5 h-5 shrink-0" />
          Could not reach the database. Stats are unavailable right now.
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={Newspaper}
            value={stats.totalArticles}
            label="Published Articles"
            tint="bg-secondary/10 text-secondary"
          />
          <StatCard
            icon={Radio}
            value={stats.activeSources}
            label="Active Sources"
            tint="bg-success/10 text-success"
          />
          <StatCard
            icon={Clock}
            value={stats.pendingArticles}
            label="Pending Moderation"
            tint="bg-warning/10 text-warning"
          />
          <StatCard
            icon={TrendingUp}
            value={stats.todayArticles}
            label="Published Today"
            tint="bg-primary/10 text-primary"
          />
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Management</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="flex items-center p-5 bg-surface rounded-xl border border-elevated hover:border-primary/50 transition-colors"
            >
              <div
                className={`w-12 h-12 rounded-xl ${section.color} flex items-center justify-center mr-4`}
              >
                <section.icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{section.title}</h3>
                <p className="text-sm text-text-secondary">{section.description}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-text-tertiary" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
