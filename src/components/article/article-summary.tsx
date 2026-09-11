'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sparkles, Lock } from 'lucide-react'
import { useAuth } from '@workos-inc/authkit-nextjs/components'

import { canAccess, planFor } from '@/lib/access'

/**
 * The enrichment worker's summary of this article, labelled as machine-written.
 *
 * ## Why the label is not optional
 *
 * The design mock puts a card here headed **"Key takeaways"** with three
 * editorial-looking bullets. This app has no editorial takeaways: what it has
 * is `aiSummary`, one paragraph written by Qwen from the article body. Heading
 * that "Key takeaways" and setting it in the newsroom's own voice would tell
 * the reader a person distilled the piece for them. Nobody did.
 *
 * So the heading says what it is, the icon marks it, and the sodalite container
 * — the mineral Mzizi reserves for AI/Shamwari surfaces — carries it, exactly
 * as every other AI surface in the platform does. A reader can then decide how
 * much weight to give it, which is the entire point of saying so.
 *
 * Renders nothing when the article has no summary: unenriched articles are
 * common (the backlog runs into thousands at any moment) and an empty card that
 * says "no summary available" is worse than the reader simply reading on.
 */
export function ArticleSummary({ summary }: { summary?: string }) {
  const { user, loading } = useAuth()
  const pathname = usePathname()

  const text = summary?.trim()
  if (!text) return null

  // While the session is still resolving, show the card in its LOCKED state
  // rather than the summary. The other way round would flash the thing being
  // gated to every anonymous reader on every load, which is not a gate.
  const unlocked = !loading && canAccess('ai-summary', planFor(!!user))

  if (unlocked) {
    return (
      <section
        aria-labelledby="article-summary-heading"
        className="mb-8 rounded-2xl bg-container-sodalite p-5"
      >
        <SummaryHeading />
        <p className="text-base leading-relaxed text-on-container-sodalite">{text}</p>
      </section>
    )
  }

  // A teaser, not a blank. A component that simply vanishes for signed-out
  // readers converts nobody — they never learn the thing exists. One line of
  // the real summary, faded into the card, and a reason to sign in.
  const teaser = firstSentence(text)

  return (
    <section
      aria-labelledby="article-summary-heading"
      className="mb-8 rounded-2xl bg-container-sodalite p-5"
    >
      <SummaryHeading />
      <div className="relative">
        <p
          className="text-base leading-relaxed text-on-container-sodalite [mask-image:linear-gradient(to_bottom,black_35%,transparent)]"
          aria-hidden="true"
        >
          {teaser}
        </p>
      </div>
      <Link
        href={`/sign-in?returnTo=${encodeURIComponent(pathname || '/')}`}
        className="mt-2 inline-flex min-h-[var(--touch-default)] items-center gap-2 rounded-xl bg-sodalite px-4 text-sm font-medium text-on-sodalite transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-container-sodalite"
      >
        <Lock className="h-4 w-4" aria-hidden="true" />
        Sign in to read the summary
      </Link>
    </section>
  )
}

function SummaryHeading() {
  return (
    <h2
      id="article-summary-heading"
      className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-on-container-sodalite"
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      AI summary
    </h2>
  )
}

/**
 * The first sentence, for the teaser.
 *
 * Cut on a sentence boundary rather than a character count so the fade lands on
 * a finished thought instead of mid-word. Falls back to a hard cut for a
 * summary that is one long unpunctuated run.
 */
export function firstSentence(text: string): string {
  const match = /^.*?[.!?](\s|$)/.exec(text)
  const candidate = match ? match[0].trim() : text
  return candidate.length > 180 ? `${candidate.slice(0, 177).trimEnd()}…` : candidate
}
