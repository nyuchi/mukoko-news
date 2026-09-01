'use server'

/**
 * The signed-in user's organization memberships, for surfaces that need to know
 * which publications they belong to.
 *
 * Resolution is two hops, because the three domains key on different ids:
 *   WorkOS session user id  →  identity.persons._id  (matched on workosUserId)
 *                           →  entity.memberships.personId
 *
 * That is why this cannot be answered from the token: the token carries the
 * WorkOS user id, and the membership graph keys on the identity person id.
 */

import { withAuth } from '@workos-inc/authkit-nextjs'
import { getPersonByWorkosId } from '@/lib/mongodb/identity'
import { getActiveMemberships, type Membership } from '@/lib/mongodb/entity'

/**
 * The caller's active memberships. Empty for a signed-out caller, and empty —
 * not an error — when the read fails, so callers must treat it as "unproven"
 * rather than "proven absent".
 */
export async function getMyMembershipsAction(): Promise<Membership[]> {
  const { user } = await withAuth()
  if (!user) return []

  const person = await getPersonByWorkosId(user.id)
  if (!person.personId) return []

  return getActiveMemberships(person.personId)
}
