/**
 * The catalogue readers behind the nav, the source directory and the onboarding
 * country picker — `mongodb/categories.ts`, `mongodb/sources.ts` and
 * `mongodb/coverage.ts`.
 *
 * All three exist in their current form because an earlier version was either
 * unbounded (a COLLSCAN of a 1.47 GB collection that could only ever time out)
 * or was reading the wrong field and rendering a plausible-looking wrong answer.
 * A wrong answer that looks right is the failure mode these pin against: every
 * assertion below corresponds to something that shipped and was measured.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCategories, getTrendingTags, getTrendingCategories } from '../mongodb/categories';
import { getSources, getTrendingAuthors, getStats } from '../mongodb/sources';
import { getTopCountriesByRecentVolume } from '../mongodb/coverage';
import { getDb } from '../mongodb/client';
import { collectionStub, dbStub, type CollectionStub } from './helpers/mongo';

vi.mock('../mongodb/client', () => ({
  getDb: vi.fn(),
  QUERY_MAX_TIME_MS: 15000,
}));

function useDb(collections: Record<string, CollectionStub>) {
  vi.mocked(getDb).mockResolvedValue(dbStub(collections) as unknown as never);
  return collections;
}

/** Pull the stage named `key` out of an aggregation pipeline. */
function stage<T = Record<string, unknown>>(pipeline: unknown[], key: string): T | undefined {
  return pipeline.find((s) => Object.hasOwn(s as object, key)) as T | undefined;
}

beforeEach(() => {
  vi.mocked(getDb).mockReset();
});

// ───────────────────────────────────────────────────────────────────────────
// Categories
// ───────────────────────────────────────────────────────────────────────────

