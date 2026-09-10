'use client'

import { Heart, Bookmark, Share2, Check, ExternalLink } from 'lucide-react'

/**
 * The article's actions.
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
 * ## Two shapes, because the bottom of a phone belongs to navigation
 *
 * On mobile this is a **vertical rail on the right**; from `md` up it is the
 * horizontal bar it always was.
 *
 * The article page used to hide the app's bottom nav so this bar could own the
 * bottom edge, which meant an article opened from a shared link had no visible
 * route to anywhere else in the app. Navigation wins that space: the floating
 * nav pill is on every route now, and the actions move out of its way rather
 * than displacing it. That is the split TikTok uses on a fullscreen video —
 * navigation along the bottom, content actions up the right-hand side — and the
 * same rail `/newsbytes` already had.
 *
 * The rail is lifted by `--bottom-nav-clearance`, the one token every surface
 * that pins something above the pill reads, so the rail and the pill can never
 * be lifted by different amounts.
 *
 * **It is one DOM tree that reshapes, not two that take turns.** Rendering a
 * mobile toolbar and a desktop toolbar and hiding one with `md:hidden` would
 * put two `role="toolbar"` regions with the same accessible name into the
 * page — and since jsdom applies no media queries, every `getByRole` in the
 * suite would match both. The responsive classes below carry the whole
 * difference: a circular well on a phone, a flex row on a desktop.
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

/**
 * One action. A circular well on mobile — which also makes the label part of
 * the tap target rather than a caption beside it — and a flex cell in the bar
 * from `md` up.
 */
const ACTION =
  'inline-flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-full border border-outline bg-surface/90 text-[10px] font-medium shadow-md backdrop-blur-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'md:h-auto md:min-h-[var(--touch-a11y)] md:w-auto md:flex-1 md:rounded-xl md:border-transparent md:bg-transparent md:px-2 md:text-[11px] md:shadow-none md:backdrop-blur-none'

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
  return (
    <div
      role="toolbar"
      aria-label="Article actions"
      className={
        // Mobile: a rail on the right, lifted clear of the navigation pill.
        'fixed right-3 bottom-[var(--bottom-nav-clearance)] z-40 flex flex-col items-center gap-3 ' +
        // Desktop: the full-width bar. `--wash` over the page plus a blur, so
        // it stays legible above whatever paragraph is behind it without
        // becoming an opaque slab that eats a line of the article.
        'md:inset-x-0 md:right-auto md:bottom-0 md:flex-row md:gap-0 md:border-t md:border-border md:bg-background/85 md:pb-[env(safe-area-inset-bottom)] md:backdrop-blur-xl'
      }
    >
      {/* The reading-width column, applied only where the bar spans the
          viewport. Inlined rather than using PageContainer because on mobile
          this element must not be a column at all — it is a 56px-wide rail. */}
      <div className="contents md:mx-auto md:flex md:w-full md:max-w-[var(--width-reading)] md:items-center md:gap-2 md:px-[var(--page-gutter)] md:py-2 sm:md:px-[var(--page-gutter-sm)]">
        <button
          type="button"
          onClick={onLike}
          aria-pressed={isLiked}
          aria-label={isLiked ? 'Remove like' : 'Like this article'}
          className={`${ACTION} ${isLiked ? 'text-destructive' : 'text-foreground md:hover:bg-elevated'}`}
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
          className={`${ACTION} ${isSaved ? 'text-primary' : 'text-foreground md:hover:bg-elevated'}`}
        >
          <Bookmark className={`h-5 w-5 ${isSaved ? 'fill-current' : ''}`} aria-hidden="true" />
          <span>{isSaved ? 'Saved' : 'Save'}</span>
        </button>

        {originalUrl && (
          <a
            href={originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${ACTION} text-foreground md:hover:bg-elevated`}
          >
            <ExternalLink className="h-5 w-5" aria-hidden="true" />
            {/* On the rail there is room for one word; in the bar there is room
                to name the publisher, which is what makes it obvious the link
                leaves this site. */}
            <span className="max-w-full truncate md:hidden">Original</span>
            <span className="hidden max-w-full truncate md:inline">
              {sourceName ? `At ${sourceName}` : 'Original'}
            </span>
          </a>
        )}

        <button
          type="button"
          onClick={onShare}
          aria-label="Share this article"
          className={`${ACTION} md:ml-auto md:h-auto md:min-h-[var(--touch-default)] md:w-auto md:flex-none md:flex-row md:gap-2 md:rounded-full md:px-5 md:text-sm md:font-semibold ${
            copySuccess
              ? 'border-transparent bg-success text-on-success'
              : 'border-transparent bg-primary text-on-primary md:hover:opacity-90'
          }`}
        >
          {copySuccess ? (
            <Check className="h-5 w-5 md:h-4 md:w-4" aria-hidden="true" />
          ) : (
            <Share2 className="h-5 w-5 md:h-4 md:w-4" aria-hidden="true" />
          )}
          <span>{copySuccess ? 'Copied' : 'Share'}</span>
        </button>
      </div>
    </div>
  )
}
