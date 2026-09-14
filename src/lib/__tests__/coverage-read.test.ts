import { describe, it, expect, vi, beforeEach } from 'vitest';

import { collectionStub, dbStub, type CollectionStub } from './helpers/mongo';

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock('@/lib/mongodb/client', () => ({
  getDb: mockGetDb,
  QUERY_MAX_TIME_MS: 5000,
}));

import {
  getLiveCountries,
  getTopCountriesByRecentVolume,
  LIVE_COUNTRY_MIN_RECENT_ARTICLES,
  LIVE_COUNTRY_WINDOW_DAYS,
} from '@/lib/mongodb/coverage';

/**
 * The corpus read behind every coverage claim on the site.
 *
 * Mocked at the driver seam so these can assert on the PIPELINE that was
 * issued, not just on what came back — which matters more than usual here.
 *
 * This read used to open with `moderationStatus: {$ne: 'removed'}` and then
 * `$group` with two `$addToSet`s across the window. Measured on the live
 * cluster 2026-09-14, that could not be EXPLAINED inside 60 seconds: no index
 * carries `moderationStatus`, so all ~47,000 documents in the window had to be
 * fetched to evaluate one field. It therefore ALWAYS failed, always returned
 * `[]`, and `/discover` always rendered the fallback — "Coming soon" on every
 * country card, and a coverage count from a hardcoded floor rather than the
 * corpus. Nothing surfaced the failure, because the fail-soft path is
 * indistinguishable from a quiet corpus.
 *
 * So these assert the two properties that keep that from coming back: the
 * counting happens in the Atlas Search index, and it is bounded.
 */

/** One `$searchMeta` row shaped like the pipeline's. */
function metaRow(country: Array<{ _id: string; count: number }>, src: string[] = []) {
  return {
    facet: {
      country: { buckets: country },
      src: { buckets: src.map((id) => ({ _id: id, count: 1 })) },
    },
  };
}

