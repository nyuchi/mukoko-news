/**
 * Server-side MongoDB reads for the admin app.
 * Import only in Server Components, Route Handlers, or Server Actions.
 *
 * Reads come straight from the `news` database. Mutations are NOT done here —
 * they go through the gateway Worker's WorkOS-gated /api/admin/* endpoints
 * (see src/lib/admin/gateway.ts).
 */

import { getDb } from './client'

export interface AdminSource {
  id: string
  name: string
  url: string
  countryCode: string
  isActive: boolean
  articleCount: number
  lastFetchedAt?: string
  consecutiveFailures?: number
  lastFetchStatus?: string
  lastFetchError?: string
}

export interface AdminArticle {
  id: string
  title: string
  source?: string
  countryCode?: string
  category?: string
  status?: string
  moderationStatus?: string
  url?: string
  datePublished?: string
}

export interface AdminStats {
  totalArticles: number
  activeSources: number
  categories: number
  todayArticles: number
  pendingArticles: number
}

interface MongoFeedSource {
  _id: string
  name: string
  feedUrl: string
  countryCode: string
  isActive: boolean
  articleCount?: number
  lastFetchedAt?: Date
  consecutiveFailures?: number
  lastFetchStatus?: string
  lastFetchError?: string
}

interface MongoArticle {
  _id: string
  title: string
  sourceName?: string
  source?: string
  countryCode?: string
  category?: string
  status?: string
  moderationStatus?: string
  link?: string
  url?: string
  datePublished?: Date
}

export interface AdminEngagementTotals {
  likes: number
  saves: number
  viewEvents: number
}

export interface AdminCategoryCount {
  slug: string
  name: string
  count: number
}

export interface AdminDbPing {
  ok: boolean
  latencyMs: number | null
}

/** Aggregate counts for the dashboard. */
export async function getAdminStats(): Promise<AdminStats> {
  const db = await getDb()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [totalArticles, activeSources, categories, todayArticles, pendingArticles] =
    await Promise.all([
      db.collection('articles').countDocuments({ status: { $ne: 'rejected' }, moderationStatus: { $ne: 'removed' } }),
      db.collection('feedSources').countDocuments({ isActive: true }),
      db.collection('categories').countDocuments({}),
      db.collection('articles').countDocuments({
        status: { $ne: 'rejected' },
        moderationStatus: { $ne: 'removed' },
        datePublished: { $gte: today },
      }),
      db.collection('articles').countDocuments({ moderationStatus: 'flagged' }),
    ])

  return { totalArticles, activeSources, categories, todayArticles, pendingArticles }
}

/**
 * Totals from the engagement event collections the like/view/save
 * Route Handlers write (`articleLikes`, `articleSaves`, `articleViews`).
 * Views are deduplicated per session per day by the Route Handler, so
 * `viewEvents` counts tracked view events — not raw page loads.
 */
export async function getAdminEngagementTotals(): Promise<AdminEngagementTotals> {
  const db = await getDb()
  const [likes, saves, viewEvents] = await Promise.all([
    db.collection('articleLikes').countDocuments({}),
    db.collection('articleSaves').countDocuments({}),
    db.collection('articleViews').countDocuments({}),
  ])
  return { likes, saves, viewEvents }
}

