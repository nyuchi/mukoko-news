'use server'

/**
 * Server Actions for fetching feed data directly from MongoDB.
 * Call these from Client Components instead of the api.* fetch helpers.
 * These run on the server — no Worker interception, no API roundtrip.
 *
 * Server Actions are a public RPC surface: every param is validated/clamped
 * via `@/lib/safety` before it reaches the MongoDB layer. Reads degrade
 * gracefully to safe defaults rather than throwing to the client.
 */

import { cookies } from 'next/headers'
import { unstable_cache } from 'next/cache'
import { getCountries } from '@/lib/mongodb/places'
import { getDb } from '@/lib/mongodb/client'
import { resolveEngagementSubject, claimSessionEngagement } from '@/lib/engagement'
import { getArticles, getArticleById, getRelatedArticles, getNewsByteArticles, searchArticles, getSavedArticles, getTopicTimeline } from '@/lib/mongodb/articles'
import { getCategories, getTrendingCategories } from '@/lib/mongodb/categories'
import { getSources, getStats, getTrendingAuthors } from '@/lib/mongodb/sources'
import { getTopCountriesByRecentVolume } from '@/lib/mongodb/coverage'
import {
  clampInt,
  countryCodeSchema,
  idSchema,
  parseOrDefault,
  safeFeedParams,
  searchQuerySchema,
  boundedTextSchema,
} from '@/lib/safety'
import type { Article } from '@/lib/api'

/**
 * Run a read, and on failure return `fallback` instead of throwing.
 *
 * The module docstring above has always claimed reads "degrade gracefully to safe
 * defaults rather than throwing to the client". Until now that was aspiration:
 * this file contained no error handling at all, so any Mongo failure propagated
 * straight out of the Server Action and became an HTTP 500. On 2026-09-10 that
 * turned a slow query into a blank site — the client logged only "An error
 * occurred in the Server Components render", because Next.js strips the message
 * in production, which is also why the real cause took a cluster session to find.
 *
 * A feed that renders without its trending rail is degraded. A feed that renders
 * nothing is broken. This makes the difference, and logs the real error
 * server-side where it is actually readable.
 */
async function safeRead<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch (error) {
    console.error(`[feed:${label}]`, error)
    return fallback
  }
}

export interface SectionedFeed {
  topStories: Array<{
    id: string
    primaryArticle: Article
    relatedArticles: Article[]
    articleCount: number
  }>
  yourNews: Article[]
  byCategory: Array<{
    id: string
    name: string
    articles: Article[]
  }>
  latest: Article[]
  countries: string[]
  timestamp: string
  /** Keyset position to continue the `latest` rail from. Null when exhausted. */
  nextCursor: string | null
  hasMore: boolean
  /**
   * True when at least one of the underlying reads failed and its section fell
   * back to empty. The UI can say "some sections could not load" instead of
   * silently implying the corpus is empty.
   */
  degraded: boolean
}

const EMPTY_PAGE = {
  articles: [] as Article[],
  total: null,
  nextCursor: null,
  hasMore: false,
}

export async function getSectionedFeedAction(params: {
  countries?: string[]
  categories?: string[]
} = {}): Promise<SectionedFeed> {
  const { countries, categories } = safeFeedParams(params)

  // Each rail is read independently and degrades on its own. Previously these
  // shared one Promise.all with no catch, so a single failing rail took the whole
  // page down — the strictly worse trade, since the rails are independent.
  let degraded = false
  const track = <T>(label: string, read: () => Promise<T>, fallback: T) =>
    safeRead(label, read, fallback).then((v) => {
      if (v === fallback) degraded = true
      return v
    })

  const [topResult, latestResult, categoryResult] = await Promise.all([
    track('topStories', () => getArticles({ limit: 5, sort: 'popular', countries }), EMPTY_PAGE),
    track('latest', () => getArticles({ limit: 20, sort: 'latest', countries }), EMPTY_PAGE),
    // Fallback is `null`, not EMPTY_PAGE, so a failed category read falls through
    // to the existing "?? latest.slice(0, 10)" below. Returning an empty page
    // would satisfy `??` and leave the rail blank instead.
    categories?.length
      ? track('yourNews', () => getArticles({ limit: 10, countries, categories, sort: 'latest' }), null)
      : Promise.resolve(null),
  ])

  const topStories = topResult.articles.map(article => ({
    id: article.id,
    primaryArticle: article,
    relatedArticles: [] as Article[],
    articleCount: 1,
  }))

  const yourNews = categoryResult?.articles ?? latestResult.articles.slice(0, 10)

  const byCategoryMap = new Map<string, Article[]>()
  for (const article of latestResult.articles) {
    const cat = article.category ?? 'General'
    if (!byCategoryMap.has(cat)) byCategoryMap.set(cat, [])
    byCategoryMap.get(cat)!.push(article)
  }
  const byCategory = [...byCategoryMap.entries()].slice(0, 4).map(([name, articles]) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    articles: articles.slice(0, 4),
  }))

  return {
    topStories,
    yourNews,
    byCategory,
    latest: latestResult.articles,
    countries: countries ?? [],
    timestamp: new Date().toISOString(),
    nextCursor: latestResult.nextCursor,
    hasMore: latestResult.hasMore,
    degraded,
  }
}

