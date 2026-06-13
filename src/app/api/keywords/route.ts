import { NextRequest, NextResponse } from 'next/server'
import { getTrendingTags } from '@/lib/mongodb/categories'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '32')
    const keywords = await getTrendingTags(limit)
    return NextResponse.json({ keywords, total: keywords.length })
  } catch (error) {
    console.error('[/api/keywords]', error)
    return NextResponse.json({ error: 'Failed to fetch keywords' }, { status: 500 })
  }
}
