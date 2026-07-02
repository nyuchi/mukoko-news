import Link from 'next/link'
import { ArrowLeft, Activity, Database, Workflow } from 'lucide-react'
import { pingDatabase } from '@/lib/mongodb/admin'

export const metadata = { title: 'System' }

// Server Component — the database status is a real ping, checked on every load.
export const dynamic = 'force-dynamic'

export default async function AdminSystemPage() {
  const dbPing = await pingDatabase()

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
          <h1 className="text-2xl font-bold text-foreground">System</h1>
          <p className="text-text-secondary">Live status — checked on page load</p>
        </div>
      </div>

      {/* System Status */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-surface rounded-xl border border-elevated p-5">
            <div className="flex items-center gap-3 mb-3">
              <Database
                className={`w-6 h-6 ${dbPing.ok ? 'text-success' : 'text-warning'}`}
              />
              <span className="font-medium text-foreground">MongoDB Atlas</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${dbPing.ok ? 'bg-success' : 'bg-warning'}`}
              />
              <span className="text-sm text-text-secondary">
                {dbPing.ok
                  ? `Connected${dbPing.latencyMs !== null ? ` — ping ${dbPing.latencyMs} ms` : ''}`
                  : 'Unreachable'}
              </span>
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-elevated p-5">
            <div className="flex items-center gap-3 mb-3">
              <Activity className="w-6 h-6 text-secondary" />
              <span className="font-medium text-foreground">Health Probe</span>
            </div>
            <p className="text-sm text-text-secondary">
              <a
                href="/api/health"
                className="text-secondary underline underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                /api/health
              </a>{' '}
              returns this app&apos;s live status (database ping + article stats) as JSON.
            </p>
          </div>
        </div>
      </section>

      {/* Pipeline — honest boundary note, no fabricated status */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Pipeline</h2>
        <div className="bg-surface rounded-xl border border-elevated p-5 flex items-start gap-4">
          <Workflow className="w-6 h-6 text-text-tertiary shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-foreground mb-1">Ingestion &amp; enrichment</p>
            <p className="text-sm text-text-secondary">
              RSS collection and AI enrichment run in the <code>mukoko-news-pipeline</code> repo
              (Fly.io + Cloudflare Workers). Their status is not monitored from this frontend, so
              no status is shown here. Sync intervals and retention are configured in the
              pipeline repo, not here.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
