import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb/client'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

// Session cookie + unique {articleId, sessionId} index prevents double-likes.
// Replace sessionId with OIDC personId when auth is wired.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: articleId } = await params
    const sessionId = request.cookies.get('mukoko_session')?.value || randomUUID()

    const db = await getDb()

    // Validate article exists
    const article = await db.collection('articles').findOne(
      { _id: articleId as unknown as never },
      { projection: { _id: 1 } }
    )
    if (!article) {
      return NextResponse.json({ success: false, message: 'Article not found' }, { status: 404 })
    }

    const likesCol = db.collection('articleLikes')
    let liked: boolean

    try {
      // Unique index on {articleId, sessionId} makes this fail if already liked
      await likesCol.insertOne({
        _id: randomUUID() as unknown as never,
        articleId,
        sessionId,
        createdAt: new Date(),
      })
      liked = true
    } catch (e: unknown) {
      if ((e as { code?: number }).code === 11000) {
        // Duplicate — toggle off
        await likesCol.deleteOne({ articleId, sessionId })
        liked = false
      } else {
        throw e
      }
    }

    // Count from DB rather than using a raceable $inc
    const likesCount = await likesCol.countDocuments({ articleId })
    await db.collection('articles').updateOne(
      { _id: articleId as unknown as never },
      { $set: { likesCount, updatedAt: new Date() } }
    )

    const response = NextResponse.json({
      success: true,
      liked,
      message: liked ? 'Article liked' : 'Like removed',
      count: likesCount,
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
    console.error('[/api/articles/[id]/like]', error)
    return NextResponse.json({ success: false, liked: false, message: 'Failed' }, { status: 500 })
  }
}
