/**
 * WorkOS authentication middleware for the gateway Worker (Hono).
 *
 * Verifies WorkOS AuthKit access tokens (JWT) against the custom auth domain
 * identity.nyuchi.com. Replaces the retired id.mukoko.com OIDC provider.
 *
 *  - Authentication: any valid WorkOS JWT.
 *  - Authorization: WorkOS RBAC — the `role` and `permissions` claims (managed
 *    in WorkOS). Admins are granted the admin role / platform:admin permission
 *    in the WorkOS dashboard. User/entity content RBAC lives in MongoDB.
 */
import { Context, MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

const AUTH_DOMAIN = 'https://identity.nyuchi.com'

export interface WorkOSUser {
  sub: string
  email?: string
  orgId?: string
  role?: string
  permissions: string[]
  raw: JWTPayload
}

// Extend Hono context with the authenticated user.
declare module 'hono' {
  interface ContextVariableMap {
    user: WorkOSUser | null
    userId: string | null
    isAuthenticated: boolean
  }
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null
function getJwks() {
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(`${AUTH_DOMAIN}/.well-known/jwks.json`))
  return _jwks
}

async function verifyToken(token: string): Promise<WorkOSUser | null> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: AUTH_DOMAIN,
      algorithms: ['RS256'],
    })
    return {
      sub: String(payload.sub ?? ''),
      email: typeof payload.email === 'string' ? payload.email : undefined,
      orgId: typeof payload.org_id === 'string' ? payload.org_id : undefined,
      role: typeof payload.role === 'string' ? payload.role : undefined,
      permissions: Array.isArray(payload.permissions) ? (payload.permissions as string[]) : [],
      raw: payload,
    }
  } catch {
    return null
  }
}

function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

// Admin authorization: WorkOS role or permission (managed in WorkOS).
const ADMIN_ROLES = ['admin', 'super_admin', 'moderator']
const ADMIN_PERMISSION = 'platform:admin'

export function isAdmin(user: WorkOSUser): boolean {
  return (
    (user.role != null && ADMIN_ROLES.includes(user.role)) ||
    user.permissions.includes(ADMIN_PERMISSION)
  )
}

export interface AuthMiddlewareOptions {
  /** Return 401 when no valid token is present. */
  required?: boolean
  /** Pass only when the user satisfies this predicate (else 403). */
  authorize?: (user: WorkOSUser) => boolean
}

export function workosAuth(options: AuthMiddlewareOptions = {}): MiddlewareHandler {
  const { required = false, authorize } = options

  return async (c: Context, next) => {
    c.set('user', null)
    c.set('userId', null)
    c.set('isAuthenticated', false)

    const token = extractBearer(c.req.header('Authorization'))
    if (!token) {
      if (required) return c.json({ error: 'Authentication required', code: 'UNAUTHORIZED' }, 401)
      return next()
    }

    const user = await verifyToken(token)
    if (!user) {
      if (required) return c.json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' }, 401)
      return next()
    }

    c.set('user', user)
    c.set('userId', user.sub)
    c.set('isAuthenticated', true)

    if (authorize && !authorize(user)) {
      return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403)
    }

    return next()
  }
}

/** Require any authenticated WorkOS user. */
export function requireAuth(): MiddlewareHandler {
  return workosAuth({ required: true })
}

/** Require an admin (WorkOS role/permission). */
export function requireAdmin(): MiddlewareHandler {
  return workosAuth({ required: true, authorize: isAdmin })
}

/** Require the WorkOS super_admin role. */
export function requireSuperAdmin(): MiddlewareHandler {
  return workosAuth({ required: true, authorize: (u) => u.role === 'super_admin' })
}

export function getCurrentUser(c: Context): WorkOSUser | null {
  return c.get('user')
}

export function getCurrentUserId(c: Context): string | null {
  return c.get('userId')
}

export function isAuthenticated(c: Context): boolean {
  return c.get('isAuthenticated')
}

// Back-compat alias for the previous OIDC export name.
export const oidcAuth = workosAuth
