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
import { getDb } from '@/lib/mongodb/client'
import { resolveEngagementSubject, claimSessionEngagement } from '@/lib/engagement'
import { getArticles, getArticleById, getNewsByteArticles, searchArticles, getSavedArticles, getTopicTimeline } from '@/lib/mongodb/articles'
import { getCategories, getTrendingCategories } from '@/lib/mongodb/categories'
import { getSources, getStats, getTrendingAuthors } from '@/lib/mongodb/sources'
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
}

export async function getSectionedFeedAction(params: {
  countries?: string[]
  categories?: string[]
} = {}): Promise<SectionedFeed> {
  const { countries, categories } = safeFeedParams(params)

  const [topResult, latestResult, categoryResult] = await Promise.all([
    getArticles({ limit: 5, sort: 'popular', countries }),
    getArticles({ limit: 20, sort: 'latest', countries }),
    categories?.length
      ? getArticles({ limit: 10, countries, categories, sort: 'latest' })
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
  }
}

export async function getArticlesAction(params: {
  limit?: number
  page?: number
  category?: string
  categories?: string[]
  countries?: string[]
  sort?: 'latest' | 'popular'
} = {}) {
  const safe = safeFeedParams(params)
  return getArticles({
    limit: safe.limit ?? 20,
    page: safe.page ?? 1,
    category: safe.category,
    categories: safe.categories,
    countries: safe.countries,
    sort: safe.sort === 'popular' ? 'popular' : 'latest',
  })
}

export async function getArticleAction(id: string) {
  const safeId = parseOrDefault(idSchema, id, null)
  if (!safeId) return null
  return getArticleById(safeId)
}

export async function getNewsBytesAction(limit = 20) {
  return getNewsByteArticles(clampInt(limit, 1, 100, 20))
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

  return searchArticles(safeQuery, clampInt(limit, 1, 100, 20), safeFilters)
}

export async function getCategoriesAction() {
  return getCategories()
}

export async function getTrendingCategoriesAction(limit = 8) {
  return getTrendingCategories(clampInt(limit, 1, 100, 8))
}

export async function getSourcesAction() {
  return getSources()
}

export async function getStatsAction() {
  return getStats()
}

export async function getTrendingAuthorsAction(limit = 5) {
  return getTrendingAuthors(clampInt(limit, 1, 100, 5))
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