export async function getArticlesAction(params: {
  limit?: number
  page?: number
  /** Keyset position from a previous page's `nextCursor`. Preferred over `page`. */
  cursor?: string
  category?: string
  categories?: string[]
  countries?: string[]
  sort?: 'latest' | 'popular'
} = {}) {
  const safe = safeFeedParams(params)
  // The cursor is opaque and self-validating (`decodeArticleCursor` rejects
  // anything malformed, over-long, or carrying an unparseable date), so it is
  // passed through rather than run past a schema that would only re-check base64.
  const cursor = typeof params.cursor === 'string' ? params.cursor : undefined
  return safeRead(
    'articles',
    () =>
      getArticles({
        limit: safe.limit ?? 20,
        page: safe.page ?? 1,
        cursor,
        category: safe.category,
        categories: safe.categories,
        countries: safe.countries,
        sort: safe.sort === 'popular' ? 'popular' : 'latest',
      }),
    { articles: [] as Article[], total: null, nextCursor: null, hasMore: false }
  )
}

export async function getArticleAction(id: string) {
  const safeId = parseOrDefault(idSchema, id, null)
  if (!safeId) return null
  return safeRead('article', () => getArticleById(safeId), null)
}

/**
 * Articles related to this one — Atlas Vector Search over the article's own
 * BGE-M3 embedding, falling back to same-category recency when the article has
 * no embedding yet.
 *
 * `getRelatedArticles` has existed in the Mongo layer since the reads were
 * written and nothing ever called it: there was no Server Action, so the
 * article page ended at the body and a reader's only next step was the browser
 * back button. That is a dead end on the one page where the reader has already
 * shown what they are interested in.
 *
 * Fail-soft like every read on this path — an empty list renders no section at
 * all, never an empty "More in …" heading.
 */
export async function getRelatedArticlesAction(articleId: string, limit = 3) {
  const safeId = parseOrDefault(idSchema, articleId, null)
  if (!safeId) return [] as Article[]
  return safeRead(
    'related',
    () => getRelatedArticles(safeId, clampInt(limit, 1, 12, 3)),
    [] as Article[]
  )
}

export async function getNewsBytesAction(limit = 20) {
  return safeRead(
    'newsbytes',
    () => getNewsByteArticles(clampInt(limit, 1, 100, 20)),
    [] as Article[]
  )
}

export async function searchArticlesAction(
  query: string,
  limit = 20,
  filters: { category?: string; countryCode?: string } = {},
) {
  const safeQuery = parseOrDefault(searchQuerySchema, query, null)
  if (!safeQuery) return [] as Article[]

  const safeFilters =
    filters && typeof filters === 'object'
      ? {
          category: parseOrDefault(boundedTextSchema(50), filters.category, undefined),
          countryCode: parseOrDefault(countryCodeSchema, filters.countryCode, undefined),
        }
      : {}

  return safeRead(
    'search',
    () => searchArticles(safeQuery, clampInt(limit, 1, 100, 20), safeFilters),
    [] as Article[]
  )
}

/**
 * The nav's category list.
 *
 * Cached, because the answer is identical for every visitor and changes on the
 * timescale of a newsroom's beat mix, not a page view. `news.categories` is
 * empty on the live cluster, so this always takes the derive-from-articles path
 * — a bounded aggregation that still costs ~1.4s. Paying that once an hour is
 * reasonable; paying it on every home-page and nav render, as it was, is what
 * saturated the connection pool.
 *
 * Every reader on a metered connection also benefits: a cached result is served
 * from the same rendered HTML rather than re-derived per visit.
 */