describe('getCategories', () => {
  it('derives the nav from engagement.interest_categories, never articleSection', async () => {
    // Both collectors hardcode `articleSection: "general"` at ingestion, so the
    // previous version of this pipeline grouped the entire nav into a single
    // "general" bucket. The AI-written interest categories are the only field
    // that carries a real classification.
    const articles = collectionStub({ aggregate: [[{ _id: 'politics', n: 40 }]] });
    useDb({ articles });

    await getCategories();

    const pipeline = articles.aggregateCalls[0].pipeline;
    expect(stage(pipeline, '$unwind')).toEqual({
      $unwind: '$engagement.interest_categories',
    });
    expect(JSON.stringify(pipeline)).not.toContain('articleSection');
  });

  it('bounds the scan by date AND by document count', async () => {
    // Unbounded, this aggregation ran past 60 SECONDS on the live cluster —
    // beyond the driver's socket timeout, so it could never return, only throw.
    // And it was the live path on every home-page and nav render. The date bound
    // turns it into a range seek; the $limit caps the work whatever the window
    // holds; the $sort before the $limit is what makes the cap keep the *recent*
    // articles rather than an arbitrary 3,000.
    const articles = collectionStub({ aggregate: [[]] });
    useDb({ articles });

    await getCategories();

    const pipeline = articles.aggregateCalls[0].pipeline;
    const match = stage<{ $match: { datePublished: { $gte: Date } } }>(pipeline, '$match');
    expect(match?.$match.datePublished.$gte).toBeInstanceOf(Date);
    const ageDays =
      (Date.now() - match!.$match.datePublished.$gte.getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(29);
    expect(ageDays).toBeLessThan(31);

    expect(pipeline.indexOf(stage(pipeline, '$sort')!)).toBeLessThan(
      pipeline.indexOf(stage(pipeline, '$limit')!)
    );
    expect(stage(pipeline, '$limit')).toEqual({ $limit: 3000 });
    expect(articles.aggregateCalls[0].options).toMatchObject({ maxTimeMS: 15000 });
  });

  it('title-cases a slug for display', async () => {
    const articles = collectionStub({
      aggregate: [[{ _id: 'arts-culture', n: 9 }, { _id: 'health', n: 3 }]],
    });
    useDb({ articles });

    expect(await getCategories()).toEqual([
      { id: 'arts-culture', name: 'Arts Culture', slug: 'arts-culture', article_count: 9 },
      { id: 'health', name: 'Health', slug: 'health', article_count: 3 },
    ]);
  });

  it('drops blank and non-string group keys instead of rendering an empty nav tab', async () => {
    // `interest_categories` is a permissively-validated array written by an LLM
    // pipeline. A null or whitespace element becomes a nav tab that links
    // nowhere and returns nothing.
    useDb({
      articles: collectionStub({
        aggregate: [[{ _id: '  ', n: 5 }, { _id: null, n: 4 }, { _id: 'sport', n: 3 }]],
      }),
    });

    expect((await getCategories()).map((c) => c.slug)).toEqual(['sport']);
  });

  it('does not consult the deprecated news.categories collection', async () => {
    // Owner decision 2026-09-10: it is empty, and leaving the branch in meant
    // re-populating a stale collection could silently override live
    // classification with names that match nothing on any article.
    const collections = { articles: collectionStub({ aggregate: [[]] }) };
    const db = dbStub(collections);
    vi.mocked(getDb).mockResolvedValue(db as unknown as never);

    await getCategories();

    expect(db.collection).not.toHaveBeenCalledWith('categories');
  });
});

describe('getTrendingTags', () => {
  it('returns only tags that are attached to something, busiest first', async () => {
    const tags = collectionStub({
      find: [[{ _id: 't1', tagSlug: 'drought', name: 'Drought', articleCount: 20 }]],
    });
    useDb({ tags });

    const result = await getTrendingTags(5);

    expect(tags.findCalls[0].filter).toEqual({ articleCount: { $gt: 0 } });
    expect(tags.findCalls[0].sort).toEqual({ articleCount: -1 });
    expect(result).toEqual([
      { id: 't1', name: 'Drought', slug: 'drought', type: 'tag', article_count: 20 },
    ]);
  });

  it('clamps an unbounded limit', async () => {
    const tags = collectionStub({ find: [[]] });
    useDb({ tags });
    await getTrendingTags(10_000);
    expect(tags.findCalls[0].limit).toBe(100); // MAX_LIMIT
  });
});

describe('getTrendingCategories', () => {
  it('serves the precomputed cache when it is live', async () => {
    const articles = collectionStub({ aggregate: [[]] });
    useDb({
      articles,
      trendingCache: collectionStub({
        find: [[{ tagId: 'sport', term: 'Sport', articleCount: 30, score: 9 }]],
      }),
    });

    const result = await getTrendingCategories(4);

    expect(result).toEqual([{ id: 'sport', name: 'Sport', slug: 'sport', article_count: 30 }]);
    // The cache exists precisely so the bounded-but-still-1.4s aggregation does
    // not run on every render.
    expect(articles.aggregate).not.toHaveBeenCalled();
  });

  it('only reads unexpired, global cache rows', async () => {
    const cache = collectionStub({ find: [[]] });
    useDb({ trendingCache: cache, articles: collectionStub({ aggregate: [[]] }) });

    await getTrendingCategories();

    const filter = cache.findCalls[0].filter as { scope: string; expiresAt: { $gt: Date } };
    expect(filter.scope).toBe('global');
    expect(filter.expiresAt.$gt).toBeInstanceOf(Date);
    expect(cache.findCalls[0].sort).toEqual({ score: -1 });
  });

  it('falls back to the same bounded aggregation when the cache has expired', async () => {
    // This fallback is the identical COLLSCAN otherwise, and it runs whenever
    // the cache lapses — i.e. exactly when the site is already under strain.
    const articles = collectionStub({ aggregate: [[{ _id: 'politics', n: 7 }]] });
    useDb({ articles, trendingCache: collectionStub({ find: [[]] }) });

    const result = await getTrendingCategories(3);

    expect(stage(articles.aggregateCalls[0].pipeline, '$limit')).toEqual({ $limit: 3000 });
    expect(result).toEqual([
      { id: 'politics', name: 'Politics', slug: 'politics', article_count: 7 },
    ]);
  });

  it('drops blank group keys in the fallback too', async () => {
    useDb({
      articles: collectionStub({ aggregate: [[{ _id: '', n: 2 }, { _id: 'health', n: 1 }]] }),
      trendingCache: collectionStub({ find: [[]] }),
    });

    expect((await getTrendingCategories()).map((c) => c.slug)).toEqual(['health']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Sources
// ───────────────────────────────────────────────────────────────────────────

describe('getSources', () => {
  it('badges a source from its organization’s Tier-2 verification, not from the source row', async () => {
    // Verification is adjudicated by staff against the ORG
    // (`newsMediaOrganizations`). Reading a flag off the feed row would let the
    // pipeline, which writes feedSources, mint its own verified badges.
    const feedSources = collectionStub({
      aggregate: [
        [
          {
            _id: 's1',
            name: 'The Herald',
            feedUrl: 'https://herald.co.zw/feed',
            countryCode: 'ZW',
            articleCount: 900,
            org: { isVerified: true, publisherTier: 'tier2' },
          },
        ],
      ],
    });
    useDb({ feedSources });

    const [source] = await getSources();

    expect(source.verified).toBe(true);
    expect(source.publisher_tier).toBe('tier2');
    const lookup = stage<{ $lookup: { from: string } }>(
      feedSources.aggregateCalls[0].pipeline,
      '$lookup'
    );
    expect(lookup?.$lookup.from).toBe('newsMediaOrganizations');
  });

  it('reports an unverified source as explicitly false, never undefined', async () => {
    // `verified === undefined` renders as falsy in the directory but is a
    // different claim: "we did not check". A source with no org must read as
    // not verified.
    useDb({
      feedSources: collectionStub({
        aggregate: [[{ _id: 's2', name: 'Blog', feedUrl: 'u', countryCode: 'ZW', articleCount: 1, org: null }]],
      }),
    });

    const [source] = await getSources();

    expect(source.verified).toBe(false);
    expect(source.publisher_tier).toBeUndefined();
  });

  it('lists only active sources, busiest first', async () => {
    // Retired duplicates are deactivated rather than deleted (so article ids
    // stay resolvable), which means the directory MUST filter on isActive or it
    // shows the same masthead twice.
    const feedSources = collectionStub({ aggregate: [[]] });
    useDb({ feedSources });

    await getSources();

    const pipeline = feedSources.aggregateCalls[0].pipeline;
    expect(stage(pipeline, '$match')).toEqual({ $match: { isActive: true } });
    expect(stage(pipeline, '$sort')).toEqual({ $sort: { articleCount: -1 } });
  });
});

describe('getTrendingAuthors', () => {
  it('groups on author.name, not on the author sub-document', async () => {
    // `author` is a Schema.org Person ({ '@type': 'Person', name }), not a
    // string. Grouping on `$author` grouped by the whole object and rendered
    // every single entry as "[object Object]".
    const articles = collectionStub({ aggregate: [[{ _id: 'Herald Reporter', count: 12 }]] });
    useDb({ articles });

    const result = await getTrendingAuthors(3);

    const pipeline = articles.aggregateCalls[0].pipeline;
    expect(stage(pipeline, '$group')).toEqual({
      $group: { _id: '$author.name', count: { $sum: 1 } },
    });
    expect(result.trending_authors).toEqual([
      { id: 'Herald Reporter', name: 'Herald Reporter', article_count: 12 },
    ]);
  });

  it('skips documents whose byline is not a non-empty string', async () => {
    // Legacy documents stored a bare string or a malformed sub-document. Without
    // the type guard those become bogus author rows in a leaderboard.
    const articles = collectionStub({ aggregate: [[]] });
    useDb({ articles });

    await getTrendingAuthors();

    const match = stage<{ $match: Record<string, unknown> }>(
      articles.aggregateCalls[0].pipeline,
      '$match'
    );
    expect(match?.$match['author.name']).toEqual({ $type: 'string', $ne: '' });
  });

  it('bounds the scan to a 30-day window and a document cap', async () => {
    const articles = collectionStub({ aggregate: [[]] });
    useDb({ articles });

    await getTrendingAuthors();

    const pipeline = articles.aggregateCalls[0].pipeline;
    const match = stage<{ $match: { datePublished: { $gte: Date } } }>(pipeline, '$match');
    const ageDays = (Date.now() - match!.$match.datePublished.$gte.getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(29);
    expect(ageDays).toBeLessThan(31);
    expect(pipeline).toContainEqual({ $limit: 3000 });
    expect(articles.aggregateCalls[0].options).toMatchObject({ maxTimeMS: 15000 });
  });
});

describe('getStats', () => {
  it('uses estimatedDocumentCount for the corpus size', async () => {
    // The exact count cannot use an index here — `status` is the SECOND key of
    // `status_1_datePublished_-1`, so it is not a usable prefix and the query
    // degrades to a FETCH of all 1.47 GB. That is what made /api/health itself
    // the outage on 2026-09-10.
    const articles = collectionStub({ estimated: 44237, count: 310 });
    const feedSources = collectionStub({ count: 123 });
    useDb({ articles, feedSources });

    const stats = await getStats();

    expect(articles.estimatedDocumentCount).toHaveBeenCalled();
    expect(stats.database).toEqual({
      total_articles: 44237,
      active_sources: 123,
      today_articles: 310,
    });
  });

  it('counts today from midnight, index-backed on datePublished', async () => {
    const articles = collectionStub({ estimated: 1, count: 1 });
    useDb({ articles, feedSources: collectionStub({ count: 1 }) });

    await getStats();

    const filter = articles.countCalls[0].filter as {
      status: { $in: string[] };
      datePublished: { $gte: Date };
    };
    expect(filter.status.$in).toEqual(['approved', 'published']);
    expect(filter.datePublished.$gte.getHours()).toBe(0);
    expect(articles.countCalls[0].options).toMatchObject({ maxTimeMS: 15000 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Coverage (onboarding country ranking)
// ───────────────────────────────────────────────────────────────────────────

describe('getTopCountriesByRecentVolume', () => {
  it('ranks by RECENT volume, not all-time', async () => {
    // Ranking all-time would offer a country whose sources have since gone
    // dark — promising a feed the platform cannot fill. The onboarding modal
    // previously offered `COUNTRIES.slice(0, 4)`, which meant a new reader was
    // offered Tanzania (368 articles in 30 days) while Nigeria (8,648) was not
    // on the list at all.
    const articles = collectionStub({ aggregate: [[{ _id: 'ng', recent: 8648 }]] });
    useDb({ articles });

    const result = await getTopCountriesByRecentVolume(6, 30);

    const match = stage<{ $match: { datePublished: { $gte: Date } } }>(
      articles.aggregateCalls[0].pipeline,
      '$match'
    );
    const ageDays = (Date.now() - match!.$match.datePublished.$gte.getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(29);
    expect(ageDays).toBeLessThan(31);
    // Normalised: `countryCode` is written by two collectors and casing drifts.
    expect(result).toEqual([{ code: 'NG', recent: 8648 }]);
  });

  it('ignores articles with no country rather than bucketing them', async () => {
    // 10,620 articles carried no countryCode for a 33-day window. A `null`
    // bucket would have ranked first and offered readers a country called
    // "null".
    const articles = collectionStub({ aggregate: [[]] });
    useDb({ articles });

    await getTopCountriesByRecentVolume();

    const match = stage<{ $match: Record<string, unknown> }>(
      articles.aggregateCalls[0].pipeline,
      '$match'
    );
    expect(match?.$match.countryCode).toEqual({ $type: 'string', $ne: '' });
  });

  it('clamps absurd limits and windows', async () => {
    const articles = collectionStub({ aggregate: [[]] });
    useDb({ articles });

    await getTopCountriesByRecentVolume(9999, 9999);

    expect(stage(articles.aggregateCalls[0].pipeline, '$limit')).toEqual({ $limit: 24 });
  });

  it('returns an empty list rather than throwing when the cluster is unreachable', async () => {
    // Fail-soft on purpose: the caller falls back to a static country set,
    // because an onboarding step with NO options is worse than one with stale
    // options. If this ever threw, a Mongo blip would break first-run onboarding.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useDb({ articles: collectionStub({ aggregate: [new Error('no primary')] }) });

    expect(await getTopCountriesByRecentVolume()).toEqual([]);
  });
});
