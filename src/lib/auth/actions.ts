'use server'

import { getWorkOS, saveSession, withAuth, signOut } from '@workos-inc/authkit-nextjs'
import { headers } from 'next/headers'
import { BASE_URL } from '@/lib/constants'

// ── Inline (Bring-Your-Own-UI) AuthKit sign-in ──────────────────────────────
//
// Doctrine (owner correction 2026-07-02, superseding the earlier hosted-redirect
// decision): sign-in is hosted **on our own site** — users never leave
// news.mukoko.com. The embedded form (src/components/auth/inline-sign-in.tsx) is
// primary; the WorkOS-hosted authkit page is a fallback link only.
//
// WorkOS AuthKit ships no embedded sign-in *widget* (@workos-inc/authkit-nextjs
// and @workos-inc/authkit-js only redirect to the hosted page). To keep users
// on-site we drive the WorkOS "Bring Your Own UI" primitives directly: Magic
// Auth (passwordless email code), the same passwordless flow the hosted screen
// used. These Server Actions call the WorkOS User Management API server-side and
// persist the resulting session with `saveSession`, so no off-site navigation
// happens.

export interface ActionResult {
  ok: boolean
  error?: string
}

/** Resolve a NextRequest-equivalent URL for saveSession cookie scoping. */
async function currentUrl(): Promise<string> {
  try {
    const h = await headers()
    const host = h.get('host')
    const proto = h.get('x-forwarded-proto') ?? 'https'
    if (host) return `${proto}://${host}`
  } catch {
    // headers() unavailable outside a request scope — fall back to BASE_URL.
  }
  return BASE_URL
}

/**
 * Step 1 — request a Magic Auth code be emailed to the address.
 * Works for both sign-in and sign-up: WorkOS provisions the user on first code.
 */
export async function requestEmailCode(email: string): Promise<ActionResult> {
  const trimmed = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'Enter a valid email address.' }
  }

  try {
    await getWorkOS().userManagement.createMagicAuth({ email: trimmed })
    return { ok: true }
  } catch (err) {
    console.error('[AUTH] requestEmailCode failed', err)
    return { ok: false, error: 'Could not send a sign-in code. Please try again.' }
  }
}

/**
 * Step 2 — verify the emailed code and persist the WorkOS session inline.
 * On success the AuthKit session cookie is set; the caller can refresh the page.
 */
export async function verifyEmailCode(email: string, code: string): Promise<ActionResult> {
  const trimmedEmail = email.trim().toLowerCase()
  const trimmedCode = code.trim()
  if (!trimmedCode) return { ok: false, error: 'Enter the code from your email.' }

  const clientId = process.env.WORKOS_CLIENT_ID
  if (!clientId) {
    console.error('[AUTH] WORKOS_CLIENT_ID is not set')
    return { ok: false, error: 'Sign-in is temporarily unavailable.' }
  }

  try {
    const authResponse = await getWorkOS().userManagement.authenticateWithMagicAuth({
      clientId,
      email: trimmedEmail,
      code: trimmedCode,
    })

    await saveSession(authResponse, await currentUrl())
    return { ok: true }
  } catch (err) {
    console.error('[AUTH] verifyEmailCode failed', err)
    return { ok: false, error: 'That code is invalid or expired. Request a new one.' }
  }
}

/** Lightweight check used by client components after a successful verify. */
export async function isSignedIn(): Promise<boolean> {
  const { user } = await withAuth()
  return !!user
}

/** Sign the current user out by clearing the AuthKit session cookie. */
export async function signOutAction(): Promise<void> {
  // returnTo keeps the user on-site after the cookie is cleared.
  await signOut({ returnTo: BASE_URL })
}
