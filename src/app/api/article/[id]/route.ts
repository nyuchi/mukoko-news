import { NextRequest, NextResponse } from 'next/server'
import { getArticleById, getArticleBySlug } from '@/lib/mongodb/articles'

export const runtime = 'nodejs'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Try UUID id first, then slug
    const article = await getArticleById(id) ?? await getArticleBySlug(id)
    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 })
    }

    return NextResponse.json({ article })
  } catch (error) {
    console.error('[/api/article/[id]]', error)
    return NextResponse.json({ error: 'Failed to fetch article' }, { status: 500 })
  }
}
