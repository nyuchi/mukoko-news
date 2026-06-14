import { type NextRequest } from 'next/server'
import { getDb } from '@/lib/mongodb/client'
import { handleMcpRequest } from '@/lib/mcp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const db = await getDb()
  return handleMcpRequest(request, db)
}

export async function GET(request: NextRequest) {
  const db = await getDb()
  return handleMcpRequest(request, db)
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id',
    },
  })
}