const cachedCategories = unstable_cache(() => getCategories(), ['nav-categories'], {
  revalidate: 3600,
  tags: ['categories'],
})

const cachedTrendingCategories = unstable_cache(
  (limit: number) => getTrendingCategories(limit),
  ['trending-categories'],
  { revalidate: 900, tags: ['categories'] }
)

export async function getCategoriesAction() {
  return safeRead('categories', () => cachedCategories(), [])
}

export async function getTrendingCategoriesAction(limit = 8) {
  return safeRead(
    'trendingCategories',
    () => cachedTrendingCategories(clampInt(limit, 1, 100, 8)),
    []
  )
}

export async function getSourcesAction() {
  return safeRead('sources', () => getSources(), [])
}

export async function getStatsAction() {
  // The category count is composed here rather than queried: `news.categories`
  // is deprecated (it always counted 0), and the honest number is the size of
  // the derived list — which `cachedCategories` already has in hand.
  const [stats, categories] = await Promise.all([
    safeRead('stats', () => getStats(), {
      database: { total_articles: 0, active_sources: 0, today_articles: 0 },
    }),
    safeRead('categories', () => cachedCategories(), [] as Awaited<ReturnType<typeof getCategories>>),
  ])
  return { database: { ...stats.database, categories: categories.length } }
}

export async function getTrendingAuthorsAction(limit = 5) {
  return safeRead('trendingAuthors', () => getTrendingAuthors(clampInt(limit, 1, 100, 5)), {
    trending_authors: [],
  })
}

export async function getSavedArticlesAction() {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get('mukoko_session')?.value
  const safeSessionId = parseOrDefault(idSchema, sessionId, null)

  // Signed-in users read by their stable user key (saves follow the account);
  // any anonymous cookie history is claimed for the user on the way through.
  const subject = await resolveEngagementSubject(safeSessionId ?? undefined)
  if (subject.isUser && subject.key) {
    if (safeSessionId) {
      await claimSessionEngagement(await getDb(), safeSessionId, subject.key)
    }
    return getSavedArticles(subject.key)
  }

  if (!safeSessionId) return { articles: [] as Article[] }
  return getSavedArticles(safeSessionId)
}

/** Topic slugs are enrichment-generated: lowercase words joined by hyphens. */
const topicSlugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function getTopicTimelineAction(slug: string, days = 30) {
  const trimmed = typeof slug === 'string' ? slug.trim().toLowerCase().slice(0, 64) : ''
  if (!topicSlugRe.test(trimmed)) {
    return { topic: trimmed, articles: [] as Article[], total: 0 }
  }
  const result = await getTopicTimeline(trimmed, { days: clampInt(days, 1, 90, 30) })
  return { topic: trimmed, ...result }
}

/**
 * The countries onboarding should offer, ranked by what the corpus is actually
 * publishing right now.
 *
 * Cached rather than queried per visitor: the answer is identical for everyone
 * and this backs a first-run modal, so without it every new reader would pay for
 * the same aggregation. An hour is well inside the rate at which coverage moves.
 */
const cachedTopCountries = unstable_cache(
  (limit: number) => getTopCountriesByRecentVolume(limit),
  ['onboarding-top-countries'],
  { revalidate: 3600, tags: ['coverage'] }
)

export async function getTopCountriesAction(limit = 6) {
  return cachedTopCountries(clampInt(limit, 1, 24, 6))
}

/**
 * The country list, from the `places` domain that owns geography.
 *
 * The hand-maintained `COUNTRIES` constant matched `places` exactly at the time
 * of writing, but nothing kept them that way — a country added to the SSOT, or
 * the platform expanding past Africa, would never have reached this app. Now
 * `places` decides which countries exist and what they are called; the constant
 * only supplies the flag and accent colour, which are presentation and not
 * geography.
 *
 * Cached for a day. This is the slowest-moving data the app reads — countries
 * do not change hourly — and every visitor gets the same answer, so querying it
 * per render would be pure waste. `getCountries` is fail-soft to the static
 * list, so a bad read yields a slightly stale picker rather than an empty one.
 */
const cachedCountries = unstable_cache(() => getCountries(), ['places-countries'], {
  revalidate: 86400,
  tags: ['countries'],
})

export async function getCountriesAction() {
  return cachedCountries()
}
