import { NextRequest, NextResponse } from 'next/server'
import { getArticles } from '@/lib/mongodb/articles'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
    const page = Math.max(parseInt(searchParams.get('page') || '1'), 1)
    const category = searchParams.get('category') || undefined
    const sort = (searchParams.get('sort') || 'latest') as 'latest' | 'trending' | 'popular'

    const countriesRaw = searchParams.get('countries')
    const countries = countriesRaw ? countriesRaw.split(',').filter(Boolean) : undefined

    const result = await getArticles({ limit, page, category, countries, sort })
    return NextResponse.json({
      articles: result.articles,
      pagination: { page, limit, total: result.total },
    })
  } catch (error) {
    console.error('[/api/feeds]', error)
    return NextResponse.json({ error: 'Failed to fetch articles' }, { status: 500 })
  }
}
