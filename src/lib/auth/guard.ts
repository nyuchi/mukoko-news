import { withAuth } from '@workos-inc/authkit-nextjs'

import { canAccess, planFor, type Feature } from '@/lib/access'

/**
 * Access guards for the non-admin private surfaces.
 *
 * `/admin` has its own RBAC gate (`src/app/admin/layout.tsx` + `roles.ts`).
 * This module is the weaker bar used by surfaces that are not staff-only but
 * must not be anonymous — currently the `/analytics` query console.
 *
 * Why the console is gated at all, when `/insights` beside it is public:
 * `/insights` publishes a FIXED set of aggregates the platform has chosen to
 * release. The console answers an ARBITRARY query — any term, any country, any
 * window, with sample articles and a CSV of the matched slice. That is a
 * different thing to hand an anonymous caller: it turns the corpus into a
 * queryable database rather than a published dataset, and it makes the
 * expensive path (Atlas Search + a multi-stage `$facet`) reachable without a
 * cost owner. Open data means published figures, not an open query endpoint.
 */

/** Raised when an unauthenticated caller reaches a signed-in-only read. */
export class UnauthorizedError extends Error {
  constructor(message = 'Sign in required') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/** True when a session is present. Cheap enough to call in a page render. */
export async function isViewerSignedIn(): Promise<boolean> {
  const { user } = await withAuth()
  return !!user
}

/**
 * The server-side half of `canAccess`.
 *
 * The plan map lives in `@/lib/access` so the client components that gate on
 * it and the server surfaces that enforce it read the SAME table. A page that
 * decided its own answer would drift from the card the reader saw, and the
 * drift would always resolve in one of two bad directions: a locked card over
 * an open endpoint, or a reader who signed in and still cannot get through.
 */
export async function viewerCanAccess(feature: Feature): Promise<boolean> {
  return canAccess(feature, planFor(await isViewerSignedIn()))
}

/**
 * Throw unless the caller is signed in.
 *
 * Server Actions are a public RPC surface — an action is reachable by anyone
 * who can POST its action id, whether or not they ever loaded the page that
 * imports it. So the page-level redirect is a UX affordance, NOT the access
 * control; this call inside the action is. Gating only the page would leave the
 * data fully readable to anyone who watched the network tab once.
 */
export async function requireViewer(): Promise<{ id: string; email: string }> {
  const { user } = await withAuth()
  if (!user) throw new UnauthorizedError()
  return { id: user.id, email: user.email }
}
