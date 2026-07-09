'use server'

import { withAuth, signOut } from '@workos-inc/authkit-nextjs'
import { BASE_URL } from '@/lib/constants'

// ── Hosted AuthKit sign-in ───────────────────────────────────────────────────
//
// Doctrine (owner correction 2026-07-09, superseding the 2026-07-02 inline-form
// doctrine): sign-in goes through the WORKOS-HOSTED AuthKit page. The hosted
// page owns the full flow — Magic Auth, passwords, passkeys, and the
// environment-required MFA step-up (enrolment AND challenge) — and establishes
// the shared AuthKit session on the auth domain, which is what gives continuous
// sign-in across the Mukoko/Nyuchi apps. The previous inline (bring-your-own-UI)
// Magic Auth + hand-rolled TOTP step-up lived here; it broke under the
// environment's MFA=Required policy and never created the shared hosted
// session, so it was removed. Entry point: /sign-in (redirects to
// getSignInUrl()); return path: /auth/callback.

/** Lightweight check used by client components after a successful sign-in. */
export async function isSignedIn(): Promise<boolean> {
  const { user } = await withAuth()
  return !!user
}

/** Sign the current user out by clearing the AuthKit session cookie. */
export async function signOutAction(): Promise<void> {
  // returnTo keeps the user on-site after the cookie is cleared.
  await signOut({ returnTo: BASE_URL })
}
