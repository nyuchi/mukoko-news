/**
 * Entity-scoped authorization — what a membership of an organization lets you
 * do **to that organization**, and nothing else.
 *
 * ## The boundary this module exists to hold
 *
 * There are two authorization systems in this app and they must not meet:
 *
 * | | source of truth | what it grants | gate |
 * | --- | --- | --- | --- |
 * | **Platform tiers** | the verified WorkOS access token | `/admin`, moderation | `src/lib/auth/roles.ts` |
 * | **Entity capabilities** | `entity.memberships` in MongoDB | actions on ONE entity | this module |
 *
 * A membership can never produce a platform tier. That is not a convention
 * here, it is the type signature: nothing in this file returns, imports, or
 * can be widened into `Tier`, and `roles.ts` reads no database at all. The
 * `__tests__/entity-access.test.ts` suite asserts both directions, including
 * that the admin gate imports nothing from the entity or membership modules.
 *
 * ## Why the boundary is drawn here rather than trusted to good sense
 *
 * `entity` is not a domain this app owns — the gateway's WorkOS webhook writes
 * it, and MongoDB's validators are `validationLevel: "moderate"` with no
 * `additionalProperties: false`, so they accept whatever a writer sends. On the
 * live cluster that has already produced an active membership carrying
 * `permissions: ["platform:admin"]`, on an entity with no `workosOrgId` to
 * reconcile it against. Meanwhile several active memberships are of entities
 * whose type is `family` — founding your own household is not staff access.
 *
 * If capabilities were read from the membership's permission slugs, every
 * writer to the `entity` database would be an authority on who administers
 * Mukoko News. So capabilities are derived from the membership **role** alone,
 * through the closed map below, and `sanitizeEntityPermissions` strips reserved
 * namespaces before a slug ever leaves the reader.
 *
 * ## Fail-soft reads mean "unproven", never "proven absent"
 *
 * `getActiveMemberships` returns `[]` when the cluster is unreachable. Every
 * decision here therefore grants on the PRESENCE of a membership and never on
 * its absence, so a degraded read denies access rather than opening it.
 */

import { withAuth } from '@workos-inc/authkit-nextjs'
import { getPersonByWorkosId } from '@/lib/mongodb/identity'
import { getActiveMemberships, type Membership } from '@/lib/mongodb/entity'

/**
 * What a member may do to their own entity.
 *
 * Deliberately coarse and deliberately short. Each value names an action on a
 * single entity; none of them describes a platform-wide power, and a new value
 * that did would be the bug this module exists to prevent.
 */
export type EntityCapability =
  /** See the entity's own dashboard, sources, and analytics. */
  | 'entity:read'
  /** Edit the entity's profile and submit feeds on its behalf. */
  | 'entity:manage'
  /** Add, remove, or re-role people in the entity. */
  | 'entity:members'

/**
 * Role → capabilities. A closed map: an unrecognised role gets nothing.
 *
 * Roles are lowercased before lookup because the column is free text written by
 * several producers (`membershipRole` on the live rows is `founder` | `admin` |
 * `member`, but nothing in the schema enforces the case).
 */
const ROLE_CAPABILITIES: Record<string, readonly EntityCapability[]> = {
  founder: ['entity:read', 'entity:manage', 'entity:members'],
  owner: ['entity:read', 'entity:manage', 'entity:members'],
  admin: ['entity:read', 'entity:manage', 'entity:members'],
  editor: ['entity:read', 'entity:manage'],
  manager: ['entity:read', 'entity:manage'],
  member: ['entity:read'],
  viewer: ['entity:read'],
}

/** One entity the caller belongs to, and what they may do to it. */
export interface EntityAccess {
  entityId: string
  entityName: string | null
  entityType: string | null
  role: string | null
  title: string | null
  capabilities: EntityCapability[]
}

/** Raised when a caller is signed in but not entitled to act on this entity. */
export class ForbiddenError extends Error {
  readonly entityId: string
  readonly capability: EntityCapability

  constructor(entityId: string, capability: EntityCapability) {
    super('You do not have access to this organization')
    this.name = 'ForbiddenError'
    this.entityId = entityId
    this.capability = capability
  }
}

function capabilitiesForRole(role: string | null): EntityCapability[] {
  if (!role) return []
  return [...(ROLE_CAPABILITIES[role.trim().toLowerCase()] ?? [])]
}

function toAccess(m: Membership): EntityAccess {
  return {
    entityId: m.entityId,
    entityName: m.entityName,
    entityType: m.entityType,
    role: m.role,
    title: m.title,
    capabilities: capabilitiesForRole(m.role),
  }
}

/**
 * Resolve the signed-in caller to their identity person id.
 *
 * Two hops, because the domains key on different ids: the WorkOS token carries
 * the WorkOS user id, `identity.persons` matches it on `workosUserId`, and
 * `entity.memberships` keys on that person's `_id`. This is exactly why
 * membership cannot be answered from the token.
 */
async function callerPersonId(): Promise<string | null> {
  const { user } = await withAuth()
  if (!user) return null
  const person = await getPersonByWorkosId(user.id)
  return person.personId
}

/**
 * Every entity the caller can act on, with the capabilities they hold on each.
 *
 * Memberships whose role maps to no capability are dropped rather than returned
 * with an empty list: a row that grants nothing is not access.
 */
export async function getMyEntityAccess(): Promise<EntityAccess[]> {
  const personId = await callerPersonId()
  if (!personId) return []
  const memberships = await getActiveMemberships(personId)
  return memberships.map(toAccess).filter((a) => a.capabilities.length > 0)
}

/**
 * The caller's access to one specific entity, or `null` if they have none.
 *
 * Scoped by construction: the caller names the entity and only a membership of
 * *that* entity can answer. Holding `entity:manage` on one organization says
 * nothing about another.
 */
export async function getEntityAccess(entityId: string): Promise<EntityAccess | null> {
  if (!entityId) return null
  const all = await getMyEntityAccess()
  return all.find((a) => a.entityId === entityId) ?? null
}

/** True when the caller holds this capability on this entity. */
export async function hasEntityCapability(
  entityId: string,
  capability: EntityCapability
): Promise<boolean> {
  const access = await getEntityAccess(entityId)
  return !!access?.capabilities.includes(capability)
}

/**
 * Throw unless the caller holds `capability` on `entityId`.
 *
 * Call this **inside** the Server Action or Route Handler that does the work,
 * not only in the page that renders the button. A Server Action is a public RPC
 * surface: anyone who can POST its action id reaches it whether or not they
 * ever loaded the page.
 */
export async function requireEntityCapability(
  entityId: string,
  capability: EntityCapability
): Promise<EntityAccess> {
  const access = await getEntityAccess(entityId)
  if (!access || !access.capabilities.includes(capability)) {
    throw new ForbiddenError(entityId, capability)
  }
  return access
}
