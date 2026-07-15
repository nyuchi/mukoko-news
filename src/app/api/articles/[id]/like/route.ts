import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb/client'
import { checkRateLimit, getRequestIp } from '@/lib/rate-limit'
import { resolveEngagementSubject, claimSessionEngagement } from '@/lib/engagement'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

// Unique {articleId, sessionId} index prevents double-likes. The subject key is
// the signed-in user (`user:<id>`, follows the account across devices) or the
// anonymous mukoko_session cookie — see src/lib/engagement.ts.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getRequestIp(request)
  if (!(await checkRateLimit(`like:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(RATE_LIMIT_WINDOW_MS / 1000) } }
    )
  }

  try {
    const { id: articleId } = await params
    if (typeof articleId !== 'string' || articleId.length === 0 || articleId.length > 128) {
      return NextResponse.json(
        { success: false, message: 'Invalid article id' },
        { status: 400 }
      )
    }
    const cookieSessionId = request.cookies.get('mukoko_session')?.value
    const subject = await resolveEngagementSubject(cookieSessionId)
    const sessionId = subject.key ?? randomUUID()

    const db = await getDb()

    // First signed-in interaction after anonymous use: claim cookie history.
    if (subject.isUser && cookieSessionId) {
      await claimSessionEngagement(db, cookieSessionId, sessionId)
    }

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

    // Only anonymous visitors need the session cookie minted.
    if (!subject.isUser && !request.cookies.get('mukoko_session')) {
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
