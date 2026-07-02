'use server'

import { withAuth } from '@workos-inc/authkit-nextjs'
import { z } from 'zod'
import { idSchema, boundedTextSchema, parseOrDefault } from '@/lib/safety'

// Server Actions that proxy admin mutations to the gateway Worker's
// WorkOS-gated /api/admin/* endpoints. The WorkOS access token (from withAuth)
// is forwarded as a Bearer header so the Worker re-verifies the same RBAC the
// admin UI gated on. Reads stay in MongoDB (src/lib/mongodb/admin.ts); only
// mutations route through the Worker — it owns the writes.

const GATEWAY_BASE = process.env.GATEWAY_API_URL || 'https://news.mukoko.dev'

export interface GatewayResult<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
}

async function callGateway<T = unknown>(
  path: string,
  init: RequestInit & { method: string },
): Promise<GatewayResult<T>> {
  const { accessToken } = await withAuth()
  if (!accessToken) {
    return { ok: false, status: 401, error: 'Not authenticated' }
  }

  try {
    const res = await fetch(`${GATEWAY_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    })

    const text = await res.text()
    const data = text ? (JSON.parse(text) as T) : undefined

    if (!res.ok) {
      return { ok: false, status: res.status, error: `Gateway returned ${res.status}`, data }
    }
    return { ok: true, status: res.status, data }
  } catch (err) {
    console.error('[ADMIN_GATEWAY] request failed', { method: init.method, path }, err)
    return { ok: false, status: 0, error: 'Could not reach the gateway.' }
  }
}

const moderationStatusSchema = z.enum(['active', 'flagged', 'removed'])

/** Toggle a feed source active/inactive (gateway: PATCH /api/admin/sources/:id). */
export async function setSourceActive(id: string, isActive: boolean): Promise<GatewayResult> {
  // These are Server Actions (public RPC surface): length-bound the
  // user-supplied id and coerce the flag before it reaches the gateway.
  const safeId = parseOrDefault(idSchema, id, null)
  if (!safeId) {
    return { ok: false, status: 400, error: 'Invalid source id' }
  }
  return callGateway(`/api/admin/sources/${encodeURIComponent(safeId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive: isActive === true }),
  })
}

/** Moderate an article — sets moderationStatus (gateway: PATCH /api/moderator/articles/:id). */
export async function moderateArticle(
  id: string,
  moderationStatus: 'active' | 'flagged' | 'removed',
  reason?: string,
): Promise<GatewayResult> {
  const safeId = parseOrDefault(idSchema, id, null)
  if (!safeId) {
    return { ok: false, status: 400, error: 'Invalid article id' }
  }
  const safeStatus = parseOrDefault(moderationStatusSchema, moderationStatus, null)
  if (!safeStatus) {
    return { ok: false, status: 400, error: 'Invalid moderation status' }
  }
  const safeReason = parseOrDefault(boundedTextSchema(1000), reason, undefined)
  return callGateway(`/api/moderator/articles/${encodeURIComponent(safeId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ moderationStatus: safeStatus, reason: safeReason }),
  })
}
