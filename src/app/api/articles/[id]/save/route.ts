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

    const db = await getDb()
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
    console.error('[/api/articles/[id]/save]', error)
    return NextResponse.json({ success: false, saved: false, message: 'Failed' }, { status: 500 })
  }
}
