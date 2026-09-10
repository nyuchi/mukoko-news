'use client'

import Link from 'next/link'
import { BadgeCheck, MapPin } from 'lucide-react'
import { SourceIcon, sourceIconProps } from '@/components/ui/source-icon'
import { STATIC_COUNTRIES } from '@/lib/countries'
import { authorHref } from '@/lib/author-identity'
import type { Article } from '@/lib/api'

/**
 * The publisher's own name for this article.
 *
 * `publisher.name` first, because the organisation record is the single
 * instance of publisher identity and one newsroom routinely holds several feed
 * sources under names that disagree — measured on the live cluster, 35
 * organisations hold sources whose names differ, covering 24% of the corpus.
 * `source` is the feed-source label and only stands in when the organisation
 * could not be resolved.
 */
function publisherName(article: Article): string {
  return article.publisher?.name?.trim() || article.source
}

/**
 * The country's NAME for an ISO code, or nothing.
 *
 * Returning the bare code when the app has no entry would print "XK" under a
 * byline, which reads as a typo rather than a place. `countryCode` is an
 * ingestion field the pipeline stamps from the article's own feed source and
 * deliberately never guesses, so an unrecognised code means the app's list is
 * behind `places`, not that the article is from nowhere — render nothing.
 */
const COUNTRY_NAMES = new Map(STATIC_COUNTRIES.map((c) => [c.code, c.name]))

function countryName(code?: string): string | undefined {
  return code ? COUNTRY_NAMES.get(code) : undefined
}

/**
 * Who published this, when, and — where the platform has actually verified it —
 * that it did.
 *
 * ## The Verified pill is a live read, and it is the only trust claim here
 *
 * `publisher.isVerified` is resolved per request from
 * `news.newsMediaOrganizations`, which is the one place it exists. It is never
 * copied onto an article, so revoking a verification removes this pill from
 * every article at once rather than leaving 63,832 stamped copies behind.
 *
 * Absent verification renders NOTHING — no "unverified" badge, no grey pill.
 * Most publishers in this corpus have simply never been through the Tier-2
 * review, and labelling a Zimbabwean newsroom "unverified" because staff have
 * not got to it yet would be a claim about that newsroom that Mukoko has not
 * earned the right to make.
 *
 * ## What the byline deliberately does not carry
 *
 * A **Follow** button, which the design mock places here. Nothing in this app
 * stores a follow — there is no collection, no action, no read — so the button
 * would either do nothing or write somewhere it does not belong. It comes back
 * when there is somewhere for it to write.
 */
export function ArticleByline({
  article,
  formattedDate,
}: {
  article: Article
  /** Pre-formatted so the server and client render the same string. */
  formattedDate: string
}) {
  const name = publisherName(article)
  const verified = article.publisher?.isVerified === true
  const href = article.source_id ? `/sources?source=${encodeURIComponent(article.source_id)}` : null
  const place = countryName(article.country)
  const authorLink = authorHref(article.author, article.publisher?.name)

  const nameNode = (
    <span className="font-semibold text-foreground">{name}</span>
  )

  return (
    <div className="flex items-start gap-3 border-y border-border py-4">
      <SourceIcon {...sourceIconProps(article)} size={40} className="mt-0.5 shrink-0" />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {href ? (
            <Link
              href={href}
              className="rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:underline"
            >
              {nameNode}
            </Link>
          ) : (
            nameNode
          )}

          {verified && (
            <span
              className="inline-flex min-h-[var(--touch-badge)] items-center gap-1 rounded-full bg-container-malachite px-2 text-xs font-medium text-on-container-malachite"
              title="Publisher verified by Mukoko"
            >
              <BadgeCheck className="h-3 w-3" aria-hidden="true" />
              Verified
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-text-tertiary">
          {/* The byline of the JOURNALIST, when the pipeline resolved one. It
              is separate from the publisher above: 38,712 of 38,926 articles
              carried no author until the 2026-09 backfill, so this is absent
              far more often than it is present, and an absent byline renders
              nothing rather than falling back to the outlet's name — which
              would attribute a newsroom's staff writer to the masthead.

              It links to that byline's own page — but only when there is one to
              link to. `authorHref` returns null for a DESK byline with no
              resolvable newsroom ("Staff Reporter" files under ten mastheads in
              four countries, so an unscoped page would present ten newsrooms'
              staff as one writer), and the byline then renders as plain text.
              The newsroom passed here is the ORGANISATION's name, never
              `publisherName`'s feed-source fallback: the page resolves the
              newsroom segment against the organisation catalogue, so a
              feed-source label would address a masthead that does not exist. */}
          {article.author && (
            <>
              {authorLink ? (
                <Link
                  href={authorLink}
                  className="rounded-sm text-text-secondary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  By {article.author}
                </Link>
              ) : (
                <span className="text-text-secondary">By {article.author}</span>
              )}
              <span aria-hidden="true">·</span>
            </>
          )}
          <time dateTime={article.published_at}>{formattedDate}</time>
          {place && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {place}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
