import { describe, it, expect } from 'vitest';
// Next's OWN bundled matcher — the same code that compiles a `headers()`
// `source` at runtime. Matching against anything else would test a different
// regex dialect than the one that ships.
import { createRequire } from 'node:module';
const { pathToRegexp } = createRequire(import.meta.url)(
  'next/dist/compiled/path-to-regexp'
) as { pathToRegexp: (path: string) => RegExp };
import {
  buildSecurityHeaders,
  FRAMEABLE_PREFIX,
  CSP_REPORT_PATH,
  ALLOWED_IMAGE_HOST,
  type HeaderRule,
} from '@/lib/security-headers';

/**
 * These tests exist because a `headers()` config that looks correct and does
 * not actually apply is indistinguishable, from the source, from one that does.
 * They assert three separate things:
 *   1. the policy VALUES are what we intend,
 *   2. the route SOURCES select the routes we intend (compiled with the same
 *      path-to-regexp Next uses, so a typo'd negative lookahead fails here and
 *      not in production),
 *   3. the two rules never overlap — an overlap would hand /embed both
 *      `X-Frame-Options: DENY` and `frame-ancestors *`, and XFO wins.
 */

const rules = buildSecurityHeaders({ isDev: false });

function ruleFor(path: string): HeaderRule[] {
  return rules.filter((rule) => pathToRegexp(rule.source).test(path));
}

function headerValue(path: string, key: string): string | undefined {
  const matched = ruleFor(path);
  const entry = matched.flatMap((r) => r.headers).find((h) => h.key === key);
  return entry?.value;
}

