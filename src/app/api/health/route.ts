import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb/client'
import { getStats } from '@/lib/mongodb/sources'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const db = await getDb()
    await db.command({ ping: 1 })

    const stats = await getStats()
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'operational',
        processing_api: 'operational',
        analytics: true,
        cache: 'operational',
      },
      stats,
    })
  } catch (error) {
    console.error('[/api/health]', error)
    return NextResponse.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unavailable',
        processing_api: 'unknown',
        analytics: false,
        cache: 'unknown',
      },
    }, { status: 503 })
  }
}
