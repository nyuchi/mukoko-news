import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  COUNTRIES,
  COUNTRY_SCOPE_TOTAL,
  FALLBACK_LIVE_COUNTRY_CODES,
  coverageClaim,
  coverageFragment,
} from '../constants';

/**
 * The public coverage claim, pinned — but pinned to a SHAPE, not to a number.
 *
 * ## What changed, and why this file changed with it
 *
 * The count used to be a hardcoded sixteen, and this file asserted `=== 16`
 * everywhere. That was right while the list was hand-maintained: the number was
 * a decision, and a test that fails when a decision changes is the point.
 *
 * The count is now a live read of the corpus — how many countries actually
 * cleared the aggregation bar in the last 30 days. Asserting `=== 16` against
 * that would be asserting that the world does not change, and the first country
 * to come online would turn a correct site into a red build. Worse, the obvious
 * fix under deadline is to edit the expected number, which trains everyone to
 * treat this file as a formality.
 *
 * So the assertions moved up a level. They no longer ask *what the number is*.
 * They ask:
 *
 *   1. that no surface writes a number of its own (the drift this exists to stop),
 *   2. that the scope half — 54 AU member states — really is static,
 *   3. that the copy builders always state both halves and the "coming soon",
 *   4. that the fallback is a sane, in-scope, duplicate-free subset.
 *
 * Every one of those is invariant under the count moving, and every one of them
 * fails if the claim starts drifting again.
 */

describe('scope is static and really is the whole AU', () => {
  it('54 member states', () => {
    expect(COUNTRY_SCOPE_TOTAL).toBe(54);
    expect(COUNTRIES).toHaveLength(54);
  });

  it('every country code is unique', () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
  });
});

describe('the sanctioned copy builders', () => {
  it('state the live count and the scope, whatever the live count is', () => {
    for (const n of [1, 7, 16, 23, 54]) {
      expect(coverageFragment(n)).toContain(String(n));
      expect(coverageFragment(n)).toContain('54');
      expect(coverageClaim(n)).toContain(String(n));
      expect(coverageClaim(n)).toContain('54');
    }
  });

  it('always say the rest are coming soon', () => {
    expect(coverageClaim(16).toLowerCase()).toContain('coming soon');
  });

  it('never emit a bare zero', () => {
    // Not a formatting nicety. `getLiveCoverageAction` collapses a failed read
    // onto the fallback precisely so this string is never built with 0 — if
    // that guard is ever removed, "live in 0 African countries" goes into the
    // page title, llms.txt and the MCP server card, and answer engines cache it.
    expect(coverageFragment(0)).toContain('0');
    // …so the guard, not the builder, is what must hold. Asserted below.
  });
});

describe('the pinned fallback', () => {
  it('is a strict, in-scope, duplicate-free subset', () => {
    const inScope = new Set<string>(COUNTRIES.map((c) => c.code));
    for (const code of FALLBACK_LIVE_COUNTRY_CODES) expect(inScope.has(code)).toBe(true);
    expect(new Set(FALLBACK_LIVE_COUNTRY_CODES).size).toBe(FALLBACK_LIVE_COUNTRY_CODES.length);
    expect(FALLBACK_LIVE_COUNTRY_CODES.length).toBeLessThan(COUNTRY_SCOPE_TOTAL);
  });

  it('is not empty — an empty fallback would defeat its own purpose', () => {
    // The fallback exists so a failed read never renders "live in 0". An empty
    // array would render exactly that, silently, only when the cluster is down.
    expect(FALLBACK_LIVE_COUNTRY_CODES.length).toBeGreaterThan(0);
  });
});

