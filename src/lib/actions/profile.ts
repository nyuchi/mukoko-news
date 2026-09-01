'use server'

/**
 * Profile edits for the signed-in user.
 *
 * WHERE THIS WRITES, AND WHY IT MATTERS
 * -------------------------------------
 * It writes to **WorkOS**, never to MongoDB. The `identity` database owns the
 * canonical person record and the gateway Worker is its ONLY writer — the
 * frontend touching `identity.persons` directly would be a domain violation the
 * schema will not catch (`validationLevel: "moderate"` accepts unknown fields
 * silently).
 *
 * The propagation already exists and is the reason a name changed here shows up
 * in every Mukoko app rather than only in News:
 *
 *   this action → WorkOS updateUser
 *                 → WorkOS fires `user.updated`
 *                 → gateway `POST /api/webhooks/workos` (HMAC-verified)
 *                 → `IdentityService` upserts identity.persons
 *                    (givenName / familyName / picture / name)
 *                 → every app reading identity sees the change
 *
 * So WorkOS is the source of truth for the OIDC claim fields and this is a
 * write to that source, not a second copy of it.
 */

import { WorkOS } from '@workos-inc/node'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

/**
 * A display name, not free text. Bounded because it is rendered in the header
 * and beside every comment; control characters stripped because the value round
 * trips through JSON-LD and CSV exports elsewhere in the platform.
 */
const nameSchema = z
  .string()
  .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, '').trim())
  .refine((v) => v.length <= 60, { message: 'Too long' })

export type UpdateProfileResult = { ok: true } | { ok: false; error: string }

/**
 * Update the signed-in user's own name. There is deliberately no user-id
 * parameter: the id comes from the verified session, so this action cannot be
 * pointed at another account by a caller who crafts the request.
 */
export async function updateProfileAction(input: {
  firstName: string
  lastName: string
}): Promise<UpdateProfileResult> {
  const { user } = await withAuth()
  if (!user) return { ok: false, error: 'Sign in required' }

  const first = nameSchema.safeParse(input?.firstName ?? '')
  const last = nameSchema.safeParse(input?.lastName ?? '')
  if (!first.success || !last.success) {
    return { ok: false, error: 'Names must be 60 characters or fewer.' }
  }
  if (!first.data && !last.data) {
    return { ok: false, error: 'Enter at least a first or last name.' }
  }

  const apiKey = process.env.WORKOS_API_KEY
  const clientId = process.env.WORKOS_CLIENT_ID
  if (!apiKey || !clientId) {
    // Fail closed and say so plainly: silently reporting success while nothing
    // was written is the worse outcome for a settings form.
    console.error('[profile] WORKOS_API_KEY/WORKOS_CLIENT_ID not configured')
    return { ok: false, error: 'Profile editing is unavailable right now.' }
  }

  try {
    await new WorkOS(apiKey, { clientId }).userManagement.updateUser({
      userId: user.id,
      firstName: first.data,
      lastName: last.data,
    })
  } catch (error) {
    // Log without the error body — WorkOS errors can echo request material.
    console.error('[profile] updateUser failed for the signed-in user')
    void error
    return { ok: false, error: 'Could not save your profile. Please try again.' }
  }

  // The session cookie still carries the OLD claims until it refreshes, so the
  // header would keep showing the previous name. Revalidating the profile route
  // re-renders it; AuthKit's middleware refreshes the session on the next
  // request.
  revalidatePath('/profile')
  return { ok: true }
}
