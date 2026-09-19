import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb/client'
import { checkRateLimit, getRequestIp } from '@/lib/rate-limit'
import { resolveEngagementSubject, claimSessionEngagement } from '@/lib/engagement'
import { guardInteraction } from '@/lib/auth/interaction-guard'
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

  // Interactions are account-only (see @/lib/auth/interaction-guard). This is
  // the one gate in the reader tier model enforced server-side, because it is
  // the one that can be: no crawler POSTs here and no page is made dynamic by
  // reading the session.
  const gate = await guardInteraction()
  if (!gate.allowed) return gate.denial!

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
    // The guard above established a session, so the subject MUST be the user
    // key. If it is not, the two reads disagreed — and the old fallback here
    // (`subject.key ?? randomUUID()`) would store the interaction under a key
    // nobody can ever query again: an orphan row that reads as a successful
    // like to the reader and is invisible to every surface afterwards. A
    // failure the reader can see and retry beats a silent write to nowhere.
    if (!subject.isUser || !subject.key) {
      console.error('[/api/articles/[id]/like] guard passed but no user subject; refusing to write an orphan row')
      return NextResponse.json(
        { success: false, requiresAuth: true, message: 'Sign in to like and save articles' },
        { status: 401 }
      )
    }
    const sessionId = subject.key

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


    return response
  } catch (error) {
    console.error('[/api/articles/[id]/like]', error)
    return NextResponse.json({ success: false, liked: false, message: 'Failed' }, { status: 500 })
  }
}
