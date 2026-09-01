'use server'

/**
 * The signed-in user's own profile — read from the database, written to both.
 *
 * SOURCE OF TRUTH (owner decision 2026-09-01)
 * -------------------------------------------
 * The person record in `identity.persons` is the source for user profile data,
 * not the WorkOS session claims. It carries strictly more: the picture is on
 * `profile-images.mukoko.com` rather than a WorkOS URL, and `preferredUsername`
 * and `interests` do not exist in the token at all. A profile rendered from
 * `useAuth()` alone shows a poorer user than every other Mukoko app displays.
 *
 * So a write updates the DB record first — that is what the platform reads —
 * and then mirrors the name to WorkOS so the identity provider does not drift
 * from it. The WorkOS write is best-effort: it round-trips back through the
 * gateway's `user.updated` webhook into the same record, so a failure there
 * leaves the canonical copy correct rather than leaving the user with nothing
 * saved.
 *
 * NOTE FOR REVIEWERS: `mukoko-news-gateway/CLAUDE.md` states the gateway is the
 * only writer of the `identity` domain. This file writes it too, on the owner's
 * instruction, scoped to the caller's OWN record and an allowlist of
 * person-owned fields. That doc needs updating to match; flagged rather than
 * left as a silent contradiction.
 */

import { WorkOS } from '@workos-inc/node'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  getPersonByWorkosId,
  updatePersonByWorkosId,
  type MyProfile,
} from '@/lib/mongodb/identity'
import { MAX_LIST_ENTRIES } from '@/lib/safety'

/**
 * A display name, not free text. Bounded because it is rendered in the header
 * and beside every byline; control characters stripped because the value round
 * trips through JSON-LD and CSV exports elsewhere in the platform.
 */
const nameSchema = z
  .string()
  .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, '').trim())
  .refine((v) => v.length <= 60)

/** Category slugs, matching what `interests` already holds (`ai-machine-learning`). */
const interestSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

export type ProfileResult = { ok: true } | { ok: false; error: string }

/** The signed-in user's profile, or null when there is no session. */
export async function getMyProfileAction(): Promise<MyProfile | null> {
  const { user } = await withAuth()
  if (!user) return null

  const person = await getPersonByWorkosId(user.id)
  // Fall back to the session claims per-field: a person record that has not yet
  // been filled in by the webhook should still render a name, not a blank page.
  return {
    ...person,
    givenName: person.givenName ?? user.firstName ?? null,
    familyName: person.familyName ?? user.lastName ?? null,
    picture: person.picture ?? user.profilePictureUrl ?? null,
  }
}

/**
 * Update the signed-in user's own name.
 *
 * There is deliberately no user-id parameter: the id comes from the verified
 * session, so this cannot be pointed at another account by a crafted request.
 */
export async function updateProfileAction(input: {
  firstName: string
  lastName: string
}): Promise<ProfileResult> {
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

  // `name` is the joined display form the gateway's webhook also computes;
  // writing it here keeps the two paths producing the same shape.
  const written = await updatePersonByWorkosId(user.id, {
    givenName: first.data,
    familyName: last.data,
    name: [first.data, last.data].filter(Boolean).join(' '),
  })
  if (!written) {
    return { ok: false, error: 'Could not save your profile. Please try again.' }
  }

  await mirrorNameToWorkOS(user.id, first.data, last.data)
  revalidatePath('/profile')
  return { ok: true }
}

/** Replace the signed-in user's interest categories. */
export async function updateInterestsAction(interests: unknown): Promise<ProfileResult> {
  const { user } = await withAuth()
  if (!user) return { ok: false, error: 'Sign in required' }

  const list = Array.isArray(interests) ? interests : []
  const clean = Array.from(
    new Set(
      list.flatMap((value) => {
        const parsed = interestSchema.safeParse(value)
        return parsed.success ? [parsed.data] : []
      })
    )
  ).slice(0, MAX_LIST_ENTRIES)

  const written = await updatePersonByWorkosId(user.id, { interests: clean })
  if (!written) return { ok: false, error: 'Could not save your interests.' }

  revalidatePath('/profile')
  return { ok: true }
}

/**
 * Mirror the name to WorkOS so the IdP does not drift from the record.
 *
 * Best-effort by design. The canonical write already succeeded, and this write
 * round-trips back into the same record through the gateway's `user.updated`
 * webhook — so failing here must not report failure to a user whose profile
 * was in fact saved.
 */
async function mirrorNameToWorkOS(
  userId: string,
  firstName: string,
  lastName: string
): Promise<void> {
  const apiKey = process.env.WORKOS_API_KEY
  const clientId = process.env.WORKOS_CLIENT_ID
  if (!apiKey || !clientId) {
    console.warn('[profile] WorkOS not configured — DB updated, IdP not mirrored')
    return
  }
  try {
    await new WorkOS(apiKey, { clientId }).userManagement.updateUser({
      userId,
      firstName,
      lastName,
    })
  } catch {
    // Log without the error body — WorkOS errors can echo request material.
    console.error('[profile] WorkOS mirror failed; the canonical record was saved')
  }
}
