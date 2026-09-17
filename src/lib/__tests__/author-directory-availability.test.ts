import { describe, it, expect, vi, beforeEach } from 'vitest';

import { collectionStub, dbStub, type CollectionStub } from './helpers/mongo';

/**
 * The byline-page outage, end to end, with nothing between the driver and the
 * page result mocked away.
 *
 * ## What happened
 *
 * `getBylineDirectory` runs a `$group` on `$author.name` over the attributed
 * corpus. `news.articles` carries eleven classic indexes and NOT ONE touches
 * `author`; neither Atlas Search index maps it either. Measured 2026-09-17 on a
 * direct connection the `$group` did not return within 60 seconds, so
 * `QUERY_MAX_TIME_MS` (15s) aborted it on every render.
 *
 * Every layer below it was individually reasonable and the composition was a
 * lie:
 *
 * ```
 *   reader times out    → catch → []                  "fail-soft"
 *   action .find(slug)  → undefined                   "no such byline"
 *   page                → notFound()                  "Byline not found"
 *   unstable_cache      → memoises the [] for an HOUR  one timeout, 60 min blind
 * ```
 *
 * The platform was telling readers — and crawlers — that named journalists with
 * hundreds of published articles do not exist, on the strength of a slow query.
 * That is the failure mode this codebase's doctrine forbids everywhere else:
 * the `/insights` "No data available yet" incident, and the `CorpusSummary.ok`
 * flag that answered it.
 *
 * These tests drive a REJECTING DRIVER through the real reader, the real
 * caching layer and the real action, and assert on what comes out the far end.
 * Mocking `@/lib/mongodb/authors` — as the sibling routing suite does, rightly,
 * for its own purposes — cannot see this bug, because the bug is in how the
 * layers compose.
 */

const { mockGetDb, mockOrgMap, mockSources, mockGetArticlesByIds } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockOrgMap: vi.fn(),
  mockSources: vi.fn(),
  mockGetArticlesByIds: vi.fn(async () => []),
}));

vi.mock('@/lib/mongodb/client', () => ({ getDb: mockGetDb, QUERY_MAX_TIME_MS: 15000 }));
vi.mock('@/lib/mongodb/articles', () => ({ getArticlesByIds: mockGetArticlesByIds }));
vi.mock('@/lib/mongodb/organizations', () => ({ getPublisherOrganizationMap: mockOrgMap }));
vi.mock('@/lib/mongodb/sources', () => ({ getSources: mockSources }));

/**
 * A stand-in for `unstable_cache` that keeps the one property this defect turns
 * on: it memoises a RESOLVED value and stores NOTHING for a rejection.
 *
 * That is why the production wrapper rejects instead of returning the failed
 * read's empty list. Returning it would pin "this platform has no bylines" in
 * front of every author page for the full hour, so a single 15-second timeout
 * became a one-hour outage. An identity stub cannot tell the two apart.
 */
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => Promise<unknown>) => {
    let cached: Promise<unknown> | null = null;
    return async (...args: unknown[]) => {
      if (cached) return cached;
      const pending = fn(...args);
      cached = pending;
      try {
        return await pending;
      } catch (error) {
        cached = null;
        throw error;
      }
    };
  },
}));

const TIMEOUT = new Error(
  'PlanExecutor error during aggregation :: caused by :: operation exceeded time limit'
);

const BYLINE_ROWS = [{ _id: 'Abubakar Ibrahim', articles: 323, newsroomIds: ['org-joy'] }];

const FACET = [
  {
    totals: [{ total: 323, first: new Date('2026-06-20'), last: new Date('2026-09-08') }],
    sources: [{ _id: 'src-joy-news', count: 313 }],
    newsrooms: [{ _id: 'org-joy', count: 313 }],
    countries: [{ _id: 'GH', count: 313 }],
    topics: [],
    categories: [],
    tags: [],
    recent: [],
  },
];

/**
 * A fresh module graph per test — the cache stub above holds state, and so does
 * the real `unstable_cache` this stands in for.
 */
async function loadAction() {
  vi.resetModules();
  return (await import('@/lib/actions/authors')).getAuthorPageAction;
}

