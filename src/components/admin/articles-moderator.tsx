'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, X, Flag, ExternalLink, Loader2 } from 'lucide-react'
import type { AdminArticle } from '@/lib/mongodb/admin'
import { moderateArticle } from '@/lib/admin/gateway'

const FILTERS = [
  { key: 'flagged', label: 'Flagged' },
  { key: 'active', label: 'Active' },
  { key: 'removed', label: 'Removed' },
  { key: 'all', label: 'All' },
]

interface ArticlesModeratorProps {
  initialArticles: AdminArticle[]
  activeFilter: string
}

export function ArticlesModerator({ initialArticles, activeFilter }: ArticlesModeratorProps) {
  const [articles, setArticles] = useState(initialArticles)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const moderate = (id: string, moderationStatus: 'active' | 'flagged' | 'removed') => {
    setBusyId(id)
    setNotice(null)
    moderateArticle(id, moderationStatus)
      .then((res) => {
        if (res.ok) {
          setArticles((prev) =>
            activeFilter === 'all'
              ? prev.map((a) => (a.id === id ? { ...a, moderationStatus } : a))
              : prev.filter((a) => a.id !== id),
          )
        } else {
          setNotice(res.error ?? 'Could not update the article.')
        }
      })
      .finally(() => setBusyId(null))
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/articles?moderationStatus=${f.key}`}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeFilter === f.key
                ? 'bg-primary text-on-primary'
                : 'bg-surface border border-elevated text-text-secondary hover:bg-elevated'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {notice && (
        <div className="mb-4 rounded-xl border border-elevated bg-surface px-4 py-3 text-sm text-foreground">
          {notice}
        </div>
      )}

      <div className="space-y-3">
        {articles.map((a) => (
          <div
            key={a.id}
            className="flex items-start justify-between gap-4 rounded-xl border border-elevated bg-surface p-4"
          >
            <div className="min-w-0">
              <h3 className="font-medium text-foreground line-clamp-2">{a.title}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
                {a.source && <span>{a.source}</span>}
                {a.category && <span>· {a.category}</span>}
                {a.countryCode && <span>· {a.countryCode}</span>}
                {a.status && (
                  <span className="rounded-full bg-elevated px-2 py-0.5 capitalize">
                    {a.status}
                  </span>
                )}
                {a.url && /^https?:\/\//i.test(a.url) && (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-primary"
                  >
                    source <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => moderate(a.id, 'active')}
                disabled={busyId === a.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20 transition-colors disabled:opacity-60"
              >
                {busyId === a.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                Approve
              </button>
              <button
                onClick={() => moderate(a.id, 'flagged')}
                disabled={busyId === a.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20 transition-colors disabled:opacity-60"
              >
                <Flag className="w-3 h-3" />
                Flag
              </button>
              <button
                onClick={() => moderate(a.id, 'removed')}
                disabled={busyId === a.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-60"
              >
                <X className="w-3 h-3" />
                Remove
              </button>
            </div>
          </div>
        ))}
        {articles.length === 0 && (
          <div className="rounded-xl border border-elevated bg-surface px-4 py-12 text-center text-text-tertiary">
            Nothing in the {activeFilter} queue.
          </div>
        )}
      </div>
    </div>
  )
}