function directive(csp: string | undefined, name: string): string | undefined {
  return csp
    ?.split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

const PAGE_ROUTES = ['/', '/article/abc123', '/search', '/admin', '/insights', '/profile'];
const EMBED_ROUTES = ['/embed', '/embed/iframe'];
const API_ROUTES = ['/api/health', '/api/articles/abc/like', '/api/insights/export'];

describe('buildSecurityHeaders — route selection', () => {
  it('matches every route with exactly one rule', () => {
    for (const path of [...PAGE_ROUTES, ...EMBED_ROUTES, ...API_ROUTES]) {
      expect(ruleFor(path), `${path} should match exactly one rule`).toHaveLength(1);
    }
  });

  it('routes /embed and /embed/* to the framable rule and nothing else to it', () => {
    for (const path of EMBED_ROUTES) {
      expect(ruleFor(path)[0].source).toBe('/embed/:path*');
    }
    for (const path of [...PAGE_ROUTES, ...API_ROUTES]) {
      expect(ruleFor(path)[0].source).not.toBe('/embed/:path*');
    }
  });

  it('does not treat a path that merely starts with the word "embed" as framable', () => {
    // `/embedded-*` is not the widget surface; the lookahead must be anchored
    // on a segment boundary, not a prefix.
    expect(ruleFor('/embedded-analytics')[0].source).not.toBe('/embed/:path*');
    expect(headerValue('/embedded-analytics', 'X-Frame-Options')).toBe('DENY');
  });
});

describe('buildSecurityHeaders — framing', () => {
  it('denies framing everywhere except the embed surface', () => {
    for (const path of [...PAGE_ROUTES, ...API_ROUTES]) {
      expect(headerValue(path, 'X-Frame-Options')).toBe('DENY');
      expect(directive(headerValue(path, 'Content-Security-Policy'), 'frame-ancestors')).toBe(
        "frame-ancestors 'none'"
      );
    }
  });

  it('leaves the embed surface framable by any origin', () => {
    for (const path of EMBED_ROUTES) {
      // X-Frame-Options has no "allow any origin" value — emitting it at all
      // here would break every sister-app embed.
      expect(headerValue(path, 'X-Frame-Options')).toBeUndefined();
      expect(directive(headerValue(path, 'Content-Security-Policy'), 'frame-ancestors')).toBe(
        'frame-ancestors *'
      );
      expect(
        directive(headerValue(path, 'Content-Security-Policy-Report-Only'), 'frame-ancestors')
      ).toBe('frame-ancestors *');
    }
  });

  it('keeps FRAMEABLE_PREFIX and the embed rule source in agreement', () => {
    expect(ruleFor(`${FRAMEABLE_PREFIX}/iframe`)[0].source).toBe('/embed/:path*');
  });
});

describe('buildSecurityHeaders — the non-negotiable headers', () => {
  it.each([...PAGE_ROUTES, ...EMBED_ROUTES, ...API_ROUTES])('sets them on %s', (path) => {
    expect(headerValue(path, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headerValue(path, 'X-Content-Type-Options')).toBe('nosniff');
    expect(headerValue(path, 'Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(headerValue(path, 'Permissions-Policy')).toBeTruthy();
  });

  it('does not set Strict-Transport-Security — Vercel already sends it', () => {
    // Duplicating it would emit a second, weaker max-age for browsers to
    // reconcile. See the module docblock.
    for (const rule of rules) {
      expect(rule.headers.map((h) => h.key)).not.toContain('Strict-Transport-Security');
    }
  });

  it('does not set CORP/COEP, which would break the cross-origin embed product', () => {
    const keys = rules.flatMap((r) => r.headers.map((h) => h.key));
    expect(keys).not.toContain('Cross-Origin-Resource-Policy');
    expect(keys).not.toContain('Cross-Origin-Embedder-Policy');
  });
});

describe('Permissions-Policy', () => {
  const policy = headerValue('/', 'Permissions-Policy')!;

  it.each([
    'camera',
    'microphone',
    'geolocation',
    'payment',
    'usb',
    'serial',
    'browsing-topics',
    'publickey-credentials-get',
  ])('denies %s outright', (feature) => {
    expect(policy).toContain(`${feature}=()`);
  });

  it.each(['web-share', 'clipboard-write', 'fullscreen'])(
    'leaves %s unmentioned so it keeps its self default',
    (feature) => {
      // The share sheet (navigator.share) and copy-link (navigator.clipboard)
      // are load-bearing in the article and newsbytes UIs.
      expect(policy).not.toContain(feature);
    }
  );
});

describe('the enforcing CSP', () => {
  const csp = headerValue('/', 'Content-Security-Policy')!;

  it('carries only directives whose failure mode is not a blank page', () => {
    const names = csp.split(';').map((d) => d.trim().split(' ')[0]);
    expect(names.sort()).toEqual(
      ['base-uri', 'form-action', 'frame-ancestors', 'object-src'].sort()
    );
  });

  it('has no default-src, so an un-enumerated resource cannot be blocked by it', () => {
    expect(directive(csp, 'default-src')).toBeUndefined();
  });

  it('locks base-uri, object-src and form-action', () => {
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'form-action')).toBe("form-action 'self'");
  });

  it('omits upgrade-insecure-requests, which would break http:// publisher links', () => {
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('does not report — reporting is attached to the Report-Only policy only', () => {
    expect(csp).not.toContain('report-uri');
    expect(csp).not.toContain('report-to');
  });
});

describe('the Report-Only CSP', () => {
  const csp = headerValue('/', 'Content-Security-Policy-Report-Only')!;

  it('is shipped Report-Only, never as a second enforcing policy', () => {
    // The full policy becomes enforcing only once real traffic has produced
    // violation data; until then it must not be able to break a page.
    expect(headerValue('/', 'Content-Security-Policy')).not.toContain('default-src');
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
  });

  it('allows the inline scripts the App Router and the theme bootstrap require', () => {
    expect(directive(csp, 'script-src')).toContain("'unsafe-inline'");
    expect(directive(csp, 'style-src')).toContain("'unsafe-inline'");
  });

  it('does not allow eval in production', () => {
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-eval'");
  });

  it('allows eval only in development, where Next compiles with it', () => {
    const dev = buildSecurityHeaders({ isDev: true })[0].headers.find(
      (h) => h.key === 'Content-Security-Policy-Report-Only'
    )!.value;
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
  });

  it('pre-declares the Google Preferred Sources module host', () => {
    // feat/preferred-sources loads https://news.google.com/swg/js/v1/publisher.mjs
    // on reader intent; declaring it here means that branch cannot land a
    // silent CSP break.
    expect(directive(csp, 'script-src')).toContain('https://news.google.com');
  });

  it('allows the service worker to revalidate the image worker', () => {
    expect(directive(csp, 'connect-src')).toContain(`https://${ALLOWED_IMAGE_HOST}`);
    expect(directive(csp, 'worker-src')).toBe("worker-src 'self'");
  });

  it('allows https images from any host — profile pictures and favicons are open-ended', () => {
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data: blob: https:");
  });

  it('serves fonts from self only — next/font self-hosts them', () => {
    expect(directive(csp, 'font-src')).toBe("font-src 'self' data:");
    expect(csp).not.toContain('fonts.gstatic.com');
  });

  it('points its reports at the collector route', () => {
    expect(directive(csp, 'report-uri')).toBe(`report-uri ${CSP_REPORT_PATH}`);
    expect(directive(csp, 'report-to')).toBe('report-to csp');
    expect(headerValue('/', 'Reporting-Endpoints')).toBe(`csp="${CSP_REPORT_PATH}"`);
  });
});
