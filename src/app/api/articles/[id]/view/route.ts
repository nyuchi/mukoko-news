import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb/client'

export const runtime = 'nodejs'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: articleId } = await params
    const db = await getDb()

    const result = await db.collection('articles').findOneAndUpdate(
      { _id: articleId as unknown as never },
      { $inc: { viewsCount: 1 }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after', projection: { viewsCount: 1 } }
    )

    return NextResponse.json({
      success: true,
      views: (result as Record<string, number> | null)?.viewsCount ?? 1,
    })
  } catch (error) {
    console.error('[/api/articles/[id]/view]', error)
    return NextResponse.json({ success: false, views: 0 }, { status: 500 })
  }
}