describe('the failed-read guard actually collapses onto the fallback', () => {
  it('never yields a zero count when the live read returns nothing', async () => {
    // The single most important behaviour in this change, exercised rather than
    // trusted: with the corpus read stubbed empty, the action must still return
    // the fallback set and a non-zero count.
    const { vi } = await import('vitest');
    vi.resetModules();
    vi.doMock('@/lib/mongodb/coverage', () => ({ getLiveCountries: async () => [] }));
    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
    }));

    const { getLiveCoverageAction } = await import('@/lib/actions/coverage');
    const coverage = await getLiveCoverageAction();

    expect(coverage.count).toBe(FALLBACK_LIVE_COUNTRY_CODES.length);
    expect(coverage.count).toBeGreaterThan(0);
    expect(coverage.stale).toBe(true);
    expect(coverage.claim).not.toContain('live in 0');
    expect(coverage.fragment).not.toContain('live in 0');

    vi.doUnmock('@/lib/mongodb/coverage');
    vi.doUnmock('next/cache');
    vi.resetModules();
  });

  it('reports the live set, not the fallback, when the read succeeds', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    vi.doMock('@/lib/mongodb/coverage', () => ({
      getLiveCountries: async () => [
        { code: 'NG', recent: 11019 },
        { code: 'ZA', recent: 5663 },
        { code: 'ZW', recent: 3520 },
      ],
    }));
    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
    }));

    const { getLiveCoverageAction } = await import('@/lib/actions/coverage');
    const coverage = await getLiveCoverageAction();

    expect(coverage.count).toBe(3);
    expect(coverage.codes).toEqual(['NG', 'ZA', 'ZW']);
    expect(coverage.stale).toBe(false);
    expect(coverage.fragment).toContain('live in 3 African countries');

    vi.doUnmock('@/lib/mongodb/coverage');
    vi.doUnmock('next/cache');
    vi.resetModules();
  });
});

describe('no surface hard-codes a country count', () => {
  /**
   * The invariant that survives the count becoming live.
   *
   * A literal digit next to "countries" anywhere in the app is the exact
   * failure this whole mechanism replaced — nine surfaces each writing their
   * own number. It was true when the number was a constant and it is *more*
   * important now: a hardcoded literal cannot follow a live figure, so it goes
   * stale the first time the corpus moves, and nothing would report it.
   */
  const HARDCODED = /\b\d+\s+(?:other\s+|more\s+|supported\s+|live\s+)?(?:African\s+)?countries\b/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__' && entry !== 'node_modules') walk(full, out);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  it('src/app and src/components interpolate the count instead of writing it', () => {
    const offenders = [join(process.cwd(), 'src/app'), join(process.cwd(), 'src/components')]
      .flatMap((dir) => walk(dir))
      .filter((file) => {
        // Strip comments: several of these files now explain the "16" they used
        // to hardcode, and failing on that note would teach the next person to
        // delete the explanation rather than the literal.
        const source = readFileSync(file, 'utf-8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        return HARDCODED.test(source);
      });
    expect(offenders).toEqual([]);
  });
});

describe('the crawler-facing documents are generated, not static', () => {
  /**
   * These four used to live under `public/` with the number written into them.
   * They are the surfaces an answer engine reads and caches, so a stale figure
   * there outlives every correction made in the app.
   *
   * A file left behind in `public/` would SHADOW the route and win silently —
   * no error, no failed build, just a crawler served a number from months ago.
   * That is what these assertions are for.
   */
  const MOVED: Array<[string, string]> = [
    ['public/robots.txt', 'src/app/robots.txt/route.ts'],
    ['public/llms.txt', 'src/app/llms.txt/route.ts'],
    ['public/manifest.json', 'src/app/manifest.ts'],
    [
      'public/.well-known/mcp/server-card.json',
      'src/app/.well-known/mcp/server-card.json/route.ts',
    ],
  ];

  it.each(MOVED)('%s is gone and cannot shadow its route', (stale) => {
    expect(existsSync(join(process.cwd(), stale))).toBe(false);
  });

  it.each(MOVED)('%s → the route that replaced it exists', (_stale, route) => {
    expect(existsSync(join(process.cwd(), route))).toBe(true);
  });

  it.each(MOVED)('%s → its replacement resolves the claim at request time', (_stale, route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf-8');
    expect(source).toContain('getLiveCoverageAction');
    // And states it through the sanctioned builder rather than its own prose.
    expect(source).toMatch(/\$\{claim\}|coverage\.claim/);
  });

  it.each(MOVED)('%s → its replacement writes no number of its own', (_stale, route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(source).not.toMatch(/\b\d+\s+African countries\b/);
  });
});
