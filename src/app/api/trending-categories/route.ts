import { NextRequest, NextResponse } from 'next/server'
import { getTrendingCategories } from '@/lib/mongodb/categories'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '8')
    const trending = await getTrendingCategories(limit)
    return NextResponse.json({ success: true, trending })
  } catch (error) {
    console.error('[/api/trending-categories]', error)
    return NextResponse.json({ error: 'Failed to fetch trending categories' }, { status: 500 })
  }
}
