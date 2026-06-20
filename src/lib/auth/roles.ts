/**
 * WorkOS RBAC tier resolution for the Next.js admin app.
 *
 * Mirrors the semantics of backend/middleware/workosAuth.ts so the admin UI
 * gates the same way the gateway Worker does. The WorkOS access token (and the
 * `withAuth()` UserInfo derived from it) carries `organizationId`, `role`, and
 * `permissions` claims.
 *
 *   superadmin        → WorkOS role `admin` within the platform-team org
 *   admin (staff)     → member of the platform-team org
 *   moderator/support → (within platform-team) role `moderator`/`support` OR the
 *                       `mukoko:news-moderator` permission
 *   normal user       → everything else
 *
 * platform-team is identified by its WorkOS org id (WORKOS_PLATFORM_ORG_ID).
 */

const SUPERADMIN_ROLE = 'admin'
const MODERATOR_ROLES = ['moderator', 'support']
const MODERATOR_PERMISSION = 'mukoko:news-moderator'

export type Tier = 'none' | 'moderator' | 'admin' | 'superadmin'

/** Minimal shape of the WorkOS claims we authorize against. */
export interface WorkOSClaims {
  organizationId?: string
  role?: string
  permissions?: string[]
}

function platformOrgId(): string | undefined {
  return process.env.WORKOS_PLATFORM_ORG_ID
}

/** True only when the session was issued inside the platform-team org. */
function inPlatformOrg(claims: WorkOSClaims): boolean {
  const orgId = platformOrgId()
  return !!orgId && claims.organizationId === orgId
}

export function isSuperAdmin(claims: WorkOSClaims): boolean {
  return inPlatformOrg(claims) && claims.role === SUPERADMIN_ROLE
}

export function isAdmin(claims: WorkOSClaims): boolean {
  return inPlatformOrg(claims)
}

export function isModerator(claims: WorkOSClaims): boolean {
  if (isAdmin(claims)) return true
  // All moderator grants — role AND the mukoko:news-moderator permission — are
  // honoured only inside the platform-team org. WorkOS permission slugs are
  // environment-wide and assignable per-org, so an un-scoped permission check
  // would let a non-staff org's session gain moderator access.
  if (!inPlatformOrg(claims)) return false
  const perms = claims.permissions ?? []
  return (
    (!!claims.role && MODERATOR_ROLES.includes(claims.role)) ||
    perms.includes(MODERATOR_PERMISSION)
  )
}

/** Resolve the highest tier the claims satisfy. */
export function resolveTier(claims: WorkOSClaims | null | undefined): Tier {
  if (!claims) return 'none'
  if (isSuperAdmin(claims)) return 'superadmin'
  if (isAdmin(claims)) return 'admin'
  if (isModerator(claims)) return 'moderator'
  return 'none'
}

/** Anyone at moderator or above may enter the admin app. */
export function canAccessAdmin(tier: Tier): boolean {
  return tier === 'moderator' || tier === 'admin' || tier === 'superadmin'
}

export const TIER_LABELS: Record<Tier, string> = {
  none: 'No access',
  moderator: 'Moderator',
  admin: 'Staff admin',
  superadmin: 'Super admin',
}
