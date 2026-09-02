import type { Db } from 'mongodb'
import { MongoClient } from 'mongodb'
import { MONGO_CLIENT_OPTIONS } from './client'

/**
 * The caller's organization memberships — the RBAC facts the WorkOS token
 * cannot carry.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/lib/auth/roles.ts` resolves tiers from the WorkOS session claims
 * (`organizationId` / `role` / `permissions`), scoped to the single platform-team
 * org. That works for `/admin` and nothing else, because the platform's real
 * membership graph lives in `entity.memberships` and most of it never reaches
 * WorkOS at all: measured on the live cluster, **every currently-active
 * membership has no `workosOrganizationId`**, while the only memberships that do
 * carry one have already ended. A claims-only check therefore reports "no
 * membership" for every active member the platform has.
 *
 * So this is a read of the owning domain rather than a second copy of it:
 * `entity` owns organizations and memberships, `identity` owns people, and
 * `news.newsMediaOrganizations` links a publisher to its entity by `entityId`.
 * Nothing here is written — the gateway and its WorkOS webhook own those writes.
 *
 * READ-ONLY. Deliberately.
 */

const ENTITY_DB = 'entity'

let clientPromise: Promise<MongoClient> | null = null

async function getEntityDb(): Promise<Db> {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI
    if (!uri) throw new Error('MONGODB_URI environment variable is not set')
    clientPromise = new MongoClient(uri, MONGO_CLIENT_OPTIONS).connect()
  }
  return (await clientPromise).db(ENTITY_DB)
}

export interface Membership {
  entityId: string
  entityName: string | null
  /** The entity's own type — `organization`, `family`, … See the note below. */
  entityType: string | null
  /** `founder` | `admin` | `member` — the entity-scoped role, not a platform tier. */
  role: string | null
  title: string | null
  /**
   * Permission slugs carried by the membership row, with every reserved
   * namespace stripped. Entity-scoped only — see `RESERVED_PERMISSION_NAMESPACES`.
   */
  entityPermissions: string[]
  joinedAt: string | null
}

/**
 * Namespaces a membership row is NOT allowed to grant, stripped on read.
 *
 * This is not hypothetical tidiness. On the live cluster one active membership
 * carries `permissions: ["platform:admin"]` — on an entity with no
 * `workosOrgId` at all, so it cannot even be reconciled against the WorkOS
 * platform-team org that `roles.ts` gates on. Half the other active
 * memberships are of entities whose `entityType` is `family`: founding your
 * own household entity is not a platform credential.
 *
 * `entity` is written by the gateway's WorkOS webhook and by whatever else
 * touches that domain; the news frontend does not own it. Reading a slug from
 * it and treating it as authority would make any writer to `entity` an
 * authority on who administers this app. So the reserved namespaces never
 * leave this module, and platform tiers keep coming from the verified WorkOS
 * token alone (`src/lib/auth/roles.ts`).
 */
const RESERVED_PERMISSION_NAMESPACES = ['platform:', 'mukoko:', 'nyuchi:', 'admin:', 'news:']
const RESERVED_PERMISSIONS = ['admin', 'superadmin', 'moderator', 'support', 'staff']

/** Drop anything that reads as a platform grant rather than an entity-scoped one. */
export function sanitizeEntityPermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((p): p is string => {
    if (typeof p !== 'string') return false
    const slug = p.trim().toLowerCase()
    if (!slug) return false
    if (RESERVED_PERMISSIONS.includes(slug)) return false
    return !RESERVED_PERMISSION_NAMESPACES.some((ns) => slug.startsWith(ns))
  })
}

/**
 * Only memberships that are live right now.
 *
 * Both conditions are load-bearing and neither is redundant: on the live cluster
 * half the records are `isActive: false`, and `endedAt` is set on more rows than
 * `isActive` is false — so checking one alone would grant access to people whose
 * membership has ended.
 */
function activeMembershipFilter(personId: string) {
  return {
    personId,
    isActive: true,
    $or: [{ endedAt: null }, { endedAt: { $exists: false } }, { endedAt: { $gt: new Date() } }],
  }
}

/**
 * The caller's active memberships, with the organization name resolved from the
 * owning collection rather than copied onto the membership.
 *
 * Fail-soft like every other read layer here: a degraded cluster yields an empty
 * list, so a page renders "no organizations" instead of throwing. Callers must
 * therefore treat an empty result as "cannot prove membership", never as "proven
 * to have none" — it is not a signal to grant anything.
 */
export async function getActiveMemberships(personId: string): Promise<Membership[]> {
  if (!personId) return []
  try {
    const db = await getEntityDb()
    const rows = await db
      .collection('memberships')
      .aggregate([
        { $match: activeMembershipFilter(personId) },
        {
          $lookup: {
            from: 'entities',
            localField: 'entityId',
            foreignField: '_id',
            as: 'entity',
          },
        },
        {
          $project: {
            _id: 0,
            entityId: 1,
            role: '$membershipRole',
            title: 1,
            permissions: 1,
            joinedAt: 1,
            entityName: { $first: '$entity.name' },
            entityType: { $first: '$entity.entityType' },
          },
        },
      ])
      .toArray()

    return rows.map((r) => ({
      entityId: String(r.entityId),
      entityName: typeof r.entityName === 'string' ? r.entityName : null,
      entityType: typeof r.entityType === 'string' ? r.entityType : null,
      role: typeof r.role === 'string' ? r.role : null,
      title: typeof r.title === 'string' ? r.title : null,
      entityPermissions: sanitizeEntityPermissions(r.permissions),
      joinedAt: r.joinedAt instanceof Date ? r.joinedAt.toISOString() : null,
    }))
  } catch (error) {
    console.error('[entity] getActiveMemberships failed:', error)
    return []
  }
}

/** True when the caller holds an active membership of this entity. */
export async function isMemberOfEntity(personId: string, entityId: string): Promise<boolean> {
  if (!personId || !entityId) return false
  const memberships = await getActiveMemberships(personId)
  return memberships.some((m) => m.entityId === entityId)
}
