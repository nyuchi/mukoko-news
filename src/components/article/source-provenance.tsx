'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileStack, Lock, RadioTower, CalendarClock, MapPin } from 'lucide-react'
import { useAuth } from '@workos-inc/authkit-nextjs/components'

import { canAccess, planFor } from '@/lib/access'
import { formatTimeAgo } from '@/lib/utils'
import type { Article, SourceSignals } from '@/lib/api'

/**
 * Where this article came from, and how well the platform knows it.
 *
 * ## This replaced a score, and the replacement is the point
 *
 * Until 2026-09-11 this slot held **"Source trust score"**: `source_trust`
 * rendered 0-100 with a band label — Established / Developing / Limited history
 * — a bar, and a sentence claiming Mukoko scores the publisher "on publisher
 * verification, how long it has been delivering, and how reliably its feed
 * resolves". Measured on the live cluster that day, none of that held:
 *
 *  - the number is `(avgQuality*0.7 + volume*0.3)*100` over 7 days, so it reads
 *    *published a lot of long fluent text lately* — verification and feed
 *    reliability are not in it at all;
 *  - **200 of the 201 sources it rates "Established" have a feed the platform
 *    records as broken**, and exactly one is healthy;
 *  - `src-malawivoice-mw`, which carries 45+ casino-affiliate pages, scores
 *    **85.8 -> "Established"**, because fluent SEO spam scores *well* on
 *    content depth;
 *  - `news.sourceScoreHistory`, described in the code as auditing every change
 *    to the score, holds **zero rows**.
 *
 * So the panel was publishing a judgement about named newsrooms that nobody at
 * Mukoko had made and the data did not support. Withdrawing it and showing the
 * underlying facts instead is not a smaller feature — a reader can see 1,260
 * articles since June and a feed last read two hours ago and draw their own
 * conclusion, which is the thing a score was pretending to do for them.
 *
 * ## What is deliberately NOT here
 *
 * **Feed health.** `feedSources` carries `sourceHealth`, `consecutiveFailures`
 * and `lastFetchError`, and they look like exactly the reliability signal this
 * panel wants. They are not: measured the same day, **351 of the 387 active
 * sources in an error state carry the platform's own MongoDB read timeout** as
 * the publisher's fetch error. Rendering that would tell a reader a newsroom's
 * feed is failing when what failed was our database. `last_successful_fetch_at`
 * is used instead — a timestamp of something that demonstrably happened, which
 * cannot blame anyone for an outage.
 *
 * **Corrections.** The old panel's design pairs trust with "No corrections
 * issued". There is no corrections store anywhere in this platform, so that
 * line would assert no correction exists because we never looked.
 */
export function SourceProvenancePanel({ article }: { article: Article }) {
  const { user, loading } = useAuth()
  const pathname = usePathname()

  const signals = article.source_signals
  const rows = signals ? buildRows(signals, article.country) : []
  // Nothing measured, nothing to show. An empty panel headed "Where this came
  // from" is worse for the reader than the article simply continuing.
  if (rows.length === 0) return null

  const publisher = article.publisher?.name?.trim() || article.source

  // Locked while the session resolves, never the other way round — the opposite
  // flashes the gated content to every anonymous reader on every load, which is
  // not a gate. Same rule as `ArticleSummary`.
  const unlocked = !loading && canAccess('source-transparency', planFor(!!user))

  return (
    <aside
      aria-labelledby="source-provenance-heading"
      className="my-8 grid gap-3 rounded-2xl bg-surface p-5 ring-1 ring-outline"
    >
      <h2
        id="source-provenance-heading"
        className="inline-flex items-center gap-2 text-sm font-semibold text-foreground"
      >
        <RadioTower className="h-4 w-4" aria-hidden="true" />
        Where this came from
      </h2>

      {unlocked ? (
        <>
          <dl className="grid gap-2.5 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="flex items-start gap-2.5">
                <row.icon
                  className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                    {row.label}
                  </dt>
                  <dd className="font-mono text-sm tabular-nums text-foreground">
                    {row.value}
                  </dd>
                  {row.note ? (
                    <dd className="text-xs leading-relaxed text-text-secondary">{row.note}</dd>
                  ) : null}
                </div>
              </div>
            ))}
          </dl>

          <p className="text-sm leading-relaxed text-text-secondary">
            These are Mukoko&apos;s own records of {publisher} — what we hold and when we
            last read it. They are not a rating of the newsroom.
          </p>
        </>
      ) : (
        <div className="grid gap-2">
          {/* A teaser, not a blank: the labels are shown so a signed-out reader
              learns what signing in reveals. The VALUES are what is withheld,
              which is the whole of the gate. */}
          <p className="text-sm leading-relaxed text-text-secondary">
            Mukoko keeps a record of every source — how many of its articles we hold,
            when we last read its feed, how long it has been delivering, and how we
            established its country.
          </p>
          <ul className="flex flex-wrap gap-1.5" aria-hidden="true">
            {rows.map((row) => (
              <li
                key={row.label}
                className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-text-tertiary"
              >
                {row.label}
              </li>
            ))}
          </ul>
          <Link
            href={`/sign-in?returnTo=${encodeURIComponent(pathname)}`}
            className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-secondary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Sign in to see the source record
          </Link>
        </div>
      )}
    </aside>
  )
}

interface Row {
  label: string
  value: string
  note?: string
  icon: typeof FileStack
}

/**
 * How a country was established, in words a reader can weigh.
 *
 * `assumed` is spelled out rather than softened. It is 217 of the 414 active
 * sources, and it is the bucket that files `theguardian.com` as Zimbabwean —
 * because `newsdata_collector` registers whatever outlet appears in a
 * `/latest?country=XX` response under the country it QUERIED, so the country of
 * a *story* became the country of its *publisher*. A reader who is told the
 * country is unverified can discount it; one shown a bare flag cannot.
 */
const PROVENANCE: Record<NonNullable<SourceSignals['country_code_source']>, string> = {
  declared: 'Declared by the source catalogue.',
  tld: "Corroborated by the publisher's own country domain.",
  assumed: 'Not corroborated — inherited from how the source was discovered.',
}

function buildRows(signals: SourceSignals, country?: string): Row[] {
  const rows: Row[] = []

  if (typeof signals.article_count === 'number') {
    rows.push({
      label: 'Articles held',
      value: signals.article_count.toLocaleString(),
      icon: FileStack,
    })
  }

  const lastRead = isoToDate(signals.last_successful_fetch_at)
  if (lastRead) {
    rows.push({
      label: 'Feed last read',
      value: formatTimeAgo(lastRead.toISOString()),
      icon: RadioTower,
    })
  }

  const since = isoToDate(signals.delivering_since)
  if (since) {
    rows.push({
      label: 'Delivering since',
      value: since.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      icon: CalendarClock,
    })
  }

  if (country && signals.country_code_source) {
    rows.push({
      label: 'Country',
      value: country,
      note: PROVENANCE[signals.country_code_source],
      icon: MapPin,
    })
  }

  return rows
}

/** A parsed date, or undefined — never an `Invalid Date` that renders as "NaN". */
function isoToDate(iso?: string): Date | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : d
}
