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

/**
 * When a Magic Auth code is correct but the account has MFA enabled, WorkOS
 * returns an `mfa_challenge` (an authenticator is enrolled → prompt for its
 * code) or `mfa_enrollment` (no factor yet → show a QR to enrol first). Either
 * way the caller must complete a second step with `verifyMfaCode`. We hand the
 * client the short-lived `pendingToken` + `challengeId` (the standard WorkOS
 * "bring your own UI" step-up pattern).
 */
export type MfaState =
  | { mode: 'challenge'; pendingToken: string; challengeId: string }
  | {
      mode: 'enrollment'
      pendingToken: string
      challengeId: string
      /** otpauth:// URI + QR data URL + shared secret for the authenticator app. */
      qrCode?: string
      secret?: string
      uri?: string
    }

export interface ActionResult {
  ok: boolean
  error?: string
  /** Present when sign-in needs a second (MFA) factor before it can complete. */
  mfa?: MfaState
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
    // A correct code on an MFA-protected account surfaces as an mfa_challenge /
    // mfa_enrollment step-up rather than a failure — hand the client what it
    // needs to complete the second factor instead of showing "invalid code".
    const mfa = await resolveMfaStep(err, trimmedEmail)
    if (mfa) return { ok: false, mfa }

    console.error('[AUTH] verifyEmailCode failed', redactAuthError(err))
    return { ok: false, error: 'That code is invalid or expired. Request a new one.' }
  }
}

/** Narrow shape of the WorkOS AuthenticationException we read (avoids a hard type import). */
interface WorkOSAuthError {
  code?: string
  pendingAuthenticationToken?: string
  rawData?: { user?: { id?: string } }
}

/**
 * Turn a WorkOS MFA step-up error into an `MfaState` the client can act on.
 * `mfa_challenge` → challenge the user's existing TOTP factor for a challengeId.
 * `mfa_enrollment` → enrol a fresh TOTP factor and return its QR + a challengeId.
 * Returns null for any non-MFA error so the caller falls through to its normal
 * error handling. Never throws — a lookup failure degrades to null.
 */
async function resolveMfaStep(err: unknown, email: string): Promise<MfaState | null> {
  const e = err as WorkOSAuthError
  const pendingToken = e?.pendingAuthenticationToken
  if (!pendingToken || (e.code !== 'mfa_challenge' && e.code !== 'mfa_enrollment')) return null

  const userId = e.rawData?.user?.id
  if (!userId) return null

  // The factor + challenge primitives live on the WorkOS `mfa` client
  // (MultiFactorAuth); authenticateWithTotp itself is on `userManagement`.
  const workos = getWorkOS()
  try {
    if (e.code === 'mfa_challenge') {
      const factors = await workos.multiFactorAuth.listUserAuthFactors({ userId })
      const totp = factors.data.find((f) => f.type === 'totp')
      if (totp) {
        const challenge = await workos.multiFactorAuth.challengeFactor({
          authenticationFactorId: totp.id,
        })
        return { mode: 'challenge', pendingToken, challengeId: challenge.id }
      }
      // Enrolled factor missing/unusable → fall through to enrolment.
    }

    // mfa_enrollment (or challenge with no usable factor): enrol a TOTP factor.
    const { authenticationFactor, authenticationChallenge } =
      await workos.multiFactorAuth.createUserAuthFactor({
        userId,
        type: 'totp',
        totpIssuer: 'Mukoko News',
        totpUser: email,
      })
    return {
      mode: 'enrollment',
      pendingToken,
      challengeId: authenticationChallenge.id,
      qrCode: authenticationFactor.totp?.qrCode,
      secret: authenticationFactor.totp?.secret,
      uri: authenticationFactor.totp?.uri,
    }
  } catch (mfaErr) {
    console.error('[AUTH] resolveMfaStep failed', redactAuthError(mfaErr))
    return null
  }
}

/**
 * Step 3 (only when MFA is required) — verify the authenticator's TOTP code
 * against the pending authentication + challenge from `verifyEmailCode`, then
 * persist the session. Completes the WorkOS step-up flow on-site.
 */
export async function verifyMfaCode(
  pendingToken: string,
  challengeId: string,
  code: string
): Promise<ActionResult> {
  const trimmedCode = code.trim()
  if (!trimmedCode) return { ok: false, error: 'Enter the 6-digit code from your authenticator.' }
  if (!pendingToken || !challengeId) {
    return { ok: false, error: 'Your sign-in attempt expired. Start again.' }
  }

  const clientId = process.env.WORKOS_CLIENT_ID
  if (!clientId) {
    console.error('[AUTH] WORKOS_CLIENT_ID is not set')
    return { ok: false, error: 'Sign-in is temporarily unavailable.' }
  }

  try {
    const authResponse = await getWorkOS().userManagement.authenticateWithTotp({
      clientId,
      code: trimmedCode,
      pendingAuthenticationToken: pendingToken,
      authenticationChallengeId: challengeId,
    })
    await saveSession(authResponse, await currentUrl())
    return { ok: true }
  } catch (err) {
    console.error('[AUTH] verifyMfaCode failed', redactAuthError(err))
    return { ok: false, error: 'That authenticator code is incorrect or expired. Try again.' }
  }
}

/** Strip anything but the WorkOS error code/message so tokens never hit logs. */
function redactAuthError(err: unknown): string {
  const e = err as { code?: string; message?: string }
  return e?.code ? `${e.code}` : (e?.message ?? 'unknown auth error')
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
