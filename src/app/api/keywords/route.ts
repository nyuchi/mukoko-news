import { NextRequest, NextResponse } from 'next/server'
import { getTrendingTags } from '@/lib/mongodb/categories'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const rawLimit = parseInt(request.nextUrl.searchParams.get('limit') || '32')
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 32), 100)
    const keywords = await getTrendingTags(limit)
    return NextResponse.json({ keywords, total: keywords.length })
  } catch (error) {
    console.error('[/api/keywords]', error)
    return NextResponse.json({ error: 'Failed to fetch keywords' }, { status: 500 })
  }
}
