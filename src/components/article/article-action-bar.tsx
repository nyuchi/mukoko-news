'use client'

import { Heart, Bookmark, Share2, Check, ExternalLink } from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'

/**
 * The article's actions, pinned to the bottom of the viewport.
 *
 * ## Why pinned rather than at the foot of the article
 *
 * These were a row of buttons after the body, which means a reader who decides
 * halfway through that they want to save or share has to scroll to the end of
 * an article they have not finished, act, and scroll back. On the phone screens
 * this audience mostly reads on, that is the whole interaction. Pinning them
 * costs one bar of height and makes them reachable at the moment the intent
 * actually occurs.
 *
 * ## Every control here writes somewhere real
 *
 * Like, save and share hit endpoints that exist: `/api/articles/[id]/like` and
 * `/save` (rate-limited, keyed to the engagement subject) and the Web Share /
 * clipboard APIs. **Comments and Listen are not here**, though the design mock
 * places both in this bar:
 *
 *  - *Comments* would need a read of `news.comments`, which this frontend has
 *    never done. A "0" beside a speech bubble is not a neutral placeholder — it
 *    states that nobody has commented, which we have not checked.
 *  - *Listen* would need text-to-speech, which does not exist anywhere in this
 *    platform. The mock renders it with a "4:12" duration; there is no audio to
 *    be 4:12 long.
 *
 * Both come back when there is something behind them.
 */
export function ArticleActionBar({
  isLiked,
  likesCount,
  isSaved,
  copySuccess,
  originalUrl,
  sourceName,
  onLike,
  onSave,
  onShare,
}: {
  isLiked: boolean
  likesCount: number
  isSaved: boolean
  copySuccess: boolean
  /** The publisher's own article URL, when it passed URL validation. */
  originalUrl?: string
  sourceName?: string
  onLike: () => void
  onSave: () => void
  onShare: () => void
}) {
  const item =
    'inline-flex min-h-[var(--touch-a11y)] flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

  return (
    <div
      role="toolbar"
      aria-label="Article actions"
      // `--wash` over the page, plus a blur: the bar has to stay legible above
      // whatever paragraph is behind it without becoming an opaque slab that
      // eats a line of the article.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <PageContainer width="reading" className="flex items-center gap-2 py-2">
        <button
          type="button"
          onClick={onLike}
          aria-pressed={isLiked}
          aria-label={isLiked ? 'Remove like' : 'Like this article'}
          className={`${item} flex-1 ${isLiked ? 'text-destructive' : 'text-foreground hover:bg-elevated'}`}
        >
          <Heart className={`h-5 w-5 ${isLiked ? 'fill-current' : ''}`} aria-hidden="true" />
          {/* The count is the like count, so it is never rendered as a bare
              zero pretending to be an engagement figure — it is simply what
              the counter says, and 0 is a true reading of it. */}
          <span className="tabular-nums">{likesCount}</span>
        </button>

        <button
          type="button"
          onClick={onSave}
          aria-pressed={isSaved}
          aria-label={isSaved ? 'Remove from saved' : 'Save this article'}
          className={`${item} flex-1 ${isSaved ? 'text-primary' : 'text-foreground hover:bg-elevated'}`}
        >
          <Bookmark className={`h-5 w-5 ${isSaved ? 'fill-current' : ''}`} aria-hidden="true" />
          <span>{isSaved ? 'Saved' : 'Save'}</span>
        </button>

        {originalUrl && (
          <a
            href={originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${item} flex-1 text-foreground hover:bg-elevated`}
          >
            <ExternalLink className="h-5 w-5" aria-hidden="true" />
            <span className="max-w-full truncate">
              {sourceName ? `At ${sourceName}` : 'Original'}
            </span>
          </a>
        )}

        <button
          type="button"
          onClick={onShare}
          className={`ml-auto inline-flex min-h-[var(--touch-default)] shrink-0 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            copySuccess ? 'bg-success text-on-success' : 'bg-primary text-on-primary hover:opacity-90'
          }`}
        >
          {copySuccess ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Share2 className="h-4 w-4" aria-hidden="true" />
          )}
          <span>{copySuccess ? 'Copied' : 'Share'}</span>
        </button>
      </PageContainer>
    </div>
  )
}
