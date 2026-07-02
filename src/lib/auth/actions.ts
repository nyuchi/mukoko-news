'use server'

import { signOut } from '@workos-inc/authkit-nextjs'
import { BASE_URL } from '@/lib/constants'

// ── Hosted AuthKit ───────────────────────────────────────────────────────────
//
// Sign-IN happens via the WorkOS-hosted AuthKit page: server components call
// `getSignInUrl()` from @workos-inc/authkit-nextjs and redirect (see
// src/app/sign-in/page.tsx and src/app/admin/layout.tsx). Users return through
// src/app/auth/callback/route.ts. (Owner decision 2026-07-02 — hosted AuthKit
// replaced the old inline Magic Auth form; the requestEmailCode/verifyEmailCode
// Server Actions were removed with it.)

/** Sign the current user out by clearing the AuthKit session cookie. */
export async function signOutAction(): Promise<void> {
  // returnTo keeps the user on-site after the cookie is cleared.
  await signOut({ returnTo: BASE_URL })
}
