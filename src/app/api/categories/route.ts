import { NextResponse } from 'next/server'
import { getCategories } from '@/lib/mongodb/categories'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const categories = await getCategories()
    return NextResponse.json({ categories })
  } catch (error) {
    console.error('[/api/categories]', error)
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
  }
}
