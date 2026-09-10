import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COUNTRIES } from '@/lib/constants';

const { mockGetArticles, mockCoverage } = vi.hoisted(() => ({
  mockGetArticles: vi.fn(),
  mockCoverage: vi.fn(),
}));

vi.mock('@/lib/mongodb/articles', () => ({ getArticles: mockGetArticles }));
vi.mock('@/lib/actions/coverage', () => ({ getLiveCoverageAction: mockCoverage }));

/**
 * A live set that is deliberately NOT the production sixteen.
 *
 * The sitemap now submits whatever the corpus says is live, so a fixture that
 * happened to equal the real figure could pass while the sitemap ignored the
 * read entirely and kept using a stale constant. Three arbitrary codes make
 * that impossible to miss.
 */
const LIVE = ['NG', 'ZA', 'ZW'] as const;

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
    mockCoverage.mockResolvedValue({
      codes: LIVE,
      count: LIVE.length,
      scopeTotal: COUNTRIES.length,
      fragment: '',
      claim: '',
      stale: false,
    });
  });

  async function countryUrls() {
    const sitemap = (await import('../sitemap')).default;
    const entries = await sitemap();
    return entries
      .map((e) => e.url)
      .filter((url) => url.includes('/discover?country='))
      .map((url) => url.split('country=')[1]);
  }

  it('submits exactly the countries the corpus reports as live', async () => {
    const codes = await countryUrls();
    expect(codes).toHaveLength(LIVE.length);
    expect(new Set(codes)).toEqual(new Set(LIVE));
  });

  it('submits no country that is only in scope', async () => {
    const codes = await countryUrls();
    const notLive = COUNTRIES.filter((c) => !LIVE.includes(c.code as never)).map((c) => c.code);
    expect(notLive.length).toBeGreaterThan(0);
    for (const code of notLive) expect(codes).not.toContain(code);
  });

  it('follows the live set when it changes, with no code edit', async () => {
    // The whole point of the change: a country that starts producing is
    // submitted on the next revalidation rather than waiting for a constant to
    // be edited. Nothing here but the read's answer is different.
    mockCoverage.mockResolvedValue({
      codes: [...LIVE, 'KE', 'GH'],
      count: LIVE.length + 2,
      scopeTotal: COUNTRIES.length,
      fragment: '',
      claim: '',
      stale: false,
    });
    const codes = await countryUrls();
    expect(codes).toHaveLength(LIVE.length + 2);
    expect(codes).toContain('KE');
    expect(codes).toContain('GH');
  });

  it('still degrades to a sitemap when the article read fails', async () => {
    mockGetArticles.mockRejectedValue(new Error('mongo down'));
    const codes = await countryUrls();
    expect(codes).toHaveLength(LIVE.length);
  });
});
