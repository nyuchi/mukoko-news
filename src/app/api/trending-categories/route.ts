import { NextRequest, NextResponse } from 'next/server'
import { getTrendingCategories } from '@/lib/mongodb/categories'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const rawLimit = parseInt(request.nextUrl.searchParams.get('limit') || '8')
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 8), 50)
    const trending = await getTrendingCategories(limit)
    return NextResponse.json({ success: true, trending })
  } catch (error) {
    console.error('[/api/trending-categories]', error)
    return NextResponse.json({ error: 'Failed to fetch trending categories' }, { status: 500 })
  }
}
