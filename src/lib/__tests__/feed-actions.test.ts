import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSectionedFeedAction,
  getArticlesAction,
  getArticleAction,
  getNewsBytesAction,
  searchArticlesAction,
  getTrendingCategoriesAction,
  getTrendingAuthorsAction,
  getSavedArticlesAction,
} from '../actions/feed';
import {
  getArticles,
  getArticleById,
  getNewsByteArticles,
  searchArticles,
  getSavedArticles,
} from '../mongodb/articles';
import { getTrendingCategories } from '../mongodb/categories';
import { getTrendingAuthors } from '../mongodb/sources';

// Server Actions are a public RPC surface — these tests assert that
// malicious/buggy arguments are validated and clamped BEFORE they reach the
// MongoDB layer, without changing the actions' return shapes.

vi.mock('../mongodb/articles', () => ({
  getArticles: vi.fn().mockResolvedValue({ articles: [], total: 0 }),
  getArticleById: vi.fn().mockResolvedValue(null),
  getNewsByteArticles: vi.fn().mockResolvedValue([]),
  searchArticles: vi.fn().mockResolvedValue([]),
  getSavedArticles: vi.fn().mockResolvedValue({ articles: [] }),
}));

vi.mock('../mongodb/categories', () => ({
  getCategories: vi.fn().mockResolvedValue([]),
  getTrendingCategories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../mongodb/sources', () => ({
  getSources: vi.fn().mockResolvedValue([]),
  getStats: vi
    .fn()
    .mockResolvedValue({
      database: { total_articles: 0, active_sources: 0, categories: 0, today_articles: 0 },
    }),
  getTrendingAuthors: vi.fn().mockResolvedValue({ trending_authors: [] }),
}));

const mockCookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockCookieGet })),
}));

// The engagement subject module pulls in authkit (unresolvable in jsdom) — mock
// it as anonymous by default; individual tests flip it to a signed-in user.
const mockResolveSubject = vi.fn();
const mockClaim = vi.fn();
vi.mock('../engagement', () => ({
  resolveEngagementSubject: (cookie: string | undefined) => mockResolveSubject(cookie),
  claimSessionEngagement: (...args: unknown[]) => mockClaim(...args),
}));

vi.mock('../mongodb/client', () => ({
  getDb: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCookieGet.mockReturnValue(undefined);
  mockResolveSubject.mockImplementation(async (cookie: string | undefined) => ({
    key: cookie ?? null,
    isUser: false,
  }));
  mockClaim.mockResolvedValue(undefined);
});

describe('getArticlesAction input validation', () => {
  it('passes through valid params', async () => {
    await getArticlesAction({ limit: 30, page: 2, countries: ['ZW'], sort: 'popular' });
    expect(getArticles).toHaveBeenCalledWith({
      limit: 30,
      page: 2,
      category: undefined,
      categories: undefined,
      countries: ['ZW'],
      sort: 'popular',
    });
  });

  it('clamps an out-of-range limit to 100', async () => {
    await getArticlesAction({ limit: 999999 });
    expect(getArticles).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it('clamps a negative limit up to 1 and a bad page to 1', async () => {
    await getArticlesAction({ limit: -50, page: -3 });
    expect(getArticles).toHaveBeenCalledWith(expect.objectContaining({ limit: 1, page: 1 }));
  });

  it('falls back to defaults for non-numeric limit/page', async () => {
    await getArticlesAction({
      limit: 'huge' as unknown as number,
      page: {} as unknown as number,
    });
    expect(getArticles).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, page: 1 }));
  });

  it('drops invalid country codes and normalises valid ones', async () => {
    await getArticlesAction({ countries: ['zw', '$where', 'KEnya'] as string[] });
    expect(getArticles).toHaveBeenCalledWith(expect.objectContaining({ countries: ['ZW'] }));
  });

  it('drops an invalid category filter instead of throwing', async () => {
    await getArticlesAction({ category: '{"$gt": ""}' });
    expect(getArticles).toHaveBeenCalledWith(expect.objectContaining({ category: undefined }));
  });

  it('rejects an unknown sort value', async () => {
    await getArticlesAction({ sort: '$natural' as unknown as 'latest' });
    expect(getArticles).toHaveBeenCalledWith(expect.objectContaining({ sort: 'latest' }));
  });

  it('keeps the documented return shape', async () => {
    const result = await getArticlesAction({ limit: 5000 });
    expect(result).toEqual({ articles: [], total: 0 });
  });
});

describe('getSectionedFeedAction input validation', () => {
  it('drops invalid countries/categories but still returns the SectionedFeed shape', async () => {
    const feed = await getSectionedFeedAction({
      countries: ['not-a-code'],
      categories: ['DROP TABLE'],
    });
    // Invalid filters degrade to unfiltered, bounded queries
    expect(getArticles).toHaveBeenCalledWith({ limit: 5, sort: 'popular', countries: undefined });
    expect(getArticles).toHaveBeenCalledWith({ limit: 20, sort: 'latest', countries: undefined });
    expect(feed).toMatchObject({
      topStories: [],
      yourNews: [],
      byCategory: [],
      latest: [],
      countries: [],
    });
    expect(typeof feed.timestamp).toBe('string');
  });

  it('normalises valid filters and queries the category feed', async () => {
    await getSectionedFeedAction({ countries: ['zw'], categories: ['Business'] });
    expect(getArticles).toHaveBeenCalledWith({
      limit: 10,
      countries: ['ZW'],
      categories: ['business'],
      sort: 'latest',
    });
  });

  it('caps oversized filter lists at 20 entries', async () => {
    const countries = Array.from({ length: 500 }, () => 'ZW');
    await getSectionedFeedAction({ countries });
    expect(getArticles).toHaveBeenCalledWith(
      expect.objectContaining({ countries: expect.any(Array) })
    );
    const passed = vi.mocked(getArticles).mock.calls[0][0] as { countries: string[] };
    expect(passed.countries).toHaveLength(20);
  });
});

