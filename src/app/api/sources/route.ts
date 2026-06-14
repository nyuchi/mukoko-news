import { NextResponse } from 'next/server'
import { getSources } from '@/lib/mongodb/sources'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const sources = await getSources()
    return NextResponse.json({ sources, total: sources.length })
  } catch (error) {
    console.error('[/api/sources]', error)
    return NextResponse.json({ error: 'Failed to fetch sources' }, { status: 500 })
  }
}
