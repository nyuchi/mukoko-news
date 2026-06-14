import { NextRequest, NextResponse } from 'next/server'
import { searchArticles } from '@/lib/mongodb/articles'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get('q') || '').slice(0, 200)
    const rawLimit = parseInt(request.nextUrl.searchParams.get('limit') || '20')
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20), 50)

    if (!q.trim()) {
      return NextResponse.json({ articles: [], results: [], query: '', count: 0 })
    }

    const results = await searchArticles(q.trim(), limit)
    return NextResponse.json({ articles: results, results, query: q, count: results.length, searchMethod: 'keyword' })
  } catch (error) {
    console.error('[/api/search]', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
