import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb/client'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

// Simple like toggle — uses session cookie for idempotency.
// Replace sessionId with OIDC personId when auth is wired.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: articleId } = await params
    const sessionId = request.cookies.get('mukoko_session')?.value || randomUUID()

    const db = await getDb()
    const likesCol = db.collection('articleLikes')

    const existing = await likesCol.findOne({ articleId, sessionId })

    let liked: boolean
    if (existing) {
      await likesCol.deleteOne({ articleId, sessionId })
      await db.collection('articles').updateOne(
        { _id: articleId as unknown as never },
        { $inc: { likesCount: -1 }, $set: { updatedAt: new Date() } }
      )
      liked = false
    } else {
      await likesCol.insertOne({
        _id: randomUUID() as unknown as never,
        articleId,
        sessionId,
        createdAt: new Date(),
      })
      await db.collection('articles').updateOne(
        { _id: articleId as unknown as never },
        { $inc: { likesCount: 1 }, $set: { updatedAt: new Date() } }
      )
      liked = true
    }

    const article = await db.collection('articles').findOne(
      { _id: articleId as unknown as never },
      { projection: { likesCount: 1 } }
    )

    const response = NextResponse.json({
      success: true,
      liked,
      message: liked ? 'Article liked' : 'Like removed',
      count: (article as Record<string, number> | null)?.likesCount ?? 0,
    })

    if (!request.cookies.get('mukoko_session')) {
      response.cookies.set('mukoko_session', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365,
      })
    }

    return response
  } catch (error) {
    console.error('[/api/articles/[id]/like]', error)
    return NextResponse.json({ success: false, liked: false, message: 'Failed' }, { status: 500 })
  }
}
