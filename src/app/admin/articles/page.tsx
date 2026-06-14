import { AlertCircle } from 'lucide-react'
import { getAdminArticles, type AdminArticle } from '@/lib/mongodb/admin'
import { ArticlesModerator } from '@/components/admin/articles-moderator'

export const metadata = { title: 'Moderation' }
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ status?: string }>
}

// Server Component: reads the moderation queue from MongoDB. Approve/reject
// mutations go through the gateway Worker.
export default async function AdminArticlesPage({ searchParams }: PageProps) {
  const { status } = await searchParams
  const filter = status ?? 'pending'

  let articles: AdminArticle[] = []
  let dbError = false
  try {
    articles = await getAdminArticles(filter === 'all' ? undefined : filter)
  } catch (err) {
    console.error('[ADMIN] articles read failed', err)
    dbError = true
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-1">Article moderation</h1>
        <p className="text-text-secondary">
          Review the article queue. Approving or rejecting routes through the gateway
          Worker.
        </p>
      </div>

      {dbError ? (
        <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertCircle className="w-5 h-5 shrink-0" />
          Could not load articles from the database.
        </div>
      ) : (
        <ArticlesModerator initialArticles={articles} activeFilter={filter} />
      )}
    </div>
  )
}
