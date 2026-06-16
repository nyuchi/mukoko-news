"use server";

export async function triggerFeedCollection(): Promise<void> {
  const url = process.env.FLY_WORKER_URL;
  if (!url) return;

  try {
    await fetch(`${url}/trigger/collect`, { method: "POST" });
  } catch {
    // fire-and-forget — don't block the UI refresh
  }
}