/** Title-case a category slug for display ("arts-culture" → "Arts Culture"). */
function slugToName(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Live per-category article counts from the AI-classified
 * `engagement.interest_categories` slugs — the same field the public feed reads.
 */
export async function getAdminCategoryCounts(limit = 8): Promise<AdminCategoryCount[]> {
  const db = await getDb()
  const rows = await db
    .collection('articles')
    .aggregate<{ _id: string; count: number }>([
      { $match: { status: { $ne: 'rejected' }, moderationStatus: { $ne: 'removed' } } },
      { $unwind: '$engagement.interest_categories' },
      { $group: { _id: '$engagement.interest_categories', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ])
    .toArray()

  return rows
    .filter((r) => typeof r._id === 'string' && r._id.trim().length > 0)
    .map((r) => {
      const slug = r._id.trim()
      return { slug, name: slugToName(slug), count: r.count }
    })
}

/** Cheap MongoDB reachability probe for the system page. Never throws. */
export async function pingDatabase(): Promise<AdminDbPing> {
  try {
    const db = await getDb()
    const start = Date.now()
    await db.command({ ping: 1 })
    return { ok: true, latencyMs: Date.now() - start }
  } catch (err) {
    console.error('[ADMIN] db ping failed', err)
    return { ok: false, latencyMs: null }
  }
}

/** All feed sources, most-productive first. */
export async function getAdminSources(): Promise<AdminSource[]> {
  const db = await getDb()
  const docs = await db
    .collection<MongoFeedSource>('feedSources')
    .find({})
    .sort({ articleCount: -1 })
    .limit(200)
    .toArray()

  return docs.map((d) => ({
    id: String(d._id),
    name: d.name,
    url: d.feedUrl,
    countryCode: d.countryCode,
    isActive: d.isActive,
    articleCount: d.articleCount ?? 0,
    lastFetchedAt: d.lastFetchedAt?.toISOString(),
    consecutiveFailures: d.consecutiveFailures,
    lastFetchStatus: d.lastFetchStatus,
    lastFetchError: d.lastFetchError || undefined,
  }))
}

export interface AdminPublisherClaim {
  id: string
  status: string
  claimedRole: string
  organizationName: string | null
  mediaOrganizationId: string | null
  proposedOrgUrl: string | null
  evidenceUrl: string | null
  evidenceNotes: string | null
  createdAt?: string
}

interface MongoPublisherClaim {
  _id: string
  status?: string
  claimedRole?: string
  mediaOrganizationId?: string | null
  proposedOrgName?: string | null
  proposedOrgUrl?: string | null
  evidenceUrl?: string | null
  evidenceNotes?: string | null
  createdAt?: Date
}

/** Actionable claim states — the review queue. */
const REVIEWABLE_CLAIM_STATES = ['submitted', 'in_review']

/**
 * Publisher-verification claims for the admin review queue (read-only; approve/
 * reject are gateway mutations — see src/lib/admin/gateway.ts). Reads
 * `news.publisherVerifications` and resolves each claim's org display name from
 * `newsMediaOrganizations` in one `$in` lookup.
 */
export async function getPublisherClaims(statuses?: string[]): Promise<AdminPublisherClaim[]> {
  const db = await getDb()
  const filter = statuses?.length ? statuses : REVIEWABLE_CLAIM_STATES
  const docs = await db
    .collection<MongoPublisherClaim>('publisherVerifications')
    .find({ status: { $in: filter } })
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray()

  const orgIds = [
    ...new Set(
      docs.map((d) => d.mediaOrganizationId).filter((v): v is string => typeof v === 'string'),
    ),
  ]
  const orgNames = new Map<string, string>()
  if (orgIds.length) {
    const orgs = await db
      .collection<{ _id: string; name?: string }>('newsMediaOrganizations')
      .find({ _id: { $in: orgIds } }, { projection: { name: 1 } })
      .toArray()
    for (const o of orgs) if (typeof o.name === 'string') orgNames.set(o._id, o.name)
  }

  return docs.map((d) => ({
    id: String(d._id),
    status: d.status ?? 'submitted',
    claimedRole: d.claimedRole ?? '',
    mediaOrganizationId: d.mediaOrganizationId ?? null,
    organizationName:
      (d.mediaOrganizationId && orgNames.get(d.mediaOrganizationId)) || d.proposedOrgName || null,
    proposedOrgUrl: d.proposedOrgUrl ?? null,
    evidenceUrl: d.evidenceUrl ?? null,
    evidenceNotes: d.evidenceNotes ?? null,
    createdAt: d.createdAt?.toISOString(),
  }))
}

/** Articles for the moderation queue, filtered by moderationStatus. */
export async function getAdminArticles(moderationStatus?: string): Promise<AdminArticle[]> {
  const db = await getDb()
  const filter = moderationStatus ? { moderationStatus } : {}
  const docs = await db
    .collection<MongoArticle>('articles')
    .find(filter)
    .sort({ datePublished: -1 })
    .limit(100)
    .toArray()

  return docs.map((d) => ({
    id: String(d._id),
    title: d.title,
    source: d.sourceName ?? d.source,
    countryCode: d.countryCode,
    category: d.category,
    status: d.status,
    moderationStatus: d.moderationStatus,
    url: d.link ?? d.url,
    datePublished: d.datePublished?.toISOString(),
  }))
}
