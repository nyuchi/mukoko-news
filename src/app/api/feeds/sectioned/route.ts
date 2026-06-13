import { NextRequest, NextResponse } from 'next/server'
import { getArticles } from '@/lib/mongodb/articles'
import { getTrendingCategories } from '@/lib/mongodb/categories'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const countriesRaw = searchParams.get('countries')
    const countries = countriesRaw ? countriesRaw.split(',').filter(Boolean) : undefined

    const [topResult, latestResult, trending] = await Promise.all([
      getArticles({ limit: 5, page: 1, countries, sort: 'popular' }),
      getArticles({ limit: 20, page: 1, countries, sort: 'latest' }),
      getTrendingCategories(5),
    ])

    // Top stories as simple clusters (single-article clusters)
    const topStories = topResult.articles.map(article => ({
      id: article.id,
      primaryArticle: article,
      relatedArticles: [],
      articleCount: 1,
    }))

    // Your news: latest articles
    const yourNews = latestResult.articles.slice(0, 10)

    // By category: group remaining by section
    const byCategoryMap = new Map<string, typeof latestResult.articles>()
    for (const article of latestResult.articles) {
      const cat = article.category || 'General'
      if (!byCategoryMap.has(cat)) byCategoryMap.set(cat, [])
      byCategoryMap.get(cat)!.push(article)
    }
    const byCategory = Array.from(byCategoryMap.entries())
      .slice(0, 4)
      .map(([name, articles]) => ({
        id: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        articles: articles.slice(0, 4),
      }))

    return NextResponse.json({
      topStories,
      yourNews,
      byCategory,
      latest: latestResult.articles,
      countries: countries || [],
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/feeds/sectioned]', error)
    return NextResponse.json({ error: 'Failed to fetch sectioned feed' }, { status: 500 })
  }
}
