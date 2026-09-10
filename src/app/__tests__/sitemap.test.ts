import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  COUNTRIES,
  RELEASED_COUNTRY_CODES,
  RELEASED_COUNTRY_COUNT,
  isReleasedCountry,
} from '@/lib/constants';

const { mockGetArticles } = vi.hoisted(() => ({ mockGetArticles: vi.fn() }));

vi.mock('@/lib/mongodb/articles', () => ({ getArticles: mockGetArticles }));

/**
 * The sitemap is a set of claims about what exists. It used to submit a
 * `?country=` URL for all 54 African Union member states, but only 16 have
 * sources behind them — the other 38 rendered "0 articles found", which is the
 * soft-404 shape: a thin page offered to a crawler as real content.
 */
describe('sitemap country URLs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetArticles.mockResolvedValue({ articles: [], total: 0 });
  });

  async function countryUrls() {
    const sitemap = (await import('../sitemap')).default;
    const entries = await sitemap();
    return entries
      .map((e) => e.url)
      .filter((url) => url.includes('/discover?country='))
      .map((url) => url.split('country=')[1]);
  }

  it('submits exactly the released countries', async () => {
    const codes = await countryUrls();
    expect(codes).toHaveLength(RELEASED_COUNTRY_COUNT);
    expect(new Set(codes)).toEqual(new Set(RELEASED_COUNTRY_CODES));
  });

  it('submits no country that is only in scope', async () => {
    const codes = await countryUrls();
    const unreleased = COUNTRIES.filter((c) => !isReleasedCountry(c.code)).map((c) => c.code);
    expect(unreleased.length).toBeGreaterThan(0);
    for (const code of unreleased) expect(codes).not.toContain(code);
  });

  it('still degrades to a sitemap when the article read fails', async () => {
    mockGetArticles.mockRejectedValue(new Error('mongo down'));
    const codes = await countryUrls();
    expect(codes).toHaveLength(RELEASED_COUNTRY_COUNT);
  });
});
