import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import type { Article } from '@/lib/api'

/**
 * The band a score falls in, and the mineral that carries it.
 *
 * Three bands, not a continuous hue ramp: a reader cannot tell 71 from 68 by
 * colour, and pretending they can implies a precision the score does not have.
 * The colours are Mzizi containers — malachite reads as "established",
 * terracotta as "community/caution", copper as the low end — never a raw
 * palette red, which would read as an error state rather than a low score.
 */
function band(score: number): { label: string; chip: string; bar: string } {
  if (score >= 70) {
    return {
      label: 'Established',
      chip: 'bg-container-malachite text-on-container-malachite',
      bar: 'bg-success',
    }
  }
  if (score >= 40) {
    return {
      label: 'Developing',
      chip: 'bg-container-terracotta text-on-container-terracotta',
      bar: 'bg-warning',
    }
  }
  return {
    label: 'Limited history',
    chip: 'bg-container-copper text-on-container-copper',
    bar: 'bg-copper',
  }
}

/**
 * The publisher's trust score, when the platform has actually assigned one.
 *
 * ## Why this renders nothing far more often than it renders
 *
 * `source_trust` is `undefined` for every source the publisher-verification
 * flow has never scored, and this component returns `null` for those. That is
 * the whole point. The obvious alternative — default to 0, or to 50, or to
 * "unrated" with an empty bar — publishes a judgement about a newsroom that
 * nobody at Mukoko made. The pipeline's country backfill has the same rule
 * written down for the same reason: *a null is a known gap, a wrong value is a
 * silent error every reader then takes as fact.*
 *
 * ## What it deliberately omits
 *
 * The design mock pairs the score with a corrections line — "No corrections
 * issued". There is no corrections store in this platform: not in `news`, not
 * in `engagement`, nowhere. "No corrections issued" would therefore not be a
 * read, it would be an assertion that no correction exists because we never
 * looked. Silence about corrections is honest; a green tick about them is not.
 */
export function ArticleTrustPanel({ article }: { article: Article }) {
  const score = article.source_trust
  if (typeof score !== 'number') return null

  const { label, chip, bar } = band(score)
  const publisher = article.publisher?.name?.trim() || article.source

  return (
    <aside
      aria-labelledby="article-trust-heading"
      className="my-8 grid gap-3 rounded-2xl bg-surface p-5 ring-1 ring-outline"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="article-trust-heading"
          className="inline-flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Source trust score
        </h2>
        <span
          className={`rounded-full px-3 py-0.5 font-mono text-sm font-semibold tabular-nums ${chip}`}
        >
          {score} / 100
        </span>
      </div>

      {/* The bar duplicates the number beside it, so it carries no accessible
          role of its own — a screen reader gets the figure once, from the chip,
          rather than twice in two different phrasings. */}
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${score}%` }} />
      </div>

      <p className="text-sm leading-relaxed text-text-secondary">
        <span className="font-medium text-foreground">{label}.</span> Mukoko scores{' '}
        {publisher} on publisher verification, how long it has been delivering, and how
        reliably its feed resolves. The score describes the <em>source</em>, not this
        article.
      </p>

      <Link
        href="/help#source-trust"
        className="w-fit rounded-sm text-sm font-medium text-secondary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        How we score sources
      </Link>
    </aside>
  )
}
