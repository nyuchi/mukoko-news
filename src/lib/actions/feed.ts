'use server'

/**
 * Server Actions for fetching feed data directly from MongoDB.
 * Call these from Client Components instead of the api.* fetch helpers.
 * These run on the server — no Worker interception, no API roundtrip.
 */

import { getArticles, getArticleById, getNewsByteArticles, searchArticles } from '@/lib/mongodb/articles'
import { getCategories, getTrendingCategories } from '@/lib/mongodb/categories'
import { getSources, getStats } from '@/lib/mongodb/sources'
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
  const { countries, categories } = params

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
  return getArticles(params)
}

export async function getArticleAction(id: string) {
  return getArticleById(id)
}

export async function getNewsBytesAction(limit = 20) {
  return getNewsByteArticles(limit)
}

export async function searchArticlesAction(
  query: string,
  limit = 20,
  filters: { category?: string; countryCode?: string } = {},
) {
  return searchArticles(query, limit, filters)
}

export async function getCategoriesAction() {
  return getCategories()
}

export async function getTrendingCategoriesAction(limit = 8) {
  return getTrendingCategories(limit)
}

export async function getSourcesAction() {
  return getSources()
}

export async function getStatsAction() {
  return getStats()
}
