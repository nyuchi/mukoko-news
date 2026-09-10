/**
 * Security response headers for every route.
 *
 * Consumed by `next.config.ts`'s `headers()`. Kept here (not inline in the
 * config) so the policy is a plain, unit-testable value rather than something
 * only observable by curling a running server — a headers config that *looks*
 * right and silently does not apply is the exact defect class this exists to
 * prevent.
 *
 * ── What is NOT set here, and why ──────────────────────────────────────────
 *
 * **Strict-Transport-Security** — Vercel already sends it on the production
 * host (`strict-transport-security: max-age=63072000`, verified against
 * https://news.mukoko.com). Setting it again here would emit a second, weaker
 * copy for browsers to reconcile. Widening it to `includeSubDomains; preload`
 * is a *platform* decision, not a frontend one: it would bind every
 * `*.mukoko.com` sibling (assets, profile-images, weather, …) to HTTPS-only
 * forever, and this repo owns none of them.
 *
 * **upgrade-insecure-requests** — deliberately omitted. 303 articles on the
 * live corpus carry an `http://` `externalUrl` (measured 2026-09-10), and the
 * directive upgrades document-initiated navigations as well as subresources —
 * so it would silently break the outbound link on every one of them for the
 * sake of images that are already fetched over HTTPS (every publisher image is
 * proxied through `assets.mukoko.com`; see `src/lib/image.ts`).
 *
 * **Cross-Origin-Resource-Policy / -Embedder-Policy** — omitted on purpose.
 * `/embed/widget.js` and the embed iframe are cross-origin resources *by
 * design* (sister apps such as weather.mukoko.com load them); CORP would break
 * the embed product, and COEP would break third-party images.
 */

/**
 * Routes under this prefix are the embeddable widget surface and MUST stay
 * framable by third parties (`public/embed/widget.js` mounts
 * `/embed/iframe?…` inside a sandboxed iframe on sister apps). Everything else
 * is frame-denied.
 */
export const FRAMEABLE_PREFIX = '/embed';

/** Where CSP violation reports are POSTed (see src/app/api/csp-report/route.ts). */
export const CSP_REPORT_PATH = '/api/csp-report';

/** The single image host `next/image`'s default loader is allowed to fetch. */
export const ALLOWED_IMAGE_HOST = 'assets.mukoko.com';

/**
 * Everything the app does not use gets an empty allowlist. Features the app
 * *does* use are absent on purpose so they keep their `self` default:
 * `web-share` (share sheet), `clipboard-write` (copy link), `fullscreen`.
 *
 * `publickey-credentials-get` is denied because passkeys live entirely on the
 * WorkOS-hosted AuthKit page (identity.nyuchi.com) — no WebAuthn ceremony ever
 * runs on this origin. If sign-in is ever inlined again, this must be revisited.
 */
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'browsing-topics=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ');

/**
 * The ENFORCING policy. Deliberately tiny: only directives whose failure mode
 * is not "blank page".
 *
 * - `base-uri 'self'` — no `<base>` tag exists anywhere in the app, so this can
 *   only ever block an injected one.
 * - `object-src 'none'` — no plugins, ever.
 * - `form-action 'self'` — every form is an `onSubmit` handler or a Server
 *   Action posting to its own URL; nothing submits cross-origin.
 * - `frame-ancestors` — the framing control, scoped per route.
 *
 * Note there is no `default-src` here: an absent directive is unrestricted, so
 * these four cannot break a page that loads a script/style/image we failed to
 * enumerate. That enumeration lives in the Report-Only policy below.
 *
 * `'self'` is safe for the sandboxed embed frame too: `frame-ancestors` is
 * evaluated against the framing chain, and the embed renders no forms and no
 * `<base>` — so neither `'self'` directive is ever consulted in the opaque
 * origin the `allow-scripts`-only sandbox creates.
 */
