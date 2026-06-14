'use server'

import { withAuth } from '@workos-inc/authkit-nextjs'

// Server Actions that proxy admin mutations to the gateway Worker's
// WorkOS-gated /api/admin/* endpoints. The WorkOS access token (from withAuth)
// is forwarded as a Bearer header so the Worker re-verifies the same RBAC the
// admin UI gated on. Reads stay in MongoDB (src/lib/mongodb/admin.ts); only
// mutations route through the Worker — it owns the writes.

const GATEWAY_BASE = process.env.GATEWAY_API_URL || 'https://news.mukoko.com'

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
    console.error(`[ADMIN_GATEWAY] ${init.method} ${path} failed`, err)
    return { ok: false, status: 0, error: 'Could not reach the gateway.' }
  }
}

/** Toggle a feed source active/inactive (gateway: PATCH /api/admin/sources/:id). */
export async function setSourceActive(id: string, isActive: boolean): Promise<GatewayResult> {
  return callGateway(`/api/admin/sources/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  })
}

/** Trigger an RSS refresh (gateway: POST /api/admin/sources/refresh). */
export async function refreshSources(): Promise<GatewayResult> {
  return callGateway('/api/admin/sources/refresh', { method: 'POST' })
}

/** Moderate an article (gateway: PATCH /api/admin/articles/:id). */
export async function moderateArticle(
  id: string,
  status: 'approved' | 'rejected' | 'pending',
): Promise<GatewayResult> {
  return callGateway(`/api/admin/articles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}
