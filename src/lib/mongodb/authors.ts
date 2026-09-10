/**
 * Reads behind `/author` — what one byline has actually published.
 *
 * Two reads, and the split between them is the whole design:
 *
 * 1. `getBylineDirectory` resolves a URL slug back to the raw byline strings it
 *    was made from. It has to exist because there is no author id anywhere in
 *    this platform — `author.name` is free text a publisher wrote, and the slug
 *    is a lossy fold of it (case, spacing, punctuation and diacritics all
 *    collapse). Recovering the name from the slug by regex would need a
 *    collection scan per page view; one shared, cached directory answers every
 *    author page instead.
 * 2. `getAuthorProfile` answers everything the page shows, from ONE `$facet`.
 *
 * ## Why both are windowed
 *
 * `news.articles` has no index on `author.name` (measured 2026-09-10: the eight
 * classic indexes are on `_id`, `datePublished+status`,
 * `datePublished+mediaOrganizationId`, `bundu.ubuntuScoreSnapshot+status`,
 * `aiProcessed+createdAt`, `externalUrl`, `slug` and `countryCode+feedSourceId`
 * — and the Atlas Search index does not map `author` either). So a byline match
 * is a scan, and the only thing that bounds it is the date window, which rides
 * `status_1_datePublished_-1` as a range seek. That is the same reason
 * `getSourceAuthors` is windowed.
 *
 * A year is the window because the corpus is younger than that — the oldest
 * articles date from 2026-05 — so today it is every article the platform holds
 * while still bounding the read as the corpus grows. The page states the window
 * rather than implying it is a career total.
 */

import { getDb, QUERY_MAX_TIME_MS } from './client'
import { clampInt } from '@/lib/safety'
import { getArticlesByIds } from './articles'
import { authorSlug, isDeskByline } from '@/lib/author-identity'
import type { Article } from '@/lib/api'

export const AUTHOR_WINDOW_DAYS = 365

/**
 * Ceiling on rows returned by the directory read.
 *
 * 3,792 distinct raw bylines on the live corpus today. The cap is an order of
 * magnitude above that so it never truncates in practice, and exists so a
 * pipeline fault that starts minting bylines degrades this into "some author
 * links 404" rather than into a multi-megabyte cached blob on every page.
 */
const DIRECTORY_LIMIT = 40_000

/** How many rows each breakdown panel carries. Enough to be useful, few enough to read. */
const PANEL_LIMIT = 10
const TAG_PANEL_LIMIT = 18
const ARTICLE_LIMIT = 24

function windowStart(days = AUTHOR_WINDOW_DAYS): Date {
  return new Date(Date.now() - days * 86400_000)
}

/** Articles a reader may see: not rejected by ingestion, not removed by moderation. */
const VISIBLE = {
  status: { $ne: 'rejected' },
  moderationStatus: { $ne: 'removed' },
} as const

export interface BylineIdentity {
  /** The URL segment. Unique within the directory. */
  slug: string
  /** How the byline is spelled on the page — the most-published raw variant. */
  name: string
  /**
   * Every raw `author.name` spelling that folds to this slug.
   *
   * The profile read matches on these EXACTLY (`$in`) rather than on a
   * case-insensitive regex: an equality match can at least be served from an
   * index if one is ever added, and a regex never can. Measured live, 188 of
   * 3,600 folded keys carry more than one spelling, so the list is routinely
   * longer than one.
   */
  variants: string[]
  articles: number
  /** Newsroom ids (`articles.mediaOrganizationId`) this byline has filed to. */
  newsroomIds: string[]
  /** True when this is a newsroom's desk, not a person — see `@/lib/author-identity`. */
  desk: boolean
}

/**
 * Every byline in the window, folded onto its slug.
 *
 * Fail-soft: an unreachable cluster yields an empty directory, and the caller
 * turns that into a 404 rather than into an author page with no articles on it.
 * An empty directory means "we could not look", never "this journalist has
 * published nothing".
 */
