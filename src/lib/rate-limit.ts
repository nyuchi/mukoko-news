/**
 * Rate limiter with a durable Upstash Redis backend and an in-memory fallback.
 *
 * When UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set, limits are
 * enforced globally via a fixed-window INCR+PEXPIRE over the Upstash REST API
 * (no SDK dependency). Without them — or if Redis errors — the check degrades
 * to the original per-instance in-memory sliding window, so limits still apply
 * per Vercel instance rather than globally. Public reads fail OPEN: a limiter
 * outage must never take the endpoints down with it.
 */

const windows = new Map<string, number[]>();

/** Per-instance sliding window — the fallback and the no-Redis default. */
function checkRateLimitMemory(key: string, max: number, windowMs: number): boolean {
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

/** Global fixed window via Upstash REST. Returns null when Redis is unusable. */
async function checkRateLimitRedis(
  key: string,
  max: number,
  windowMs: number
): Promise<boolean | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  // Fixed window: bucket the key by window so INCR counts one window at a time;
  // PEXPIRE NX arms the TTL only on the first hit of the window.
  const bucket = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', bucket],
        ['PEXPIRE', bucket, String(windowMs), 'NX'],
      ]),
      // A slow limiter must not stall the request path.
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      console.error(`[RATE-LIMIT] Upstash responded ${res.status}; falling back to memory`);
      return null;
    }
    const results = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    const count = Number(results?.[0]?.result);
    if (!Number.isFinite(count)) {
      console.error('[RATE-LIMIT] unexpected Upstash payload; falling back to memory');
      return null;
    }
    return count <= max;
  } catch (err) {
    console.error('[RATE-LIMIT] Upstash request failed; falling back to memory', err);
    return null;
  }
}

/**
 * True when the caller is within the limit. Durable (Upstash) when configured,
 * per-instance in-memory otherwise.
 */
export async function checkRateLimit(
  key: string,
  max = 3,
  windowMs = 60_000
): Promise<boolean> {
  const redisVerdict = await checkRateLimitRedis(key, max, windowMs);
  if (redisVerdict !== null) return redisVerdict;
  return checkRateLimitMemory(key, max, windowMs);
}

export function getRequestIp(request: Request): string {
  return (
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown"
  );
}
