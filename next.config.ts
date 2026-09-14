import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { NextConfig } from 'next';
import { buildSecurityHeaders } from './src/lib/security-headers';

/**
 * The released version, read from the `VERSION` file at build time.
 *
 * `VERSION` is the one version in this repo that MOVES: `release.yml` bumps it
 * on every green merge to `main` and tags it (v4.60.0 at the time of writing).
 * `package.json` is deliberately not used — it has read `4.0.0` since the repo
 * was at 4.x and is never bumped, so wiring the update banner to it would
 * announce the same version after every deploy, which is worse than showing
 * nothing.
 *
 * Falls back to null rather than to a guess: the banner drops its version line
 * entirely when there is no trustworthy value, on the same principle as
 * `incomingVersion`.
 */
function releasedVersion(): string | null {
  try {
    const raw = readFileSync(join(process.cwd(), 'VERSION'), 'utf8').trim();
    return /^\d+\.\d+\.\d+$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

const nextConfig: NextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Don't advertise the framework/version in every response.
  poweredByHeader: false,

  env: {
    // Read at build time so the client can name the version it is upgrading to.
    // `''` rather than omitting the key: an absent `env` entry leaves
    // `process.env.NEXT_PUBLIC_APP_VERSION` as a literal `undefined` reference
    // in the bundle, while an empty string is falsy and handled.
    NEXT_PUBLIC_APP_VERSION: releasedVersion() ?? '',
  },

  // Image optimization configuration.
  //
  // This was `hostname: '**'`, which made the Vercel image optimiser an open
  // proxy: `/_next/image?url=https://anything` would fetch and re-serve any
  // HTTPS host on the internet, on this account's paid optimisation budget.
  //
  // An explicit publisher allowlist is not the fix — measured on the live
  // corpus (2026-09-10) article images span **340 distinct hosts** across
  // 54,573 images, and 238 of those hosts first appeared within the last four
  // weeks (210 in one week alone, when the newsdata source-discovery sweep
  // landed). An allowlist would need editing weekly and would fail closed on
  // every newly-discovered publisher.
  //
  // The real answer already exists: `src/lib/image.ts` routes every publisher
  // image through the image worker at `assets.mukoko.com/i/*`, which fetches
  // the origin server-side, resizes and caches it. So exactly one remote host
  // ever reaches the optimiser, and it is ours. The only `next/image` in the
  // tree that uses the default loader is `src/components/topic-timeline.tsx`,
  // and it passes an already-proxied URL; `hero-card.tsx` supplies its own
  // `mukokoImageLoader` (custom loaders bypass this list entirely) and
  // `source-icon.tsx` is `unoptimized`. `src/lib/__tests__/image-hosts.test.ts`
  // holds that shape in place.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'assets.mukoko.com',
        pathname: '/i/**',
      },
    ],
  },

  // Security response headers — see src/lib/security-headers.ts for the full
  // rationale (including what is deliberately NOT set, and why the CSP ships
  // enforcing-lite + Report-Only rather than as one enforcing policy).
  async headers() {
    return buildSecurityHeaders();
  },
};

export default nextConfig;
