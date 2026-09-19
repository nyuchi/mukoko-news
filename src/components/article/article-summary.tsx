'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { Sparkles, Lock } from 'lucide-react'
import { useAuth } from '@workos-inc/authkit-nextjs/components'

import { canAccess, planFor } from '@/lib/access'
import { useMeter } from '@/hooks/use-meter'

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
export function ArticleSummary({
  summary,
  articleId,
}: {
  summary?: string
  articleId?: string
}) {
  const { user, loading } = useAuth()
  const pathname = usePathname()

  // ⚠️ Two mechanisms, both required, and they do not say the same thing.
  //
  //   - the GATE (`canAccess`) answers "may this plan reach AI summaries at
  //     all". Signed out, no.
  //   - the METER answers "has this plan had its share". Signed in and free,
  //     five; above that, no ceiling.
  //
  // A gate alone made free-forever; a meter alone would hand an anonymous
  // reader five. `ALLOWANCES['ai-summary'].anonymous` is 0, so the meter agrees
  // with the gate rather than contradicting it, but the gate is still checked
  // first — an unknown plan must be denied by the thing that fails closed on
  // unknown plans.
  const { ready, allowed, record, hasCounted } = useMeter('ai-summary')
  const text = summary?.trim()
  const permitted = !loading && canAccess('ai-summary', planFor(!!user))

  // A summary already spent stays readable for good — the same rule the article
  // allowance follows, and for the same reason: taking back something already
  // given reads as the site breaking rather than as a boundary.
  const alreadySpent = articleId ? hasCounted(articleId) : false

  // Locked until BOTH answers are in. `ready` already implies the session has
  // resolved, so this is the existing "locked while resolving" rule extended to
  // cover the count: the other way round would show the summary and then take
  // it away a frame later, which is worse than never showing it.
  const unlocked = permitted && ready && (allowed || alreadySpent)

  // Spend one per ARTICLE, deduplicated by id, so re-reading a piece or
  // refreshing it does not burn another. `record` is the stable callback from
  // the hook — depending on the whole meter object would re-run this on every
  // render, since the object is rebuilt each time.
  useEffect(() => {
    if (unlocked && text && articleId) record(articleId)
  }, [unlocked, text, articleId, record])

  if (!text) return null

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

  // ⚠️ The two locked states are NOT the same sentence.
  //
  // A signed-out reader is behind a gate and has lost nothing: "sign in" is the
  // whole story. A signed-in free reader who has used their five was reading
  // summaries a moment ago and now is not — telling THEM to sign in is
  // nonsense, and telling them nothing reads as the feature breaking. So the
  // second case says what they had and what changes it.
  //
  // `permitted` is exactly the gate, so it separates the two cleanly: locked
  // while permitted can only mean the allowance is spent.
  const outOfAllowance = permitted && ready

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
      {outOfAllowance ? (
        <p className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-on-container-sodalite">
          <Lock className="h-4 w-4" aria-hidden="true" />
          That&apos;s your free AI summaries. More come with a Mukoko
          subscription.
        </p>
      ) : (
        <Link
          href={`/sign-in?returnTo=${encodeURIComponent(pathname || '/')}`}
          className="mt-2 inline-flex min-h-[var(--touch-default)] items-center gap-2 rounded-xl bg-sodalite px-4 text-sm font-medium text-on-sodalite transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-container-sodalite"
        >
          <Lock className="h-4 w-4" aria-hidden="true" />
          Sign in to read the summary
        </Link>
      )}
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