export async function getBylineDirectory(): Promise<BylineIdentity[]> {
  try {
    const db = await getDb()
    const rows = await db
      .collection('articles')
      .aggregate<{ _id: string; articles: number; newsroomIds: (string | null)[] }>(
        [
          {
            $match: {
              ...VISIBLE,
              datePublished: { $gte: windowStart() },
              'author.name': { $type: 'string', $ne: '' },
            },
          },
          {
            // `author.name`, never `$author` — the byline is a Schema.org
            // sub-document, and grouping on the whole object renders every row
            // as "[object Object]". That bug is on record in
            // `getTrendingAuthors`; this read must not repeat it.
            $group: {
              _id: '$author.name',
              articles: { $sum: 1 },
              newsroomIds: { $addToSet: '$mediaOrganizationId' },
            },
          },
          { $sort: { articles: -1, _id: 1 } },
          { $limit: DIRECTORY_LIMIT },
        ],
        { maxTimeMS: QUERY_MAX_TIME_MS }
      )
      .toArray()

    // Fold the raw spellings onto their slugs. Ordered by article count above,
    // so the first spelling to reach a slug is the most-published one and
    // becomes the display name.
    const bySlug = new Map<string, BylineIdentity>()
    for (const row of rows) {
      const raw = String(row._id).trim()
      const slug = authorSlug(raw)
      // A byline that folds to nothing (punctuation only) has no address. It is
      // skipped rather than bucketed under an empty slug, which would merge
      // unrelated bylines into one page.
      if (!raw || !slug) continue

      const newsroomIds = row.newsroomIds.filter((id): id is string => typeof id === 'string' && id !== '')
      const existing = bySlug.get(slug)
      if (existing) {
        existing.variants.push(raw)
        existing.articles += row.articles
        for (const id of newsroomIds) {
          if (!existing.newsroomIds.includes(id)) existing.newsroomIds.push(id)
        }
      } else {
        bySlug.set(slug, {
          slug,
          name: raw,
          variants: [raw],
          articles: row.articles,
          newsroomIds,
          desk: isDeskByline(raw),
        })
      }
    }

    return [...bySlug.values()]
  } catch (error) {
    console.error('[authors.getBylineDirectory]', error)
    return []
  }
}

/** One row of a breakdown panel: a thing, and how often this byline filed under it. */
export interface AuthorFacet {
  key: string
  count: number
}

export interface AuthorProfile {
  total: number
  firstPublished?: string
  lastPublished?: string
  /** Feed sources, by id — the caller resolves names from the source catalogue. */
  sources: AuthorFacet[]
  /** Newsrooms, by `mediaOrganizationId` — resolved against the publisher catalogue. */
  newsrooms: AuthorFacet[]
  /** ISO country codes. */
  countries: AuthorFacet[]
  /** `engagement.topics` — the closed 12 the pipeline classifies against. */
  topics: AuthorFacet[]
  /** `engagement.interest_categories` — the closed, platform-wide 40. */
  categories: AuthorFacet[]
  /** `engagement.tags` — open by design, so this is the only unbounded vocabulary here. */
  tags: AuthorFacet[]
  articles: Article[]
  windowDays: number
}

const EMPTY_PROFILE: AuthorProfile = {
  total: 0,
  sources: [],
  newsrooms: [],
  countries: [],
  topics: [],
  categories: [],
  tags: [],
  articles: [],
  windowDays: AUTHOR_WINDOW_DAYS,
}

