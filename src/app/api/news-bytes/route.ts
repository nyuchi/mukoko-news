import { NextRequest, NextResponse } from 'next/server'
import { getNewsByteArticles } from '@/lib/mongodb/articles'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const rawLimit = parseInt(request.nextUrl.searchParams.get('limit') || '10')
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 10), 50)
    const articles = await getNewsByteArticles(limit)
    return NextResponse.json({ articles })
  } catch (error) {
    console.error('[/api/news-bytes]', error)
    return NextResponse.json({ error: 'Failed to fetch news bytes' }, { status: 500 })
  }
}
