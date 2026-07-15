import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb/client'
import { checkRateLimit, getRequestIp } from '@/lib/rate-limit'
import { resolveEngagementSubject, claimSessionEngagement } from '@/lib/engagement'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getRequestIp(request)
  if (!(await checkRateLimit(`save:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
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
    // Signed-in users get a stable user key so saves follow the account.
    const subject = await resolveEngagementSubject(cookieSessionId)
    const sessionId = subject.key ?? randomUUID()

    const db = await getDb()

    // First signed-in interaction after anonymous use: claim cookie history.
    if (subject.isUser && cookieSessionId) {
      await claimSessionEngagement(db, cookieSessionId, sessionId)
    }

    const savesCol = db.collection('articleSaves')

    const existing = await savesCol.findOne({ articleId, sessionId })

    let saved: boolean
    if (existing) {
      await savesCol.deleteOne({ articleId, sessionId })
      saved = false
    } else {
      await savesCol.insertOne({
        _id: randomUUID() as unknown as never,
        articleId,
        sessionId,
        createdAt: new Date(),
      })
      saved = true
    }

    const response = NextResponse.json({
      success: true,
      saved,
      message: saved ? 'Article saved' : 'Article unsaved',
    })

    // Only anonymous visitors need the session cookie minted.
    if (!subject.isUser && !request.cookies.get('mukoko_session')) {
      response.cookies.set('mukoko_session', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365,
      })
    }

    return response
  } catch (error) {
    console.error('[/api/articles/[id]/save]', error)
    return NextResponse.json({ success: false, saved: false, message: 'Failed' }, { status: 500 })
  }
}
