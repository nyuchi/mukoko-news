import type { NextConfig } from 'next';
import { buildSecurityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Don't advertise the framework/version in every response.
  poweredByHeader: false,

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
