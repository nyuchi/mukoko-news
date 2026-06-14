import { AlertCircle } from 'lucide-react'
import { getAdminSources, type AdminSource } from '@/lib/mongodb/admin'
import { SourcesManager } from '@/components/admin/sources-manager'

export const metadata = { title: 'Sources' }
export const dynamic = 'force-dynamic'

// Server Component: reads feed sources from MongoDB and hands them to the
// client manager, which performs mutations via the gateway Worker.
export default async function AdminSourcesPage() {
  let sources: AdminSource[] = []
  let dbError = false
  try {
    sources = await getAdminSources()
  } catch (err) {
    console.error('[ADMIN] sources read failed', err)
    dbError = true
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-1">Sources</h1>
        <p className="text-text-secondary">
          Manage RSS feeds and news sources. Toggling a source or refreshing feeds
          routes through the gateway Worker.
        </p>
      </div>

      {dbError ? (
        <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertCircle className="w-5 h-5 shrink-0" />
          Could not load sources from the database.
        </div>
      ) : (
        <SourcesManager initialSources={sources} />
      )}
    </div>
  )
}
