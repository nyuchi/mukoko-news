/**
 * Request-classification policy for the Mukoko News service worker.
 *
 * ⚠️ DUPLICATION NOTE: `public/sw.js` is a standalone, unbundled script served
 * from the public dir, so it cannot import this module. The `classifyRequest`
 * and `isArticlePath` functions are duplicated there (kept intentionally tiny).
 * If you change the policy here, update `public/sw.js` to match — and vice
 * versa. This module is the tested source of truth for the policy.
 */

/** Origin that serves pipeline-proxied article images (image-worker). */
export const ASSETS_IMAGE_ORIGIN = 'https://assets.mukoko.com';

/**
 * Path prefixes the service worker must NEVER handle: authenticated or
 * mutating surfaces (engagement APIs, WorkOS auth flows, the admin app,
 * sign-in, and the gateway MCP path). Matches `/api`, `/api/...`, etc.
 */
const EXCLUDED_PATHS = /^\/(api|auth|admin|sign-in|mcp)(\/|$)/;

export type SwRequestKind =
  | 'static-asset' // /_next/static/* — immutable hashed chunks, cache-first
  | 'navigation' // document loads — network-first, cache fallback, /offline last
  | 'image' // assets.mukoko.com/i/* — stale-while-revalidate, capped cache
  | null; // not handled by the service worker (falls through to the network)

export interface SwRequestInfo {
  /** Full request URL. */
  url: string;
  /** HTTP method — anything other than GET is never handled. */
  method: string;
  /** `Request.mode` — 'navigate' for top-level document loads. */
  mode?: string;
  /** True when the request carries an Authorization header. */
  hasAuthorization?: boolean;
  /** Origin the service worker is running on (`self.location.origin`). */
  swOrigin: string;
}

/** True for article detail pages (`/article/{id}`) — the offline-reading promise. */
export function isArticlePath(pathname: string): boolean {
  return /^\/article\/[^/]+$/.test(pathname);
}

/**
 * Decide whether (and how) the service worker handles a request.
 * Returns `null` for everything that must fall through to the network
 * untouched: non-GET, Authorization-bearing, excluded paths, foreign
 * origins, and same-origin subresource fetches (e.g. RSC payloads).
 */
export function classifyRequest(info: SwRequestInfo): SwRequestKind {
  if (info.method.toUpperCase() !== 'GET') return null;
  if (info.hasAuthorization) return null;

  let url: URL;
  try {
    url = new URL(info.url);
  } catch {
    return null;
  }

  // Article images from the image worker (cross-origin, GET only).
  if (url.origin === ASSETS_IMAGE_ORIGIN && url.pathname.startsWith('/i/')) {
    return 'image';
  }

  // Everything else must be same-origin.
  if (url.origin !== info.swOrigin) return null;
  if (EXCLUDED_PATHS.test(url.pathname)) return null;

  // Hashed, immutable Next.js build assets.
  if (url.pathname.startsWith('/_next/static/')) return 'static-asset';

  // Top-level page loads (articles, feed pages, everything public).
  if (info.mode === 'navigate') return 'navigation';

  return null;
}
