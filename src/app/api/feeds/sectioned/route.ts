import { NextRequest, NextResponse } from 'next/server'
import { getArticles } from '@/lib/mongodb/articles'
import { checkRateLimit, getRequestIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request)
  if (!checkRateLimit(`feeds:${ip}`)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const { searchParams } = request.nextUrl
    const countriesRaw = searchParams.get('countries')
    const countries = countriesRaw ? countriesRaw.split(',').filter(Boolean) : undefined

    const categoriesRaw = searchParams.get('categories')
    const categories = categoriesRaw ? categoriesRaw.split(',').filter(Boolean) : undefined

    const [topResult, latestResult, categoryResult] = await Promise.all([
      getArticles({ limit: 5, page: 1, countries, sort: 'popular' }),
      getArticles({ limit: 20, page: 1, countries, sort: 'latest' }),
      categories?.length
        ? getArticles({ limit: 10, page: 1, countries, categories, sort: 'latest' })
        : Promise.resolve(null),
    ])

    // Top stories as simple clusters (single-article clusters)
    const topStories = topResult.articles.map(article => ({
      id: article.id,
      primaryArticle: article,
      relatedArticles: [],
      articleCount: 1,
    }))

    // Your news: category-filtered if categories were supplied, else latest
    const yourNews = categoryResult?.articles ?? latestResult.articles.slice(0, 10)

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
