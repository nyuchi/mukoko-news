/**
 * In-memory sliding window rate limiter.
 *
 * Works within a single Vercel Fluid Compute instance. The fly-worker's own
 * rate limiter is the global guard for collection triggers; this protects
 * individual MongoDB fetch routes from per-IP burst traffic.
 */

const windows = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  max = 3,
  windowMs = 60_000
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const prev = windows.get(key) ?? [];
  const active = prev.filter((t) => t > cutoff);

  if (active.length >= max) {
    windows.set(key, active);
    return false;
  }

  active.push(now);
  windows.set(key, active);
  return true;
}

export function getRequestIp(request: Request): string {
  return (
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown"
  );
}
