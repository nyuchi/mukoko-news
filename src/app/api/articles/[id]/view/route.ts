import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb/client'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: articleId } = await params
    const sessionId = request.cookies.get('mukoko_session')?.value || randomUUID()

    // Day bucket prevents a single session from inflating counts across the day
    const dayBucket = new Date().toISOString().slice(0, 10)

    const db = await getDb()

    // Validate article exists
    const article = await db.collection('articles').findOne(
      { _id: articleId as unknown as never },
      { projection: { _id: 1, viewsCount: 1 } }
    )
    if (!article) {
      return NextResponse.json({ success: false, views: 0 }, { status: 404 })
    }

    // Insert with unique {articleId, sessionId, dayBucket} — only $inc on success
    try {
      await db.collection('articleViews').insertOne({
        _id: randomUUID() as unknown as never,
        articleId,
        sessionId,
        dayBucket,
        createdAt: new Date(),
      })

      await db.collection('articles').updateOne(
        { _id: articleId as unknown as never },
        { $inc: { viewsCount: 1 }, $set: { updatedAt: new Date() } }
      )
    } catch (e: unknown) {
      if ((e as { code?: number }).code !== 11000) throw e
      // Duplicate in same day — silently ignore, don't increment
    }

    const updated = await db.collection('articles').findOne(
      { _id: articleId as unknown as never },
      { projection: { viewsCount: 1 } }
    )

    const response = NextResponse.json({
      success: true,
      views: (updated as Record<string, number> | null)?.viewsCount ?? 0,
    })

    if (!request.cookies.get('mukoko_session')) {
      response.cookies.set('mukoko_session', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 365,
      })
    }

    return response
  } catch (error) {
    console.error('[/api/articles/[id]/view]', error)
    return NextResponse.json({ success: false, views: 0 }, { status: 500 })
  }
}
