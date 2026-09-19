import { describe, it, expect, vi, beforeEach } from 'vitest';

import { collectionStub, dbStub, type CollectionStub } from './helpers/mongo';

/**
 * The byline-page outage, end to end, with nothing between the driver and the
 * page result mocked away.
 *
 * ## What happened
 *
 * `getBylineDirectory` runs a `$group` on `$author.name` over the attributed
 * corpus, and nothing indexed `author`. Measured 2026-09-17 the `$group` did
 * not return within 60 seconds, so `QUERY_MAX_TIME_MS` aborted it on every
 * render. Every layer below was individually reasonable and the composition
 * was a lie:
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
 *
 * ## What changed, and what did NOT
 *
 * A covering index removed the document FETCH but left the read at 11 s warm,
 * so the build moved off the request path entirely: a cron publishes a snapshot
 * and the page resolves a slug out of it by `_id`. The cache-poisoning layer is
 * gone with it — there is no per-request cache left to poison.
 *
 * **The honesty property is unchanged and is what this suite is for.** An empty
 * answer still has more than one cause, and only one of them is a statement
 * about a journalist. The new shape of the trap is an UNBUILT SNAPSHOT: a fresh
 * environment, a dropped collection or a cron that has never fired all look
 * exactly like "this platform has no bylines".
 *
 * These tests drive a real driver stub through the real snapshot reader and the
 * real action. Mocking `@/lib/mongodb/byline-directory` — as the sibling
 * routing suite does, rightly, for its own purposes — cannot see this bug,
 * because the bug is in how the layers compose.
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
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

const TIMEOUT = new Error(
  'PlanExecutor error during aggregation :: caused by :: operation exceeded time limit'
);

const SNAPSHOT_ROW = {
  _id: 'abubakar-ibrahim',
  slug: 'abubakar-ibrahim',
  name: 'Abubakar Ibrahim',
  variants: ['Abubakar Ibrahim'],
  articles: 323,
  newsroomIds: ['org-joy'],
  desk: false,
  generation: '2026-09-19T00:00:00.000Z',
};

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

async function loadAction() {
  vi.resetModules();
  return (await import('@/lib/actions/authors')).getAuthorPageAction;
}

/** Mount both collections the read path can touch: the snapshot, and the corpus. */
function mount(
  directorySpec: Parameters<typeof collectionStub>[0],
  articlesSpec: Parameters<typeof collectionStub>[0] = {}
): { directory: CollectionStub; articles: CollectionStub } {
  const directory = collectionStub(directorySpec);
  const articles = collectionStub(articlesSpec);
  mockGetDb.mockResolvedValue(dbStub({ bylineDirectory: directory, articles }));
  return { directory, articles };
}

describe('a byline page over an unreachable corpus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgMap.mockResolvedValue(new Map([['org-joy', { id: 'org-joy', name: 'Joy News' }]]));
    mockSources.mockResolvedValue([{ id: 'src-joy-news', name: 'Joy News' }]);
    mockGetArticlesByIds.mockResolvedValue([]);
  });

  it('says UNAVAILABLE, not not-found, when the snapshot read fails', async () => {
    // THE regression. `not-found` is a claim about a journalist; we have not
    // earned it, because we never managed to look.
    mount({ findOne: [TIMEOUT] });
    const getAuthorPageAction = await loadAction();

    const result = await getAuthorPageAction('abubakar-ibrahim');
    expect(result.status).toBe('unavailable');
    expect(result.status).not.toBe('not-found');
  });

  it('says UNAVAILABLE when the snapshot has never been built', async () => {
    // The new shape of the same trap. An empty collection is what a cron that
    // has never fired looks like, and it is indistinguishable from a platform
    // with no journalists — so it must never be answered as a 404.
    mount({ findOne: [null], estimated: 0 });
    const getAuthorPageAction = await loadAction();

    await expect(getAuthorPageAction('abubakar-ibrahim')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('says unavailable when the cluster cannot be reached at all', async () => {
    mockGetDb.mockRejectedValue(new Error('server selection timed out'));
    const getAuthorPageAction = await loadAction();

    await expect(getAuthorPageAction('abubakar-ibrahim')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('never renders a failed read as a byline with no articles', async () => {
    mount({ findOne: [TIMEOUT] });
    const getAuthorPageAction = await loadAction();

    const result = await getAuthorPageAction('abubakar-ibrahim');
    expect(result).not.toMatchObject({ status: 'ok' });
    if (result.status === 'ok') {
      expect(result.page.profile.ok).toBe(true);
    }
  });

  it('NEVER runs the corpus scan on a reader request', async () => {
    // The whole point of the change. `getBylineDirectory`'s `$group` on
    // `$author.name` measured 11,057 ms warm; it belongs to the cron, and a
    // page render must not issue it under any circumstance — not on a miss, not
    // on a cold anything. An edit that "falls back to a live build" when the
    // snapshot is missing would put an 11-second query back in front of a
    // reader, and this is where it fails.
    const { articles } = mount({ findOne: [null], estimated: 0 });
    const getAuthorPageAction = await loadAction();

    await getAuthorPageAction('abubakar-ibrahim');

    const directoryScans = articles.aggregateCalls.filter((call) =>
      JSON.stringify(call.pipeline).includes('$author.name')
    );
    expect(directoryScans).toHaveLength(0);
  });

  it('resolves a byline with a single point lookup, not a scan', async () => {
    const { directory } = mount({ findOne: [SNAPSHOT_ROW] }, { aggregate: [FACET] });
    const getAuthorPageAction = await loadAction();

    const result = await getAuthorPageAction('abubakar-ibrahim');

    expect(result.status).toBe('ok');
    expect(directory.findCalls).toHaveLength(1);
    expect(directory.findCalls[0].filter).toEqual({ _id: 'abubakar-ibrahim' });
  });

  it('does not memoise a failed read over the next request', async () => {
    // The old amplification was `unstable_cache` holding a failed read's empty
    // list for a full hour, so one timeout blacked out every author page. The
    // snapshot read is not cached at all, so recovery is immediate: the very
    // next request re-reads and succeeds.
    mount({ findOne: [TIMEOUT, SNAPSHOT_ROW] }, { aggregate: [FACET] });
    const getAuthorPageAction = await loadAction();

    await expect(getAuthorPageAction('abubakar-ibrahim')).resolves.toEqual({
      status: 'unavailable',
    });
    await expect(getAuthorPageAction('abubakar-ibrahim')).resolves.toMatchObject({
      status: 'ok',
    });
  });

  it('still says not-found when the snapshot was read and carries no such byline', async () => {
    // `unavailable` must not become the answer to everything — a 404 that never
    // fires is as useless as one that always does.
    mount({ findOne: [null], estimated: 5448 });
    const getAuthorPageAction = await loadAction();

    await expect(getAuthorPageAction('nobody-at-all')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('says unavailable when the PROFILE read fails under a directory that worked', async () => {
    // The other half of the same defect: the byline resolves, so the page is
    // real, and its article list comes back empty from a timeout. `profile.ok`
    // is what stops the page printing "0 articles" over a real person's name.
    mount({ findOne: [SNAPSHOT_ROW] }, { aggregate: [TIMEOUT] });
    const getAuthorPageAction = await loadAction();

    const result = await getAuthorPageAction('abubakar-ibrahim');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.page.profile.ok).toBe(false);
    expect(result.page.profile.total).toBe(0);
  });
});
