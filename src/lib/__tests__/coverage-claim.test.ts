import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  COUNTRIES,
  RELEASED_COUNTRY_CODES,
  RELEASED_COUNTRY_COUNT,
  COUNTRY_SCOPE_TOTAL,
  COVERAGE_CLAIM,
  COVERAGE_FRAGMENT,
  isReleasedCountry,
} from '../constants';

/**
 * The public coverage claim, pinned.
 *
 * Three numbers used to disagree on the same site: `COUNTRIES` and the sitemap
 * said 54, nine hand-written strings said 16 ("16 African countries", "15 other
 * African countries", "12 more countries"), and the measured source coverage was
 * a third number. An answer engine repeats whichever it reads first, so the
 * claim is now derived from one place — and this file is what stops it drifting
 * back to nine.
 *
 * These assertions are deliberately about the CLAIM, not about the data. If the
 * released set genuinely changes, re-measure it (the query is documented on
 * `RELEASED_COUNTRY_CODES`) and update both the list and the numbers here. That
 * is the intended failure of this test, not a reason to loosen it.
 */
describe('coverage claim: 54 in scope, 16 released', () => {
  it('scope is all 54 African Union member states', () => {
    expect(COUNTRY_SCOPE_TOTAL).toBe(54);
    expect(COUNTRIES).toHaveLength(54);
  });

  it('16 of them are released', () => {
    expect(RELEASED_COUNTRY_COUNT).toBe(16);
    expect(RELEASED_COUNTRY_CODES).toHaveLength(16);
  });

  it('every released country is in scope, and none is listed twice', () => {
    const inScope = new Set<string>(COUNTRIES.map((c) => c.code));
    for (const code of RELEASED_COUNTRY_CODES) expect(inScope.has(code)).toBe(true);
    expect(new Set(RELEASED_COUNTRY_CODES).size).toBe(RELEASED_COUNTRY_CODES.length);
  });

  it('released is a strict subset — the rest are coming soon, not live', () => {
    expect(RELEASED_COUNTRY_COUNT).toBeLessThan(COUNTRY_SCOPE_TOTAL);
    expect(isReleasedCountry('ZW')).toBe(true);
    expect(isReleasedCountry('SS')).toBe(false); // in scope, no sources yet
    expect(isReleasedCountry(undefined)).toBe(false);
    expect(isReleasedCountry('')).toBe(false);
  });

  it('the sanctioned copy states both numbers and says the rest are coming', () => {
    expect(COVERAGE_CLAIM).toContain('16');
    expect(COVERAGE_CLAIM).toContain('54');
    expect(COVERAGE_CLAIM.toLowerCase()).toContain('coming soon');
    expect(COVERAGE_FRAGMENT).toContain('16');
    expect(COVERAGE_FRAGMENT).toContain('54');
  });
});

describe('coverage claim: the static files that cannot import the constant', () => {
  const STATIC_SURFACES = [
    'public/llms.txt',
    'public/robots.txt',
    'public/manifest.json',
    'public/.well-known/mcp/server-card.json',
  ];

  it.each(STATIC_SURFACES)('%s states both the released count and the scope', (file) => {
    const raw = readFileSync(join(process.cwd(), file), 'utf-8');
    expect(raw).toMatch(/16 African countries|live in 16/i);
    expect(raw).toContain('54');
  });

  it.each(STATIC_SURFACES)('%s carries none of the superseded claims', (file) => {
    const raw = readFileSync(join(process.cwd(), file), 'utf-8');
    expect(raw).not.toMatch(/15 other African countries/i);
    expect(raw).not.toMatch(/12 more/i);
  });
});

describe('coverage claim: no page hard-codes a country count', () => {
  /**
   * Every count in user-facing copy must be interpolated from the constants, so
   * one edit moves every surface. A literal digit next to "countries" in a page
   * or component is the exact failure mode this replaced.
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
      .filter((file) => HARDCODED.test(readFileSync(file, 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