describe('getArticleAction input validation', () => {
  it('fetches with a valid id', async () => {
    await getArticleAction('article_123');
    expect(getArticleById).toHaveBeenCalledWith('article_123');
  });

  it('returns null for an over-length id without touching the DB', async () => {
    const result = await getArticleAction('a'.repeat(500));
    expect(result).toBeNull();
    expect(getArticleById).not.toHaveBeenCalled();
  });

  it('returns null for empty / non-string ids without touching the DB', async () => {
    expect(await getArticleAction('')).toBeNull();
    expect(await getArticleAction(42 as unknown as string)).toBeNull();
    expect(getArticleById).not.toHaveBeenCalled();
  });
});

describe('getNewsBytesAction input validation', () => {
  it('clamps huge limits to 100', async () => {
    await getNewsBytesAction(10_000);
    expect(getNewsByteArticles).toHaveBeenCalledWith(100);
  });

  it('defaults non-numeric limits to 20', async () => {
    await getNewsBytesAction('lots' as unknown as number);
    expect(getNewsByteArticles).toHaveBeenCalledWith(20);
  });
});

describe('searchArticlesAction input validation', () => {
  it('trims the query and clamps the limit', async () => {
    await searchArticlesAction('  harare  ', 5000);
    expect(searchArticles).toHaveBeenCalledWith('harare', 100, {
      category: undefined,
      countryCode: undefined,
    });
  });

  it('returns [] for an empty/whitespace query without querying', async () => {
    expect(await searchArticlesAction('   ')).toEqual([]);
    expect(await searchArticlesAction('')).toEqual([]);
    expect(searchArticles).not.toHaveBeenCalled();
  });

  it('returns [] for an over-length query without querying', async () => {
    expect(await searchArticlesAction('a'.repeat(1000))).toEqual([]);
    expect(searchArticles).not.toHaveBeenCalled();
  });

  it('drops an invalid country filter and normalises a valid one', async () => {
    await searchArticlesAction('news', 10, { countryCode: 'zw' });
    expect(searchArticles).toHaveBeenCalledWith(
      'news',
      10,
      expect.objectContaining({ countryCode: 'ZW' })
    );

    await searchArticlesAction('news', 10, { countryCode: '$injected' });
    expect(searchArticles).toHaveBeenLastCalledWith(
      'news',
      10,
      expect.objectContaining({ countryCode: undefined })
    );
  });
});

describe('trending actions input validation', () => {
  it('clamps trending categories limit', async () => {
    await getTrendingCategoriesAction(99999);
    expect(getTrendingCategories).toHaveBeenCalledWith(100);
  });

  it('defaults trending categories limit when non-numeric', async () => {
    await getTrendingCategoriesAction(NaN);
    expect(getTrendingCategories).toHaveBeenCalledWith(8);
  });

  it('clamps trending authors limit', async () => {
    await getTrendingAuthorsAction(-10);
    expect(getTrendingAuthors).toHaveBeenCalledWith(1);
  });
});

describe('getSavedArticlesAction input validation', () => {
  it('returns empty when there is no session cookie', async () => {
    const result = await getSavedArticlesAction();
    expect(result).toEqual({ articles: [] });
    expect(getSavedArticles).not.toHaveBeenCalled();
  });

  it('rejects an absurd session id without touching the DB', async () => {
    mockCookieGet.mockReturnValue({ value: 'x'.repeat(4096) });
    const result = await getSavedArticlesAction();
    expect(result).toEqual({ articles: [] });
    expect(getSavedArticles).not.toHaveBeenCalled();
  });

  it('passes through a sane session id', async () => {
    mockCookieGet.mockReturnValue({ value: 'session-abc-123' });
    await getSavedArticlesAction();
    expect(getSavedArticles).toHaveBeenCalledWith('session-abc-123');
  });

  it('reads by the stable user key when signed in and claims cookie history', async () => {
    mockCookieGet.mockReturnValue({ value: 'session-abc-123' });
    mockResolveSubject.mockResolvedValue({ key: 'user:user_123', isUser: true });
    await getSavedArticlesAction();
    expect(mockClaim).toHaveBeenCalledWith(expect.anything(), 'session-abc-123', 'user:user_123');
    expect(getSavedArticles).toHaveBeenCalledWith('user:user_123');
  });

  it('reads by the user key with no claim when signed in without a cookie', async () => {
    mockResolveSubject.mockResolvedValue({ key: 'user:user_123', isUser: true });
    await getSavedArticlesAction();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(getSavedArticles).toHaveBeenCalledWith('user:user_123');
  });
});
