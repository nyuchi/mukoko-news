'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getRelatedArticlesAction } from '@/lib/actions/feed'
import { CompactCard } from '@/components/compact-card'
import type { Article } from '@/lib/api'

/**
 * "More in <category>" — the reader's next step.
 *
 * Backed by `getRelatedArticlesAction`, which runs Atlas Vector Search over the
 * article's own BGE-M3 embedding and falls back to same-category recency for
 * articles enrichment has not embedded yet. The Mongo read has existed since
 * the read layer was written and had **no caller**: there was no Server Action,
 * so the article page ended at the body and the only way onward was the back
 * button — on the one page where the reader has already told us what interests
 * them.
 *
 * Loaded on the client, after paint, deliberately: a vector search is the most
 * expensive read on this page and it sits below the fold, so making the article
 * itself wait on it would trade the thing the reader came for against a thing
 * they have not scrolled to. Nothing renders until it resolves — no skeleton
 * for a section that may legitimately be empty, and no empty "More in …"
 * heading when it is.
 */
export function RelatedArticles({
  articleId,
  category,
}: {
  articleId: string
  category?: string
}) {
  const [related, setRelated] = useState<Article[]>([])

  useEffect(() => {
    let live = true
    getRelatedArticlesAction(articleId, 3)
      .then((articles) => {
        if (live) setRelated(articles)
      })
      // Fail-soft: the section simply does not appear. An article page must not
      // surface an error for a recommendation strip.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [articleId])

  if (related.length === 0) return null

  const heading = category ? `More in ${category}` : 'Related stories'
  const seeAll = category ? `/discover?category=${encodeURIComponent(category)}` : '/discover'

  return (
    <section aria-labelledby="related-heading" className="mt-12">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="related-heading" className="font-serif text-2xl font-semibold text-foreground">
          {heading}
        </h2>
        <Link
          href={seeAll}
          className="shrink-0 rounded-sm text-sm font-medium text-secondary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          See all
        </Link>
      </div>

      <ul className="grid gap-3">
        {related.map((item, index) => (
          <li key={item.id}>
            <CompactCard article={item} index={index} />
          </li>
        ))}
      </ul>
    </section>
  )
}
