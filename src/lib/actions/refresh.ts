"use server";

/**
 * Ask for a fresh collection of every feed, through the gateway.
 *
 * The app never reaches the pipeline (owner rule, 2026-09-25): the pipeline
 * sits behind the databases, and the gateway Worker is the app's backend. So
 * this calls the gateway's `POST /api/refresh`, which holds the pipeline
 * credential, validates the trigger host, and applies a per-caller cooldown.
 * It used to POST to the Fly worker's `/trigger/collect` directly, which meant
 * the app held the pipeline's service secret and bypassed that cooldown.
 *
 * Fire-and-forget: a refresh the gateway declines (cooldown, misconfiguration,
 * outage) must never block the reader's feed from reloading.
 */
const GATEWAY_BASE = process.env.GATEWAY_API_URL || "https://news.mukoko.dev";

export async function triggerFeedCollection(): Promise<void> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/refresh`, {
      method: "POST",
      // Bound it so a slow gateway can't hold the action open.
      signal: AbortSignal.timeout(5000),
    });
    await res.body?.cancel();
  } catch {
    // fire-and-forget — don't block the UI refresh
  }
}