describe('getLiveCountries', () => {
  let articles: CollectionStub;
  let feedSources: CollectionStub;

  function stub(
    country: Array<{ _id: string; count: number }>,
    src: string[] = [],
    sourceRows: Array<{ _id: string; countryCode?: string; mediaOrganizationId?: string }> = []
  ) {
    articles = collectionStub({ aggregate: [[metaRow(country, src)]] });
    feedSources = collectionStub({ find: [sourceRows] });
    mockGetDb.mockResolvedValue(dbStub({ articles, feedSources }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('counts in the Search index, never by reading documents', async () => {
    // The regression this file exists for. A `$group`/`$match` pipeline over
    // `articles` is what took 60+ seconds and made the page render its own
    // failure state.
    stub([{ _id: 'NG', count: 12427 }]);
    await getLiveCountries();

    const [{ pipeline }] = articles.aggregateCalls;
    expect(pipeline[0]).toHaveProperty('$searchMeta');
    expect(JSON.stringify(pipeline)).not.toContain('$group');
  });

  it('is bounded, so a slow read fails instead of hanging', async () => {
    // Unbounded, a slow aggregation does not error — it holds the function
    // until the platform kills the request, which a reader sees as a blank
    // page rather than a degraded one. The old pipeline carried no maxTimeMS.
    stub([]);
    await getLiveCountries();
    expect(articles.aggregateCalls[0].options).toMatchObject({ maxTimeMS: expect.any(Number) });
  });

  it('returns the countries the corpus reports, with articles, sources and newsrooms', async () => {
    stub(
      [
        { _id: 'NG', count: 12427 },
        { _id: 'KE', count: 2634 },
      ],
      ['src-a', 'src-b', 'src-c'],
      [
        { _id: 'src-a', countryCode: 'NG', mediaOrganizationId: 'org-1' },
        { _id: 'src-b', countryCode: 'NG', mediaOrganizationId: 'org-1' },
        { _id: 'src-c', countryCode: 'KE', mediaOrganizationId: 'org-2' },
      ]
    );

    await expect(getLiveCountries()).resolves.toEqual([
      // Two feeds, one masthead — the counts are different questions.
      { code: 'NG', recent: 12427, sources: 2, newsrooms: 1 },
      { code: 'KE', recent: 2634, sources: 1, newsrooms: 1 },
    ]);
  });

  it('counts sources and newsrooms from their own fields, never one off the other', async () => {
    // A masthead can be delivered by several feeds — measured live, Kenya is
    // 29 feed sources across fewer newsrooms — so reading one count off the
    // other field would be wrong in whichever direction it was done.
    stub(
      [{ _id: 'ZW', count: 4053 }],
      ['s1', 's2', 's3'],
      [
        { _id: 's1', countryCode: 'ZW', mediaOrganizationId: 'herald' },
        { _id: 's2', countryCode: 'ZW', mediaOrganizationId: 'herald' },
        { _id: 's3', countryCode: 'ZW', mediaOrganizationId: 'chronicle' },
      ]
    );
    const [row] = await getLiveCountries();
    expect(row.sources).toBe(3);
    expect(row.newsrooms).toBe(2);
  });

  it('counts only sources that PUBLISHED, not every source registered', async () => {
    // Measured live: Kenya has 29 sources publishing in the window against 44
    // registered. On a page about coverage the registry figure would claim
    // reach the corpus is not currently delivering.
    stub([{ _id: 'KE', count: 2634 }], ['s1'], [
      { _id: 's1', countryCode: 'KE', mediaOrganizationId: 'org-1' },
    ]);
    await getLiveCountries();

    const [{ filter }] = feedSources.findCalls;
    expect(filter).toEqual({ _id: { $in: ['s1'] } });
  });

  it('does not count a source whose organisation never resolved as a newsroom', async () => {
    // A resolution failure must not inflate the newsroom figure.
    stub([{ _id: 'GH', count: 3812 }], ['s1', 's2'], [
      { _id: 's1', countryCode: 'GH', mediaOrganizationId: 'org-1' },
      { _id: 's2', countryCode: 'GH' },
    ]);
    const [row] = await getLiveCountries();
    expect(row.sources).toBe(2);
    expect(row.newsrooms).toBe(1);
  });

  it('claims no PUBLISHER count, because the data cannot support one', async () => {
    // publisher (entity) → newsroom (masthead) → source (feed) is the intended
    // model, but `newsMediaOrganizations.entityId` is 1:1 on the live cluster,
    // and the Zimpapers mastheads each carry a different one. Grouping by
    // entity would group nothing and yield a figure identical to the newsroom
    // count, presented as a separate fact.
    stub([{ _id: 'NG', count: 12427 }], ['s1'], [
      { _id: 's1', countryCode: 'NG', mediaOrganizationId: 'org-1' },
    ]);
    const [row] = await getLiveCountries();
    expect(row).not.toHaveProperty('publishers');
    expect(JSON.stringify(feedSources.findCalls)).not.toContain('entityId');
  });

  it('gets the article count and the source set from ONE search call', async () => {
    // A second `$searchMeta` would double the cost for two facets the first
    // call can carry together.
    stub([{ _id: 'NG', count: 12427 }], ['s1']);
    await getLiveCountries();
    expect(articles.aggregateCalls).toHaveLength(1);
  });

  it('applies the threshold to the country total, after counting', async () => {
    // The bar is on a country's total, so it cannot be pushed into the search
    // filter — doing so would filter individual articles and quietly mean
    // something else entirely.
    stub([
      { _id: 'NG', count: LIVE_COUNTRY_MIN_RECENT_ARTICLES + 1 },
      { _id: 'SD', count: LIVE_COUNTRY_MIN_RECENT_ARTICLES - 1 },
    ]);
    const rows = await getLiveCountries();

    expect(rows.map((r) => r.code)).toEqual(['NG']);
    expect(JSON.stringify(articles.aggregateCalls[0].pipeline)).not.toContain(
      String(LIVE_COUNTRY_MIN_RECENT_ARTICLES)
    );
  });

  it('excludes rejected and removed articles from every count', async () => {
    // `mustNot` is the exact semantics of `$ne`: it excludes the value AND
    // keeps documents where the field is absent, which is what the old
    // `{$ne: 'removed'}` meant and what nearly every article relies on.
    stub([]);
    await getLiveCountries();

    const stage = articles.aggregateCalls[0].pipeline[0] as {
      $searchMeta: { facet: { operator: { compound: { mustNot: Array<{ text: { path: string; query: string } }> } } } };
    };
    const mustNot = stage.$searchMeta.facet.operator.compound.mustNot;
    expect(mustNot.map((m) => [m.text.path, m.text.query])).toEqual([
      ['status', 'rejected'],
      ['moderationStatus', 'removed'],
    ]);
  });

  it('windows on the documented number of days', async () => {
    stub([]);
    const before = Date.now();
    await getLiveCountries();

    const stage = articles.aggregateCalls[0].pipeline[0] as {
      $searchMeta: { facet: { operator: { compound: { filter: Array<{ range: { gte: Date } }> } } } };
    };
    const gte = stage.$searchMeta.facet.operator.compound.filter[0].range.gte;
    const days = (before - gte.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(LIVE_COUNTRY_WINDOW_DAYS, 1);
  });

  it('normalises the country code', async () => {
    stub([{ _id: '  ke  ', count: 900 }]);
    const [row] = await getLiveCountries();
    expect(row.code).toBe('KE');
  });

  it('drops a blank country bucket rather than labelling it', async () => {
    stub([
      { _id: '', count: 9000 },
      { _id: 'NG', count: 900 },
    ]);
    expect((await getLiveCountries()).map((r) => r.code)).toEqual(['NG']);
  });

  it('returns empty rather than throwing when the read fails', async () => {
    // The caller turns this into the pinned fallback. If it threw instead, the
    // root layout would fail and take every page with it — for a sentence.
    mockGetDb.mockRejectedValue(new Error('mongo down'));
    await expect(getLiveCountries()).resolves.toEqual([]);
  });
});

describe('getTopCountriesByRecentVolume', () => {
  let articles: CollectionStub;
  let feedSources: CollectionStub;

  function stub(country: Array<{ _id: string; count: number }>) {
    articles = collectionStub({ aggregate: [[metaRow(country, ['s1'])]] });
    feedSources = collectionStub({
      find: [[{ _id: 's1', countryCode: 'NG', mediaOrganizationId: 'org-1' }]],
    });
    mockGetDb.mockResolvedValue(dbStub({ articles, feedSources }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stub([{ _id: 'NG', count: 12427 }]);
  });

  it('carries the same source count as the live read', async () => {
    // Both return `CoveredCountry`. If only one populated `sources`, the
    // onboarding picker and the discover grid would disagree about the same
    // country on the same corpus.
    await expect(getTopCountriesByRecentVolume(6)).resolves.toEqual([
      { code: 'NG', recent: 12427, sources: 1, newsrooms: 1 },
    ]);
  });

  it('bounds the result set', async () => {
    stub([
      { _id: 'NG', count: 5 },
      { _id: 'ZA', count: 4 },
      { _id: 'ZW', count: 3 },
    ]);
    expect(await getTopCountriesByRecentVolume(2)).toHaveLength(2);
  });

  it('ranks by recent volume, busiest first', async () => {
    stub([
      { _id: 'ZW', count: 3 },
      { _id: 'NG', count: 9 },
    ]);
    expect((await getTopCountriesByRecentVolume(6)).map((r) => r.code)).toEqual(['NG', 'ZW']);
  });

  it('fails soft', async () => {
    mockGetDb.mockRejectedValue(new Error('mongo down'));
    await expect(getTopCountriesByRecentVolume()).resolves.toEqual([]);
  });
});
