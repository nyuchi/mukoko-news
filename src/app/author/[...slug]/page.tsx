import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Building2, Newspaper } from 'lucide-react'

import { getAuthorPageAction, type AuthorPage, type LabelledFacet } from '@/lib/actions/authors'
import { authorSlug } from '@/lib/author-identity'
import { PageContainer } from '@/components/layout/page-container'
import { CompactCard } from '@/components/compact-card'
import { STATIC_COUNTRIES } from '@/lib/countries'
import { getFullUrl } from '@/lib/constants'

/**
 * A byline's own page: what they filed, who they filed it to, and what they
 * cover.
 *
 * ## Two shapes, and why there are two
 *
 * ```
 *   /author/abubakar-ibrahim               a person, across the whole corpus
 *   /author/the-herald/herald-reporter     a newsroom's DESK, scoped to it
 * ```
 *
 * The second exists because a desk byline is not a person. Measured on the live
 * cluster, "Staff Reporter" is 198 articles across ten mastheads in four
 * countries; one page headed with that name would tell the reader a single
 * journalist wrote all of them. `@/lib/author-identity` holds the closed
 * lexicon that decides which shape a byline gets, and the page states the
 * distinction rather than hiding it behind the URL.
 *
 * ISR at an hour: a byline's article list moves when they file, which is a
 * timescale of hours, and the read behind it is a scan of the corpus (there is
 * no index on `author.name` — see `@/lib/mongodb/authors`).
 */
export const revalidate = 3600

interface AuthorRouteProps {
  params: Promise<{ slug: string[] }>
}

/**
 * Split the catch-all into a byline and, for a desk, its newsroom.
 *
 * Anything that is not one or two segments is not an address this page issues,
 * so it is rejected here rather than being coerced into the nearest valid one —
 * a URL nobody generated should 404, not silently resolve to someone's page.
 */
function parseRoute(segments: string[]): { slug: string; newsroomSlug?: string } | null {
  const parts = segments.map((s) => decodeURIComponent(s)).filter(Boolean)
  if (parts.length === 1) return { slug: parts[0] }
  if (parts.length === 2) return { newsroomSlug: parts[0], slug: parts[1] }
  return null
}

/**
 * Resolve once per request.
 *
 * `generateMetadata` and the page body both need the whole answer, and the
 * profile behind it is a corpus scan. `cache` collapses the two calls into one
 * for the duration of the render.
 */
const loadPage = cache(
  async (slug: string, newsroomSlug?: string): Promise<AuthorPage | null> =>
    getAuthorPageAction(slug, newsroomSlug)
)

const COUNTRY_NAMES = new Map(STATIC_COUNTRIES.map((c) => [c.code, c.name]))

/** Turn a slug into something readable without asserting a capitalisation the corpus never stored. */
function humanise(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\p{Ll}/gu, (c) => c.toUpperCase())
}

/**
 * A page's own canonical URL path.
 *
 * Built with the same `authorSlug` the byline link and the route resolver use.
 * A second local copy of the fold is how the link and the canonical drift apart
 * over an apostrophe or an accent, and neither would report it.
 */
function canonicalPath(page: AuthorPage): string {
  return page.newsroom
    ? `/author/${authorSlug(page.newsroom.name)}/${page.slug}`
    : `/author/${page.slug}`
}

export async function generateMetadata({ params }: AuthorRouteProps): Promise<Metadata> {
  const route = parseRoute((await params).slug)
  const page = route ? await loadPage(route.slug, route.newsroomSlug) : null
  if (!page) return { title: 'Byline not found' }

  const title = page.newsroom ? `${page.name}, ${page.newsroom.name}` : page.name
  const description = page.desk
    ? `Reporting filed under the ${page.name} byline at ${page.newsroom?.name}.`
    : `Articles by ${page.name}, and the African newsrooms they publish through.`

  return {
    title,
    description,
    alternates: { canonical: getFullUrl(canonicalPath(page)) },
    openGraph: { title, description, url: getFullUrl(canonicalPath(page)), type: 'profile' },
  }
}