/** A `$group`/`$sort`/`$limit` breakdown over one already-unwound field. */
function tally(limit: number) {
  return [
    { $group: { _id: '$k', count: { $sum: 1 } } },
    { $match: { _id: { $type: 'string', $ne: '' } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
  ]
}

function toFacets(rows: Array<{ _id: unknown; count: number }> | undefined): AuthorFacet[] {
  return (rows ?? []).map((r) => ({ key: String(r._id), count: r.count }))
}

/**
 * Everything the author page shows, from one pass over the byline's articles.
 *
 * `newsroomIds`, when given, scopes the whole profile to those newsrooms. That
 * is not an optional refinement — it is how a DESK byline is made truthful.
 * "Staff Reporter" is 198 articles across ten newsrooms in four countries, and
 * an unscoped profile would present all of them as one writer's work.
 *
 * One `$facet` rather than seven queries: the `$match` is the expensive half
 * (no index on `author.name` — see the file header), so running it once and
 * branching afterwards is the difference between one scan and seven.
 */
export async function getAuthorProfile(params: {
  variants: string[]
  newsroomIds?: string[]
  articleLimit?: number
}): Promise<AuthorProfile> {
  const variants = params.variants.filter((v) => typeof v === 'string' && v.trim() !== '')
  if (variants.length === 0) return EMPTY_PROFILE

  const articleLimit = clampInt(params.articleLimit, 1, 60, ARTICLE_LIMIT)

  try {
    const db = await getDb()
    const match: Record<string, unknown> = {
      ...VISIBLE,
      datePublished: { $gte: windowStart() },
      'author.name': { $in: variants },
    }
    if (params.newsroomIds?.length) {
      match.mediaOrganizationId = { $in: params.newsroomIds }
    }

    const [result] = await db
      .collection('articles')
      .aggregate<{
        totals: Array<{ total: number; first?: Date; last?: Date }>
        sources: Array<{ _id: unknown; count: number }>
        newsrooms: Array<{ _id: unknown; count: number }>
        countries: Array<{ _id: unknown; count: number }>
        topics: Array<{ _id: unknown; count: number }>
        categories: Array<{ _id: unknown; count: number }>
        tags: Array<{ _id: unknown; count: number }>
        recent: Array<{ _id: string }>
      }>(
        [
          { $match: match },
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    first: { $min: '$datePublished' },
                    last: { $max: '$datePublished' },
                  },
                },
              ],
              sources: [{ $project: { k: '$feedSourceId' } }, ...tally(PANEL_LIMIT)],
              newsrooms: [{ $project: { k: '$mediaOrganizationId' } }, ...tally(PANEL_LIMIT)],
              countries: [{ $project: { k: '$countryCode' } }, ...tally(PANEL_LIMIT)],
              topics: [
                { $unwind: '$engagement.topics' },
                { $project: { k: '$engagement.topics' } },
                ...tally(PANEL_LIMIT),
              ],
              categories: [
                { $unwind: '$engagement.interest_categories' },
                { $project: { k: '$engagement.interest_categories' } },
                ...tally(PANEL_LIMIT),
              ],
              tags: [
                { $unwind: '$engagement.tags' },
                {
                  // `engagement.tags` elements are plain slugs on articles the
                  // current pipeline enriched and `{slug, name}` objects on
                  // older ones. Reading only one shape would silently report a
                  // long-serving byline as having no tags at all.
                  $project: {
                    k: {
                      $cond: [
                        { $eq: [{ $type: '$engagement.tags' }, 'object'] },
                        '$engagement.tags.slug',
                        '$engagement.tags',
                      ],
                    },
                  },
                },
                ...tally(TAG_PANEL_LIMIT),
              ],
              recent: [
                { $sort: { datePublished: -1 } },
                { $limit: articleLimit },
                { $project: { _id: 1 } },
              ],
            },
          },
        ],
        { maxTimeMS: QUERY_MAX_TIME_MS }
      )
      .toArray()

    if (!result) return EMPTY_PROFILE

    const totals = result.totals[0]
    return {
      total: totals?.total ?? 0,
      firstPublished: totals?.first?.toISOString(),
      lastPublished: totals?.last?.toISOString(),
      sources: toFacets(result.sources),
      newsrooms: toFacets(result.newsrooms),
      countries: toFacets(result.countries),
      topics: toFacets(result.topics),
      categories: toFacets(result.categories),
      tags: toFacets(result.tags),
      articles: await getArticlesByIds(result.recent.map((r) => r._id)),
      windowDays: AUTHOR_WINDOW_DAYS,
    }
  } catch (error) {
    console.error('[authors.getAuthorProfile]', error)
    return EMPTY_PROFILE
  }
}