function withArticles(spec: Parameters<typeof collectionStub>[0]): CollectionStub {
  const articles = collectionStub(spec);
  mockGetDb.mockResolvedValue(dbStub({ articles }));
  return articles;
}

describe('a byline page over an unreachable corpus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgMap.mockResolvedValue(new Map([['org-joy', { id: 'org-joy', name: 'Joy News' }]]));
    mockSources.mockResolvedValue([{ id: 'src-joy-news', name: 'Joy News' }]);
    mockGetArticlesByIds.mockResolvedValue([]);
  });

  it('says UNAVAILABLE, not not-found, when the directory read times out', async () => {
    // THE regression. `not-found` is a claim about a journalist; we have not
    // earned it, because we never managed to look.
    withArticles({ aggregate: [TIMEOUT] });
    const getAuthorPageAction = await loadAction();

    const result = await getAuthorPageAction('abubakar-ibrahim');
    expect(result.status).toBe('unavailable');
    expect(result.status).not.toBe('not-found');
  });

  it('says unavailable when the cluster cannot be reached at all', async () => {
    mockGetDb.mockRejectedValue(new Error('server selection timed out'));
    const getAuthorPageAction = await loadAction();

    await expect(getAuthorPageAction('abubakar-ibrahim')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('never renders a failed read as a byline with no articles', async () => {
    // The shape the page must never be handed: a resolvable identity whose
    // profile is an empty-but-confident zero. If a future edit reintroduces
    // `ok`-less fail-soft, this is where it lands.
    withArticles({ aggregate: [TIMEOUT] });
    const getAuthorPageAction = await loadAction();

    const result = await getAuthorPageAction('abubakar-ibrahim');
    expect(result).not.toMatchObject({ status: 'ok' });
    if (result.status === 'ok') {
      // Unreachable while the assertion above holds; here so that the day it
      // does render a page, the page cannot be claiming zero articles.
      expect(result.page.profile.ok).toBe(true);
    }
  });

  it('does not cache a failed directory read over the next hour', async () => {
    // The amplification: `unstable_cache` memoises a resolved value for the full
    // TTL. A failed read that RETURNS an empty list is therefore served to every
    // author page for an hour; one that REJECTS is confined to the request that
    // hit it. Second call re-queries, and recovers.
    const articles = withArticles({ aggregate: [TIMEOUT, BYLINE_ROWS, FACET] });
    const getAuthorPageAction = await loadAction();

    await expect(getAuthorPageAction('abubakar-ibrahim')).resolves.toEqual({
      status: 'unavailable',
    });

    const second = await getAuthorPageAction('abubakar-ibrahim');
    expect(second.status).toBe('ok');
    expect(articles.aggregateCalls.length).toBeGreaterThan(1);
  });

  it('still caches a directory read that succeeded', async () => {
    // The flip side, so the fix above cannot be "stop caching". The directory is
    // one scan of the corpus and it exists to be shared across every author
    // page; re-running it per request is the failure this cache prevents.
    const articles = withArticles({ aggregate: [BYLINE_ROWS, FACET, FACET] });
    const getAuthorPageAction = await loadAction();

    await getAuthorPageAction('abubakar-ibrahim');
    await getAuthorPageAction('abubakar-ibrahim');

    const directoryReads = articles.aggregateCalls.filter((call) =>
      JSON.stringify(call.pipeline).includes('$author.name')
    );
    expect(directoryReads).toHaveLength(1);
  });

  it('still says not-found when the directory was read and carries no such byline', async () => {
    // `unavailable` must not become the answer to everything — a 404 that never
    // fires is as useless as one that always does.
    withArticles({ aggregate: [BYLINE_ROWS] });
    const getAuthorPageAction = await loadAction();

    await expect(getAuthorPageAction('nobody-at-all')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('says unavailable when the PROFILE read fails under a directory that worked', async () => {
    // The other half of the same defect: the byline resolves, so the page is
    // real, and its article list comes back empty from a timeout. `profile.ok`
    // is what stops the page printing "0 articles" over a real person's name.
    withArticles({ aggregate: [BYLINE_ROWS, TIMEOUT] });
    const getAuthorPageAction = await loadAction();

    const result = await getAuthorPageAction('abubakar-ibrahim');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.page.profile.ok).toBe(false);
    expect(result.page.profile.total).toBe(0);
  });
});
