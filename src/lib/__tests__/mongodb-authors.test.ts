import { describe, it, expect, vi, beforeEach } from 'vitest';

import { collectionStub, dbStub, type CollectionStub } from './helpers/mongo';

const { mockGetDb, mockGetArticlesByIds } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockGetArticlesByIds: vi.fn(async () => []),
}));

vi.mock('@/lib/mongodb/client', () => ({
  getDb: mockGetDb,
  QUERY_MAX_TIME_MS: 5000,
}));
vi.mock('@/lib/mongodb/articles', () => ({ getArticlesByIds: mockGetArticlesByIds }));

import {
  AUTHOR_WINDOW_DAYS,
  getAuthorProfile,
  getBylineDirectory,
} from '@/lib/mongodb/authors';

/**
 * Mocked at the driver seam so these assert on the PIPELINE that was issued.
 *
 * That matters more here than usual. `news.articles` carries no index on
 * `author.name` (measured 2026-09-10), so the shape of the match is the whole
 * cost of the page: a windowed equality match rides
 * `status_1_datePublished_-1` as a range seek, and a regex or an unwindowed
 * match is a full scan of a 1.5 GB collection on every render. Neither shows up
 * in the returned value.
 */
describe('getBylineDirectory', () => {
  let articles: CollectionStub;

  function stub(rows: unknown[]) {
    articles = collectionStub({ aggregate: [rows] });
    mockGetDb.mockResolvedValue(dbStub({ articles }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups on author.name, never on the author sub-document', () => {
    // `author` is a Schema.org object. Grouping on `$author` groups by the whole
    // object and renders every row as "[object Object]" — a bug already on
    // record in `getTrendingAuthors`, which this read must not repeat.
    stub([]);
    return getBylineDirectory().then(() => {
      const { pipeline } = articles.aggregateCalls[0];
      const group = pipeline.find((s) => '$group' in (s as object)) as {
        $group: { _id: unknown };
      };
      expect(group.$group._id).toBe('$author.name');
    });
  });

  it('windows the read on the documented number of days', async () => {
    stub([]);
    const before = Date.now();
    await getBylineDirectory();

    const match = articles.aggregateCalls[0].pipeline[0] as {
      $match: { datePublished: { $gte: Date } };
    };
    const days = (before - match.$match.datePublished.$gte.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(AUTHOR_WINDOW_DAYS, 1);
  });

  it('excludes rejected and removed articles', async () => {
    stub([]);
    await getBylineDirectory();
    const first = JSON.stringify(articles.aggregateCalls[0].pipeline[0]);
    expect(first).toContain('rejected');
    expect(first).toContain('removed');
  });

  it('folds spellings of one byline onto a single page', async () => {
    // 188 of 3,600 folded keys carry more than one raw spelling on the live
    // corpus. Left unfolded they are separate pages, each showing a fraction of
    // the journalist's work and neither saying so.
    stub([
      { _id: 'Abubakar Ibrahim', articles: 300, newsroomIds: ['org-joy'] },
      { _id: 'abubakar ibrahim', articles: 23, newsroomIds: ['org-bd', null] },
    ]);

    const [entry] = await getBylineDirectory();
    expect(entry.slug).toBe('abubakar-ibrahim');
    expect(entry.articles).toBe(323);
    expect(entry.variants).toEqual(['Abubakar Ibrahim', 'abubakar ibrahim']);
    // Both newsrooms, and the unresolved one dropped rather than counted as a
    // newsroom called "null".
    expect(entry.newsroomIds).toEqual(['org-joy', 'org-bd']);
  });

  it('names the byline by its most-published spelling', async () => {
    stub([
      { _id: 'MARY MOYO', articles: 90, newsroomIds: [] },
      { _id: 'Mary Moyo', articles: 4, newsroomIds: [] },
    ]);
    expect((await getBylineDirectory())[0].name).toBe('MARY MOYO');
  });

  it('marks a desk byline as a desk', async () => {
    stub([
      { _id: 'Staff Reporter', articles: 198, newsroomIds: ['a', 'b'] },
      { _id: 'Abubakar Ibrahim', articles: 323, newsroomIds: ['c'] },
    ]);
    const entries = await getBylineDirectory();
    expect(entries.find((e) => e.slug === 'staff-reporter')?.desk).toBe(true);
    expect(entries.find((e) => e.slug === 'abubakar-ibrahim')?.desk).toBe(false);
  });

  it('drops a byline that folds to no address at all', async () => {
    // Bucketing these under an empty slug would merge unrelated bylines into one
    // page reachable at `/author/`.
    stub([{ _id: '---', articles: 5, newsroomIds: [] }]);
    await expect(getBylineDirectory()).resolves.toEqual([]);
  });

  it('returns empty rather than throwing when the read fails', async () => {
    mockGetDb.mockRejectedValue(new Error('mongo down'));
    await expect(getBylineDirectory()).resolves.toEqual([]);
  });
});

describe('getAuthorProfile', () => {
  let articles: CollectionStub;

  function stub(rows: unknown[]) {
    articles = collectionStub({ aggregate: [rows] });
    mockGetDb.mockResolvedValue(dbStub({ articles }));
  }

  const FACETS = [
    {
      totals: [{ total: 323, first: new Date('2026-06-20'), last: new Date('2026-09-08') }],
      sources: [{ _id: 'src-joy-news', count: 313 }],
      newsrooms: [{ _id: 'org-joy', count: 313 }],
      countries: [{ _id: 'GH', count: 313 }],
      topics: [],
      categories: [{ _id: 'international', count: 152 }],
      tags: [{ _id: 'World Cup', count: 47 }],
      recent: [{ _id: 'a1' }, { _id: 'a2' }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetArticlesByIds.mockResolvedValue([]);
  });

  it('answers every panel from ONE pass over the corpus', async () => {
    // The `$match` has no index behind it, so it is the entire cost. Seven
    // queries would be seven scans for one page.
    stub(FACETS);
    await getAuthorProfile({ variants: ['Abubakar Ibrahim'] });
    expect(articles.aggregateCalls).toHaveLength(1);
  });

  it('matches the byline by equality, never by regex', async () => {
    // An equality match can be served by an index if one is ever added to
    // `author.name`; a regex can not. Given the collection is 1.5 GB, that is
    // the difference between a page that can be made fast and one that cannot.
    stub(FACETS);
    await getAuthorProfile({ variants: ['Abubakar Ibrahim', 'abubakar ibrahim'] });

    const { $match } = articles.aggregateCalls[0].pipeline[0] as {
      $match: Record<string, unknown>;
    };
    expect($match['author.name']).toEqual({
      $in: ['Abubakar Ibrahim', 'abubakar ibrahim'],
    });
    expect(JSON.stringify($match)).not.toContain('$regex');
  });

  it('scopes to the given newsrooms — this is what makes a desk page truthful', async () => {
    // "Staff Reporter" is 198 articles across ten mastheads in four countries.
    // Without this clause the desk page asserts one journalist wrote them all.
    stub(FACETS);
    await getAuthorProfile({ variants: ['Staff Reporter'], newsroomIds: ['org-herald'] });

    const { $match } = articles.aggregateCalls[0].pipeline[0] as {
      $match: Record<string, unknown>;
    };
    expect($match.mediaOrganizationId).toEqual({ $in: ['org-herald'] });
  });

  it('does not scope a byline that was not given a newsroom', async () => {
    stub(FACETS);
    await getAuthorProfile({ variants: ['Abubakar Ibrahim'] });
    const { $match } = articles.aggregateCalls[0].pipeline[0] as {
      $match: Record<string, unknown>;
    };
    expect($match.mediaOrganizationId).toBeUndefined();
  });

  it('reads tags stored as slugs AND as objects', async () => {
    // The corpus holds both: current enrichment writes plain slugs, older
    // articles carry `{slug, name}`. Reading one shape reports a long-serving
    // byline as covering nothing.
    stub(FACETS);
    await getAuthorProfile({ variants: ['x'] });

    const facet = (
      articles.aggregateCalls[0].pipeline[1] as { $facet: Record<string, unknown[]> }
    ).$facet;
    expect(JSON.stringify(facet.tags)).toContain('$engagement.tags.slug');
    expect(JSON.stringify(facet.tags)).toContain('$cond');
  });

  it('carries the totals, breakdowns and hydrated articles through', async () => {
    stub(FACETS);
    mockGetArticlesByIds.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }] as never);

    const profile = await getAuthorProfile({ variants: ['Abubakar Ibrahim'] });
    expect(profile.total).toBe(323);
    expect(profile.firstPublished).toBe('2026-06-20T00:00:00.000Z');
    expect(profile.sources).toEqual([{ key: 'src-joy-news', count: 313 }]);
    expect(profile.categories).toEqual([{ key: 'international', count: 152 }]);
    expect(profile.tags).toEqual([{ key: 'World Cup', count: 47 }]);
    expect(profile.articles).toHaveLength(2);
    // Hydrated in the ranked order the facet returned, not re-sorted by Mongo.
    expect(mockGetArticlesByIds).toHaveBeenCalledWith(['a1', 'a2']);
  });

  it('does not query at all for an empty byline', async () => {
    stub(FACETS);
    const profile = await getAuthorProfile({ variants: ['', '   '] });
    expect(articles.aggregateCalls).toHaveLength(0);
    expect(profile.total).toBe(0);
  });

  it('returns an empty profile rather than throwing when the read fails', async () => {
    mockGetDb.mockRejectedValue(new Error('mongo down'));
    const profile = await getAuthorProfile({ variants: ['Abubakar Ibrahim'] });
    expect(profile.total).toBe(0);
    expect(profile.articles).toEqual([]);
  });
});
