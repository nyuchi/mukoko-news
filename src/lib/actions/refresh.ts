"use server";

export async function triggerFeedCollection(): Promise<void> {
  const url = process.env.FLY_WORKER_URL;
  const token = process.env.FLY_TRIGGER_TOKEN;
  if (!url || !token) return;

  try {
    await fetch(`${url}/trigger/collect`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      // Bound the fire-and-forget trigger so a stalled worker can't hold the action open.
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // fire-and-forget — don't block the UI refresh
  }
}
