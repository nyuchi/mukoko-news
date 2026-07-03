'use server'

import { withAuth } from '@workos-inc/authkit-nextjs'

// Verified-publisher dashboard — thin proxy to the gateway's /api/user/publisher*
// endpoints (the gateway owns the identity resolution + news-domain writes). The
// frontend never reads/writes the publisher's cross-domain data directly.

const GATEWAY_BASE = process.env.GATEWAY_API_URL || 'https://news.mukoko.dev'

// ── Types (mirror the gateway's PublisherContext) ───────────────────────────

export interface TrustFactor {
  key: string
  label: string
  coveragePct: number
  needsAttention: boolean
  hint: string
}

export interface TrustBreakdown {
  averageTrustScore: number
  articlesAnalyzed: number
  factors: TrustFactor[]
  recentAdjustments: Array<{
    feedSourceId: string
    adjustment: number
    reasons: string[]
    recordedAt: string | null
  }>
}

export interface DashboardSource {
  id: string
  name: string
  feedUrl: string
  feedType: string
  countryCode: string
  isActive: boolean
  trustScore: number
  articleCount: number
  sourceHealth: string | null
  consecutiveFailures: number
  lastFetchStatus: string | null
  lastFetchError: string | null
  lastFetchedAt: string | null
  pendingReview: boolean
}

export interface DashboardAnalytics {
  totalArticles: number
  articlesLast30Days: number
  withImagePct: number
  withFullContentPct: number
  enrichedPct: number
  totalViews: number
  totalLikes: number
  totalSaves: number
  capped: boolean
}

export interface DashboardOrganization {
  id: string
  name: string
  slug: string | null
  url: string | null
  description: string | null
  logo: string | null
  isVerified: boolean
  publisherTier: string | null
  verificationTier: number
  sources: DashboardSource[]
  trust: TrustBreakdown
  analytics: DashboardAnalytics
}

export interface PublisherContext {
  isPublisher: boolean
  organizations: DashboardOrganization[]
  pendingClaims: Array<{
    id: string
    status: string
    organizationName: string | null
    createdAt: string | null
  }>
}

export interface MutationResult {
  ok: boolean
  status: number
  error?: string
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const { accessToken } = await withAuth()
  if (!accessToken) return null
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }
}

/** Fetch the caller's dashboard context. Returns null on auth/gateway failure. */
export async function getPublisherDashboard(): Promise<PublisherContext | null> {
  const headers = await authHeaders()
  if (!headers) return null
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/user/publisher`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[PUBLISHER] dashboard fetch failed', res.status)
      return null
    }
    return (await res.json()) as PublisherContext
  } catch (err) {
    console.error('[PUBLISHER] dashboard fetch error', err)
    return null
  }
}

export interface OrgProfilePatch {
  name?: string
  url?: string | null
  description?: string | null
  logo?: string | null
}

/** Edit the publisher's organization profile (gateway PATCH). */
export async function updatePublisherOrg(
  orgId: string,
  patch: OrgProfilePatch
): Promise<MutationResult> {
  const headers = await authHeaders()
  if (!headers) return { ok: false, status: 401, error: 'Please sign in.' }
  if (!orgId) return { ok: false, status: 400, error: 'Missing organization.' }
  return call(`/api/user/publisher/organizations/${encodeURIComponent(orgId)}`, 'PATCH', patch, headers)
}

export interface DirectFeedInput {
  organizationId: string
  feedUrl: string
  feedType?: string
  fullContent?: boolean
  countryCode?: string
}

/** Submit a feed directly for review (gateway POST). */
export async function submitDirectFeed(input: DirectFeedInput): Promise<MutationResult> {
  const headers = await authHeaders()
  if (!headers) return { ok: false, status: 401, error: 'Please sign in.' }
  if (!input.organizationId) return { ok: false, status: 400, error: 'Missing organization.' }
  if (!/^https:\/\/\S+\.\S+/i.test((input.feedUrl || '').trim())) {
    return { ok: false, status: 400, error: 'Enter a valid https feed URL.' }
  }
  return call('/api/user/publisher/feeds', 'POST', input, headers)
}

async function call(
  path: string,
  method: string,
  body: unknown,
  headers: Record<string, string>
): Promise<MutationResult> {
  try {
    const res = await fetch(`${GATEWAY_BASE}${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const text = await res.text()
    const data = text ? (JSON.parse(text) as { error?: string }) : {}
    if (!res.ok) return { ok: false, status: res.status, error: data.error ?? `Gateway ${res.status}` }
    return { ok: true, status: res.status }
  } catch (err) {
    console.error('[PUBLISHER] gateway mutation failed', err)
    return { ok: false, status: 0, error: 'Could not reach the gateway. Please try again.' }
  }
}