function enforcedCsp(frameAncestors: string): string {
  return [
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
}

/**
 * The FULL policy, shipped Report-Only until real traffic proves it.
 *
 * Sources, enumerated by grep rather than guessed:
 * - scripts: only `/_next/*` chunks (same-origin) plus inline — the theme
 *   bootstrap in `app/layout.tsx`, Next's own flight payload
 *   (`self.__next_f.push`) and the JSON-LD blocks. `https://news.google.com`
 *   is pre-declared for the Google Preferred Sources module
 *   (`swg/js/v1/publisher.mjs`) that `feat/preferred-sources` loads on reader
 *   intent — declaring it now means that branch cannot land a silent break.
 * - styles: Tailwind is compiled to a same-origin stylesheet, but inline
 *   `style={{…}}` attributes are used throughout (source icons, hero cards),
 *   which `'unsafe-inline'` covers.
 * - fonts: self-hosted via `next/font` → `/_next/static`. No fonts.gstatic.com.
 * - images: every publisher image is proxied via `assets.mukoko.com`, but
 *   WorkOS/IdP profile pictures and `www.google.com/s2/favicons` are
 *   open-ended third-party hosts, so `https:` is the honest ceiling here.
 * - connect: Server Actions are same-origin POSTs; the service worker
 *   (`public/sw.js`, governed by the policy served with the worker script)
 *   revalidates `assets.mukoko.com/i/*`.
 * - frames: `/embed` renders same-origin `/embed/iframe` previews.
 *
 * ## Why `'unsafe-inline'` for scripts instead of a nonce
 *
 * A per-request nonce requires per-request HTML. Next's automatic nonce
 * propagation reads the nonce out of the CSP header on the *request*, so the
 * nonce is baked into the rendered HTML — which is fatal for this app, because
 * nearly every route is statically prerendered or ISR-cached (`/` and
 * `/topic/[slug]` at 300s, `/insights` at 600s, and `x-nextjs-prerender: 1` on
 * production `/`). A cached page would carry a stale nonce that no longer
 * matches the freshly-generated header, and every script on it — Next's own
 * runtime included — would be blocked. Opting the whole site into dynamic
 * rendering to gain a nonce would trade a real, measured performance property
 * for a partial XSS mitigation, on a site whose pages are public and cacheable
 * by design.
 *
 * Residual risk, stated plainly: with `'unsafe-inline'`, this policy does not
 * stop injected inline script. What it does stop is the *second* half of most
 * XSS chains and a chunk of the surrounding surface — loading script from an
 * attacker's host, exfiltrating over `connect-src`, `<base>` hijacking,
 * plugin/object embedding, cross-origin form posts, and clickjacking. The
 * durable fix is hash-based `script-src` once the inline set is closed, or a
 * nonce if the caching model ever changes; neither is shippable today.
 */
function reportOnlyCsp(frameAncestors: string, isDev: boolean): string {
  // Next's dev server compiles with eval (React Refresh / HMR). Production
  // never needs it, so it is scoped to dev rather than shipped.
  const scriptSrc = [
    "script-src 'self' 'unsafe-inline'",
    isDev ? "'unsafe-eval'" : '',
    'https://news.google.com',
  ]
    .filter(Boolean)
    .join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://${ALLOWED_IMAGE_HOST} https://news.google.com`,
    "media-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'self' https://news.google.com",
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp',
  ].join('; ');
}

export interface HeaderEntry {
  key: string;
  value: string;
}

export interface HeaderRule {
  source: string;
  headers: HeaderEntry[];
}

function commonHeaders(frameAncestors: string, isDev: boolean): HeaderEntry[] {
  return [
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
    // Severs window.opener for cross-origin popups (XS-Leaks). Ignored inside
    // iframes, so it is harmless on the embed surface. No popup-based OAuth
    // exists here — sign-in is a full-page redirect to the hosted AuthKit page.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Reporting-Endpoints', value: `csp="${CSP_REPORT_PATH}"` },
    { key: 'Content-Security-Policy', value: enforcedCsp(frameAncestors) },
    {
      key: 'Content-Security-Policy-Report-Only',
      value: reportOnlyCsp(frameAncestors, isDev),
    },
  ];
}

/**
 * The two rules, in the order `next.config.ts` returns them.
 *
 * The catch-all uses a negative lookahead so `/embed` and `/embed/*` match
 * *only* the framable rule. Two overlapping rules would be worse than useless:
 * a route matched by both would receive `X-Frame-Options: DENY` *and*
 * `frame-ancestors *`, and X-Frame-Options wins in every browser that supports
 * it — silently killing the embed product while the config read as if it
 * allowed framing.
 */
export function buildSecurityHeaders(
  opts: { isDev?: boolean } = {}
): HeaderRule[] {
  const isDev = opts.isDev ?? process.env.NODE_ENV !== 'production';

  return [
    {
      // Everything except /embed and /embed/*.
      source: '/((?!embed(?:/|$)).*)',
      headers: [
        ...commonHeaders("'none'", isDev),
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
    {
      // The embeddable widget surface. `X-Frame-Options` is deliberately absent:
      // it has no "allow any origin" value, and emitting DENY/SAMEORIGIN here
      // would break every sister-app embed. `frame-ancestors *` is the modern,
      // expressive equivalent and every browser that matters honours it.
      source: '/embed/:path*',
      headers: commonHeaders('*', isDev),
    },
  ];
}
