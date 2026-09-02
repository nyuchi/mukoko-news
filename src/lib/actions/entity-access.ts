'use server'

/**
 * The signed-in caller's entity memberships, as capabilities rather than raw
 * rows.
 *
 * The capability model and the reasoning behind it live in
 * `src/lib/auth/entity-access.ts`. This file is only the `'use server'` doorway
 * so client components can read it.
 *
 * Returns an empty list for a signed-out caller AND for a failed read, so a
 * caller must treat empty as "cannot prove membership" — never as a licence to
 * fall back to some wider default.
 */

import { getMyEntityAccess, type EntityAccess } from '@/lib/auth/entity-access'

export async function getMyEntityAccessAction(): Promise<EntityAccess[]> {
  return getMyEntityAccess()
}
