/**
 * Mukoko News service worker.
 *
 * Registered by src/components/pwa/sw-register.tsx as /sw.js?v=<build id>, so
 * every deploy produces a new script URL → the browser installs a fresh worker
 * and `activate` prunes the previous version's caches. The version is read
 * from the registration URL's `v` query param (no build step needed).
 *
 * Strategy summary (see src/lib/pwa/sw-policy.ts for the tested policy):
 *   /_next/static/*            cache-first (immutable hashed chunks)
 *   navigations (all pages)    network-first → cache → /offline fallback;
 *                              /article/{id} goes to a larger dedicated cache
 *                              (the offline-articles promise in the /help FAQ)
 *   assets.mukoko.com/i/*      stale-while-revalidate, capped at ~150 entries
 *   NEVER handled              non-GET, Authorization-bearing requests,
 *                              /api/*, /auth/*, /admin*, /sign-in, /mcp,
 *                              other origins, subresource fetches (RSC etc.)
 *
 * Update flow: install does NOT call skipWaiting — the page shows an
 * "Update available" banner and posts {type:'SKIP_WAITING'} when the user
 * accepts; the client reloads once on controllerchange.
 */

/* eslint-env serviceworker */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'mukoko-';

const CACHE_NAMES = {
  precache: `${PREFIX}precache-${VERSION}`,
  static: `${PREFIX}static-${VERSION}`,
  pages: `${PREFIX}pages-${VERSION}`,
  articles: `${PREFIX}articles-${VERSION}`,
  images: `${PREFIX}images-${VERSION}`,
};

/** Trim-on-put caps (LRU-ish: oldest inserted entries are evicted first). */
const MAX_ENTRIES = {
  [CACHE_NAMES.pages]: 60,
  [CACHE_NAMES.articles]: 150,
  [CACHE_NAMES.images]: 150,
};

const OFFLINE_URL = '/offline';

/**
 * Small, stable-URL assets only. Next's hashed chunks are NOT precached —
 * they are runtime-cached (cache-first) as the app requests them.
 */
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/mukoko-mark-full-light.svg',
  '/mukoko-mark-full-dark.svg',
];

// ---------------------------------------------------------------------------
// Request policy — ⚠️ duplicated from src/lib/pwa/sw-policy.ts (the tested
// source of truth) because this file is a standalone unbundled script.
// Keep both in sync.
// ---------------------------------------------------------------------------

const ASSETS_IMAGE_ORIGIN = 'https://assets.mukoko.com';
const EXCLUDED_PATHS = /^\/(api|auth|admin|sign-in|mcp)(\/|$)/;

/** True for article detail pages (`/article/{id}`). */
function isArticlePath(pathname) {
  return /^\/article\/[^/]+$/.test(pathname);
}

/**
 * @param {{url: string, method: string, mode?: string, hasAuthorization?: boolean, swOrigin: string}} info
 * @returns {'static-asset'|'navigation'|'image'|null}
 */
function classifyRequest(info) {
  if (info.method.toUpperCase() !== 'GET') return null;
  if (info.hasAuthorization) return null;

  let url;
  try {
    url = new URL(info.url);
  } catch {
    return null;
  }

  if (url.origin === ASSETS_IMAGE_ORIGIN && url.pathname.startsWith('/i/')) {
    return 'image';
  }

  if (url.origin !== info.swOrigin) return null;
  if (EXCLUDED_PATHS.test(url.pathname)) return null;

  if (url.pathname.startsWith('/_next/static/')) return 'static-asset';
  if (info.mode === 'navigate') return 'navigation';

  return null;
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/**
 * Evict oldest entries until the cache holds at most `max` items.
 * Cache.keys() returns entries in insertion order, so deleting from the
 * front is a simple FIFO/LRU-ish trim.
 * @param {string} cacheName
 */
async function trimCache(cacheName) {
  const max = MAX_ENTRIES[cacheName];
  if (!max) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) {
    await cache.delete(keys[i]);
  }
}

/**
 * @param {string} cacheName
 * @param {Request} request
 * @param {Response} response
 */
async function putAndTrim(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  await trimCache(cacheName);
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/**
 * Cache-first for immutable hashed build assets.
 * @param {Request} request
 */
async function handleStaticAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await putAndTrim(CACHE_NAMES.static, request, response.clone());
  }
  return response;
}

/**
 * Network-first for page loads: fresh when online, cached copy when the
 * network fails, /offline as the last resort.
 * @param {Request} request
 */
async function handleNavigation(request) {
  const url = new URL(request.url);
  const cacheName = isArticlePath(url.pathname) ? CACHE_NAMES.articles : CACHE_NAMES.pages;
  try {
    const response = await fetch(request);
    if (response.ok) {
      await putAndTrim(cacheName, request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    throw error;
  }
}

/**
 * Stale-while-revalidate for article images: serve the cached copy
 * immediately and refresh it in the background.
 * @param {FetchEvent} event
 */
async function handleImage(event) {
  const cache = await caches.open(CACHE_NAMES.images);
  const cached = await cache.match(event.request);

  const refresh = fetch(event.request)
    .then(async (response) => {
      // <img> loads are no-cors → opaque responses (ok === false); cache those too.
      if (response.ok || response.type === 'opaque') {
        await putAndTrim(CACHE_NAMES.images, event.request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  if (fresh) return fresh;
  return Response.error();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  // No skipWaiting here — activation is user-approved via the update banner.
  event.waitUntil(
    caches
      .open(CACHE_NAMES.precache)
      .then((cache) =>
        cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })))
      )
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set(Object.values(CACHE_NAMES));
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(PREFIX) && !keep.has(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const kind = classifyRequest({
    url: event.request.url,
    method: event.request.method,
    mode: event.request.mode,
    hasAuthorization: event.request.headers.has('authorization'),
    swOrigin: self.location.origin,
  });

  if (kind === 'static-asset') {
    event.respondWith(handleStaticAsset(event.request));
  } else if (kind === 'navigation') {
    event.respondWith(handleNavigation(event.request));
  } else if (kind === 'image') {
    event.respondWith(handleImage(event));
  }
  // null → not handled; the request goes straight to the network.
});
