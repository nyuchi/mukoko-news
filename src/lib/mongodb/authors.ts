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
 * ## Both reads are unindexed, and the window does NOT rescue them
 *
 * ⚠️ **Corrected 2026-09-17.** This header used to claim that the 365-day
 * window "rides `status_1_datePublished_-1` as a range seek". It does not, and
 * that claim is why nobody looked when every byline page started answering
 * "Byline not found" over a corpus of 65,203 articles. Two independent reasons:
 *
 * 1. **`$ne` on the leading key forbids the seek.** `VISIBLE` opens with
 *    `status: {$ne: 'rejected'}`, which is a RANGE predicate on the index's
 *    first field — bounds of `[MinKey, "rejected") ∪ ("rejected", MaxKey]`,
 *    i.e. the whole key space less one point. With a range rather than an
 *    equality on the leading key, the `datePublished` bound on the second key
 *    cannot narrow the scan's entry point. This is the same shape, on the same
 *    collection, as the `/insights` incident already on record in `CLAUDE.md`:
 *    explained live, a `$facet` behind that identical `$ne` pair took 27,529 ms
 *    and examined all 65,203 documents with ZERO index keys.
 * 2. **The window is wider than the corpus.** The oldest articles date from
 *    2026-05, so a 365-day window excludes nothing. Even a perfect range seek
 *    would return every key in the collection. The window bounds this read
 *    later, as the corpus ages — it bounds nothing today.
 *
 * And `author.name`, `moderationStatus` and `mediaOrganizationId` appear in NO
 * index (classic or Atlas Search), so every candidate must be FETCHed from the
 * 1.5 GB collection regardless of how it was found. Measured 2026-09-17 on a
 * direct connection, the directory `$group` did not return within 60 seconds;
 * bounded by `QUERY_MAX_TIME_MS` it throws instead.
 *
 * **Nothing in this file can fix that** — the fix is an index on
 * `{'author.name': 1, datePublished: -1}`, which is a live-cluster change this
 * repo does not make. What this file CAN do, and now does, is refuse to pass a
 * failed read off as a finding: both reads carry `ok`, so the caller can tell
 * "we could not look" from "there is nothing there". A byline directory that
 * came back empty because the cluster timed out must never reach a reader as
 * the statement that a journalist does not exist.
 *
 * A year is the window because the corpus is younger than that, so today it is
 * every article the platform holds while still bounding the read as the corpus
 * grows. The page states the window rather than implying it is a career total.
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
 * The directory read's answer, and whether it is an answer at all.
 *
 * `ok` exists because `bylines: []` is what BOTH outcomes look like: a corpus
 * with no attributed articles in it, and a read that timed out. They are not
 * the same claim — the second one is about our cluster and the first one is
 * about journalists — and the caller cannot tell them apart from the list.
 * Same flag, same reason, as `CorpusSummary.ok`.
 */
export interface BylineDirectory {
  /** False when the read failed. `bylines` is then empty but means NOTHING. */
  ok: boolean
  bylines: BylineIdentity[]
}

/**
 * Every byline in the window, folded onto its slug.
 *
 * Fail-soft in the sense that it does not throw — but NOT silent: a failure
 * comes back as `{ok: false, bylines: []}`, and a caller that ignores `ok` is
 * publishing an outage as a fact about a named person. See the header.
 */
export async function getBylineDirectory(): Promise<BylineDirectory> {
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

    return { ok: true, bylines: [...bySlug.values()] }
  } catch (error) {
    // `maxTimeMS` firing lands here, and that is the expected failure today —
    // see the header. Empty, and SAID to be empty for the wrong reason.
    console.error('[authors.getBylineDirectory]', error)
    return { ok: false, bylines: [] }
  }
}

/** One row of a breakdown panel: a thing, and how often this byline filed under it. */
export interface AuthorFacet {
  key: string
  count: number
}

export interface AuthorProfile {
  /**
   * False when the read failed, so every figure below is absent rather than
   * zero. `total: 0` is otherwise ambiguous: a byline whose window has aged
   * out reads identically to a byline whose read timed out, and only one of
   * those is a statement about the journalist.
   */
  ok: boolean
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

/** A genuine nothing: the match ran and found no articles. */
const EMPTY_PROFILE: AuthorProfile = {
  ok: true,
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

/** Not a nothing: we could not look. Shaped the same, claims the opposite. */
const UNAVAILABLE_PROFILE: AuthorProfile = { ...EMPTY_PROFILE, ok: false }

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
      ok: true,
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
    return UNAVAILABLE_PROFILE
  }
}
