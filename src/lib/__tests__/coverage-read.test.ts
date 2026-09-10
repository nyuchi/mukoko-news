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
 * issued, not just on what came back. That matters more than usual here: the
 * per-country source count is a `$addToSet` inside the same `$group`, and the
 * cheap mistake — a second query, or counting the wrong field — is invisible in
 * the returned value and expensive on a 1.5 GB collection.
 */
describe('getLiveCountries', () => {
  let articles: CollectionStub;

  function stub(rows: unknown[]) {
    articles = collectionStub({ aggregate: [rows] });
    mockGetDb.mockResolvedValue(dbStub({ articles }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the countries the corpus reports, with articles and sources', async () => {
    stub([
      { _id: 'NG', recent: 11025, sources: 71, newsrooms: 70 },
      { _id: 'KE', recent: 2349, sources: 27, newsrooms: 24 },
    ]);

    await expect(getLiveCountries()).resolves.toEqual([
      { code: 'NG', recent: 11025, sources: 71, newsrooms: 70 },
      { code: 'KE', recent: 2349, sources: 27, newsrooms: 24 },
    ]);
  });

  it('counts feed sources and newsrooms from their own fields', async () => {
    // These are two different questions and the pipeline must not conflate
    // them. A masthead can be delivered by several feeds — Kenya is 27 feed
    // sources across 24 newsrooms — so reading one count off the other field
    // would be wrong in whichever direction it was done.
    stub([]);
    await getLiveCountries();

    const [{ pipeline }] = articles.aggregateCalls;
    const group = pipeline.find((s) => '$group' in (s as object)) as {
      $group: Record<string, unknown>;
    };
    expect(group.$group.feedSources).toEqual({ $addToSet: '$feedSourceId' });
    expect(group.$group.newsrooms).toEqual({ $addToSet: '$mediaOrganizationId' });
  });

  it('claims no PUBLISHER count, because the data cannot support one', async () => {
    // publisher (entity) → newsroom (masthead) → source (feed) is the intended
    // model, but `newsMediaOrganizations.entityId` is 1:1 on the live cluster
    // — 537 organisations, 536 distinct entity ids — and the Zimpapers
    // mastheads (Herald, Chronicle, Manica Post, Sunday Mail, H-Metro) each
    // carry a different one. Grouping by entity would group nothing and yield
    // a "publishers" figure identical to the newsroom count, presented as a
    // separate fact. Nothing here touches `entityId` until it groups.
    stub([]);
    await getLiveCountries();
    expect(JSON.stringify(articles.aggregateCalls[0].pipeline)).not.toContain('entityId');
  });

  it('gets the source count from the SAME pass as the article count', async () => {
    // A second aggregation would double the cost of the most expensive read on
    // the site for a number that the first pass already has in hand.
    stub([]);
    await getLiveCountries();
    expect(articles.aggregateCalls).toHaveLength(1);
  });

  it('applies the threshold after grouping, on the country total', async () => {
    // The bar is on a country's total, so it cannot be pushed into the initial
    // $match — doing so would filter individual articles and quietly mean
    // something else entirely.
    stub([]);
    await getLiveCountries();

    const { pipeline } = articles.aggregateCalls[0];
    const groupIndex = pipeline.findIndex((s) => '$group' in (s as object));
    const thresholdIndex = pipeline.findIndex(
      (s) =>
        '$match' in (s as object) &&
        JSON.stringify(s).includes(String(LIVE_COUNTRY_MIN_RECENT_ARTICLES))
    );
    expect(groupIndex).toBeGreaterThanOrEqual(0);
    expect(thresholdIndex).toBeGreaterThan(groupIndex);
  });

  it('excludes rejected and removed articles from every count', async () => {
    stub([]);
    await getLiveCountries();
    const first = JSON.stringify(articles.aggregateCalls[0].pipeline[0]);
    expect(first).toContain('rejected');
    expect(first).toContain('removed');
  });

  it('windows on the documented number of days', async () => {
    stub([]);
    const before = Date.now();
    await getLiveCountries();

    const match = articles.aggregateCalls[0].pipeline[0] as {
      $match: { datePublished: { $gte: Date } };
    };
    const days = (before - match.$match.datePublished.$gte.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(LIVE_COUNTRY_WINDOW_DAYS, 1);
  });

  it('normalises the country code', async () => {
    stub([{ _id: '  ke  ', recent: 900, sources: 4, newsrooms: 4 }]);
    const [row] = await getLiveCountries();
    expect(row.code).toBe('KE');
  });

  it('returns empty rather than throwing when the read fails', async () => {
    // The caller turns this into the pinned fallback. If it threw instead, the
    // root layout would fail and take every page with it — for a decorative
    // sentence.
    mockGetDb.mockRejectedValue(new Error('mongo down'));
    await expect(getLiveCountries()).resolves.toEqual([]);
  });
});

describe('getTopCountriesByRecentVolume', () => {
  let articles: CollectionStub;

  beforeEach(() => {
    vi.clearAllMocks();
    articles = collectionStub({
      aggregate: [[{ _id: 'NG', recent: 11025, sources: 71, newsrooms: 70 }]],
    });
    mockGetDb.mockResolvedValue(dbStub({ articles }));
  });

  it('carries the same source count as the live read', async () => {
    // Both return `CoveredCountry`. If only one of them populated `sources`,
    // the onboarding picker and the discover grid would disagree about the
    // same country on the same corpus.
    await expect(getTopCountriesByRecentVolume(6)).resolves.toEqual([
      { code: 'NG', recent: 11025, sources: 71, newsrooms: 70 },
    ]);
  });

  it('bounds the result set', async () => {
    await getTopCountriesByRecentVolume(3);
    const { pipeline } = articles.aggregateCalls[0];
    expect(pipeline).toContainEqual({ $limit: 3 });
  });

  it('fails soft', async () => {
    mockGetDb.mockRejectedValue(new Error('mongo down'));
    await expect(getTopCountriesByRecentVolume()).resolves.toEqual([]);
  });
});
