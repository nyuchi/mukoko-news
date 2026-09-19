import { NextResponse } from "next/server";

import { canAccess, planFor } from "@/lib/access";

/**
 * The auth gate on likes and saves — and the one gate in the reader tier model
 * that is a REAL gate rather than a conversion nudge.
 *
 * > "Interactions is gated by auth."
 *
 * Everything else in this model is metered in the browser, because the surfaces
 * it covers are prerendered pages that crawlers must keep receiving in full
 * (see `@/lib/metering`). Interactions carry none of that: they are POSTs to
 * Route Handlers, nothing indexes them, and no crawler issues one. So there is
 * no reason to settle for a client-side check here, and every reason not to —
 * a `fetch` to these endpoints is three keystrokes in a console.
 *
 * ## Why this reads the session rather than trusting the caller
 *
 * `resolveEngagementSubject` already answers "who is this" and degrades to the
 * anonymous cookie when `withAuth()` fails, which is the right behaviour for
 * *attributing* engagement and the wrong one for *authorising* it: a reader
 * whose session could not be read would be handed an anonymous key and, under
 * this policy, silently denied. Denying is the correct direction on a failure
 * — it is the same fail-closed rule `canAccess` applies to an unknown plan —
 * but the two concerns must not share one answer, so the guard asks separately.
 *
 * ## The plan comes from the session, never from the request
 *
 * `planFor(signedIn)` takes a boolean this module derived itself. Nothing a
 * caller sends reaches it. That matters because `Plan` is the currency of every
 * gate in the app, and a plan that could be asserted by a header would be a
 * paywall anyone could walk through.
 */
export interface InteractionGate {
  /** True when the caller may interact. */
  allowed: boolean;
  /** The response to return when they may not — never `null` if denied. */
  denial: NextResponse | null;
}

const DENIAL_BODY = {
  success: false,
  requiresAuth: true,
  message: "Sign in to like and save articles",
} as const;

/**
 * Decide whether this request may perform an interaction.
 *
 * Answers `401`, not `403`: the caller is unauthenticated rather than
 * forbidden, and a client that sees `requiresAuth` knows to send the reader to
 * sign in rather than to report a failure. A bare `403` would have the UI tell
 * a reader something went wrong, when nothing did.
 */
export async function guardInteraction(): Promise<InteractionGate> {
  let signedIn = false;
  try {
    // Lazy import for the same reason `@/lib/engagement` does it: authkit is
    // server-only, and loading it at call time keeps this module importable
    // from anything that transitively reaches the actions layer.
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const { user } = await withAuth();
    signedIn = !!user;
  } catch (err) {
    // Fail CLOSED. An auth outage denying a like is a small, visible,
    // self-correcting failure; an auth outage silently opening an account-only
    // capability is not, and is not something the logs would ever show.
    console.error("[INTERACTION-GUARD] withAuth() failed; denying", err);
    signedIn = false;
  }

  if (canAccess("interactions", planFor(signedIn))) {
    return { allowed: true, denial: null };
  }
  return {
    allowed: false,
    denial: NextResponse.json(DENIAL_BODY, { status: 401 }),
  };
}