/** A labelled count, as a row. Used for sources and newsrooms. */
function FacetRows({ rows, icon }: { rows: LabelledFacet[]; icon: 'source' | 'newsroom' }) {
  const Icon = icon === 'source' ? Newspaper : Building2
  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.key} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="flex min-w-0 items-baseline gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0 self-center text-text-tertiary" aria-hidden="true" />
            <span className="truncate text-text-secondary">{row.label}</span>
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-text-tertiary">
            {row.count.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-outline bg-card p-4">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * Chips for one classification layer.
 *
 * Rows carrying an `href` link to the developing-story timeline for that tag or
 * category — which is the "stories this byline is covering" question, answered
 * with a surface that already exists. `engagement.topics` rows carry no href:
 * `/topic/[slug]` does not query that field, so linking one would send the
 * reader to a timeline with no coverage on it and read as a gap in the
 * reporting rather than a gap in the query.
 */
function Chips({ rows }: { rows: Array<LabelledFacet & { href?: string }> }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {rows.map((row) => {
        const text = (
          <>
            {row.label}
            <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-70">{row.count}</span>
          </>
        )
        return (
          <li key={row.key}>
            {row.href ? (
              <Link
                href={row.href}
                className="inline-flex min-h-[var(--touch-chip)] items-center rounded-full bg-elevated px-3 text-xs text-text-secondary transition-colors hover:bg-container-tanzanite hover:text-on-container-tanzanite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {text}
              </Link>
            ) : (
              <span className="inline-flex min-h-[var(--touch-chip)] items-center rounded-full bg-elevated px-3 text-xs text-text-secondary">
                {text}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default async function AuthorRoute({ params }: AuthorRouteProps) {
  const route = parseRoute((await params).slug)
  const page = route ? await loadPage(route.slug, route.newsroomSlug) : null
  if (!page) notFound()

  const { profile } = page
  // Only countries the app can NAME. An unrecognised ISO code printed raw reads
  // as a typo rather than a place, and `countryCode` is stamped by ingestion
  // from the feed source and never guessed — so an unknown code means this
  // app's country list is behind `places`, not that the article is from nowhere.
  const countries = profile.countries
    .map((c) => ({ ...c, label: COUNTRY_NAMES.get(c.key) }))
    .filter((c): c is { key: string; count: number; label: string } => Boolean(c.label))
  // `engagement.topics` is the closed set of 12 the pipeline classifies against.
  // Measured 2026-09-10 it is written on NO article in this corpus — the
  // collection is seeded separately (nyuchi/mukoko-news-gateway#16) and the
  // enrichment worker still runs on its pinned fallback — so this panel renders
  // nothing today and lights up on its own when the pipeline starts writing it.
  const topics: LabelledFacet[] = profile.topics.map((t) => ({ ...t, label: humanise(t.key) }))

  return (
    <PageContainer as="main" className="py-8">
      <Link
        href="/sources"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-foreground focus-visible:underline focus-visible:outline-none"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Sources
      </Link>

      <header className="mb-8 border-b border-border pb-6">
        <p className="mb-1 font-mono text-[13px] uppercase tracking-wide text-text-tertiary">
          {page.desk ? 'Newsroom desk' : 'Byline'}
        </p>
        <h1 className="font-serif text-3xl font-semibold text-foreground sm:text-4xl">
          {page.name}
        </h1>

        {/* A desk byline says whose desk it is, in the page's own words. The URL
            already scopes it, but a reader does not read the URL — and the whole
            reason this page is scoped is that the same label belongs to ten
            different newsrooms. */}
        {page.newsroom && (
          <p className="mt-2 text-sm text-text-secondary">
            The staff byline of <span className="font-semibold text-foreground">{page.newsroom.name}</span>.
            Mukoko does not treat it as one journalist — the same label is used by other newsrooms,
            and each is counted separately.
          </p>
        )}

        <p className="mt-3 text-sm text-text-tertiary">
          {profile.total.toLocaleString()} {profile.total === 1 ? 'article' : 'articles'} in the last{' '}
          {Math.round(profile.windowDays / 30)} months
          {profile.sources.length > 0 && (
            <>
              {' · '}
              {profile.sources.length === 1
                ? '1 source'
                : `${profile.sources.length} sources`}
            </>
          )}
          {countries.length > 0 && (
            <>
              {' · '}
              {countries.map((c) => c.label).join(', ')}
            </>
          )}
        </p>
      </header>

      {profile.total === 0 ? (
        /* The byline is in the directory, so it published something; this read
           came back empty, which means the corpus could not be reached rather
           than that they have written nothing. Say the former. */
        <p className="text-sm text-text-secondary">
          We could not load this byline&rsquo;s articles just now. Please try again shortly.
        </p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
          <div className="min-w-0">
            <h2 className="mb-4 font-serif text-xl font-semibold text-foreground">
              Latest reporting
            </h2>
            <div className="space-y-2">
              {profile.articles.map((article, index) => (
                <CompactCard key={article.id} article={article} index={index} />
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            {profile.sources.length > 0 && (
              <Panel title="Publishes through">
                <FacetRows rows={page.sources} icon="source" />
              </Panel>
            )}

            {/* Only when it adds something: a desk page is one newsroom by
                definition, and most people file to one masthead. */}
            {!page.desk && page.newsrooms.length > 1 && (
              <Panel title="Newsrooms">
                <FacetRows rows={page.newsrooms} icon="newsroom" />
              </Panel>
            )}

            {page.tags.length > 0 && (
              <Panel title="Stories they cover">
                <Chips rows={page.tags} />
              </Panel>
            )}

            {page.categories.length > 0 && (
              <Panel title="Categories">
                <Chips rows={page.categories} />
              </Panel>
            )}

            {topics.length > 0 && (
              <Panel title="Topics">
                <Chips rows={topics} />
              </Panel>
            )}
          </aside>
        </div>
      )}
    </PageContainer>
  )
}
