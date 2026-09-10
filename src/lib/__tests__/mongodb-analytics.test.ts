/**
 * The `/analytics` corpus query engine (`src/lib/mongodb/analytics.ts`).
 *
 * `analytics-query.test.ts` covers `normalizeQuery` as a pure function. This
 * file covers the three database-backed reads, which is where the risk actually
 * is: they are documented as fail-soft (a failure returns an empty-but-typed
 * result and never throws to the page), they issue one `$facet` whose shape the
 * whole console depends on, and they caption their own results with the query
 * they really ran rather than the one that was asked for.
 *
 * "Never throws to the page" is a promise no type can enforce. Every fail-soft
 * assertion below is the difference between a degraded panel and a 500.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runCorpusQuery,
  getCoverageConcentration,
  getQueryFacets,
  MAX_WINDOW_DAYS,
} from '../mongodb/analytics';
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

/** A `$facet` output row shaped like the pipeline's, with only the parts a test cares about. */
function facetRow(over: Record<string, unknown> = {}) {
  return { total: [{ n: 100 }], ...over };
}

beforeEach(() => {
  vi.mocked(getDb).mockReset();
  // These readers log before degrading; the log is the intended behaviour, the
  // noise is not.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// runCorpusQuery
// ───────────────────────────────────────────────────────────────────────────

describe('runCorpusQuery — fail-soft contract', () => {
  it('returns an empty-but-typed result instead of throwing when the cluster is down', async () => {
    // `/analytics` is `force-dynamic`, so a throw here is a 500 on a public
    // page. Every panel must be able to render "no data" instead.
    useDb({ articles: collectionStub({ aggregate: [new Error('no primary')] }) });

    const result = await runCorpusQuery({});

    expect(result.total).toBe(0);
    expect(result.series).toEqual([]);
    expect(result.bySource).toEqual([]);
    expect(result.sentiment).toEqual({
      positive: 0,
      neutral: 0,
      negative: 0,
      mixed: 0,
      coverage: 0,
      covered: 0,
    });
    expect(result.quality).toEqual({ avg: 0, coverage: 0, covered: 0 });
    expect(result.sample).toEqual([]);
  });

  it('still reports the normalized query when it degrades, so the UI can caption honestly', async () => {
    // The page captions results with the filters that were APPLIED. Losing the
    // query on the error path would leave a chart labelled with filters it never
    // ran.
    useDb({ articles: collectionStub({ aggregate: [new Error('boom')] }) });

    const result = await runCorpusQuery({ countries: ['zw'], from: '2026-08-01', to: '2026-08-10' });

    expect(result.query.countries).toEqual(['ZW']);
    expect(result.query.from).toBe('2026-08-01');
    expect(result.query.to).toBe('2026-08-10');
  });

  it('returns the empty shape — not a half-populated one — when nothing matches', async () => {
    useDb({ articles: collectionStub({ aggregate: [[facetRow({ total: [] })]] }) });

    const result = await runCorpusQuery({});

    expect(result.total).toBe(0);
    expect(result.series).toEqual([]);
  });

  it('survives an aggregation that returns no rows at all', async () => {
    useDb({ articles: collectionStub({ aggregate: [[]] }) });
    expect((await runCorpusQuery({})).total).toBe(0);
  });
});

describe('runCorpusQuery — the text-search path', () => {
  it('leads with Atlas Search and says so', async () => {
    const articles = collectionStub({ aggregate: [[facetRow()]] });
    useDb({ articles });

    const result = await runCorpusQuery({ q: 'cyclone' });

    const pipeline = articles.aggregateCalls[0].pipeline as Array<Record<string, unknown>>;
    expect(pipeline[0]).toHaveProperty('$search');
    expect(result.usedSearchIndex).toBe(true);
  });

  it('degrades to a regex scan and reports usedSearchIndex: false', async () => {
    // The index can be missing or still building. Reporting `true` regardless
    // would have the UI claim stemmed, fuzzy relevance it did not get — the
    // caption is the only way a reader can tell the results are cruder.
    const articles = collectionStub({
      aggregate: [new Error('index not found'), [facetRow()]],
    });
    useDb({ articles });

    const result = await runCorpusQuery({ q: 'cyclone' });

    expect(result.usedSearchIndex).toBe(false);
    expect(result.total).toBe(100);
    const fallback = articles.aggregateCalls[1].pipeline as Array<{ $match: { $or: unknown[] } }>;
    expect(fallback[0].$match.$or).toHaveLength(2);
  });

  it('escapes regex metacharacters in the fallback', async () => {
    // The term arrives from a query string on a public page. `.*` unescaped
    // matches everything; an unbalanced `(` throws a SyntaxError mid-request.
    const articles = collectionStub({ aggregate: [new Error('no index'), [facetRow({ total: [] })]] });
    useDb({ articles });

    await runCorpusQuery({ q: 'a.*b(' });

    const fallback = articles.aggregateCalls[1].pipeline as Array<{
      $match: { $or: Array<{ headline?: RegExp }> };
    }>;
    expect(fallback[0].$match.$or[0].headline?.source).toBe('a\\.\\*b\\(');
  });

  it('skips the search stage entirely when there is no term', async () => {
    const articles = collectionStub({ aggregate: [[facetRow()]] });
    useDb({ articles });

    const result = await runCorpusQuery({});

    const pipeline = articles.aggregateCalls[0].pipeline as Array<Record<string, unknown>>;
    expect(pipeline[0]).not.toHaveProperty('$search');
    expect(result.usedSearchIndex).toBe(false);
  });
});

describe('runCorpusQuery — the $match it builds', () => {
  function matchFor(params: Parameters<typeof runCorpusQuery>[0]) {
    const articles = collectionStub({ aggregate: [[facetRow({ total: [] })]] });
    useDb({ articles });
    return runCorpusQuery(params).then(
      () =>
        (articles.aggregateCalls[0].pipeline as Array<{ $match: Record<string, unknown> }>)[0].$match
    );
  }

  it('always hides rejected and removed articles', async () => {
    expect(await matchFor({})).toMatchObject({
      status: { $ne: 'rejected' },
      moderationStatus: { $ne: 'removed' },
    });
  });

  it('treats `to` as an inclusive calendar day', async () => {
    // An exclusive upper bound silently drops the most recent day from every
    // chart — the day a reader is most likely to be looking for.
    const match = (await matchFor({ from: '2026-08-01', to: '2026-08-10' })) as {
      datePublished: { $gte: Date; $lt: Date };
    };
    expect(match.datePublished.$gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(match.datePublished.$lt.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('filters country on the article’s own countryCode, with no feedSources join', async () => {
    // `countryCode` is written by both collectors at ingestion. Joining
    // feedSources here (as the older article list path still must) would add a
    // round trip for a field the document already carries.
    expect(await matchFor({ countries: ['zw', 'NG'] })).toMatchObject({
      countryCode: { $in: ['ZW', 'NG'] },
    });
  });

  it('applies source, sentiment and quality filters', async () => {
    const match = await matchFor({
      sources: ['src-1'],
      sentiments: ['positive'],
      minQuality: 0.5,
    });
    expect(match).toMatchObject({
      feedSourceId: { $in: ['src-1'] },
      aiSentiment: { $in: ['positive'] },
      qualityScore: { $gte: 0.5 },
    });
  });

  it('matches categories case-insensitively and anchored', async () => {
    const match = (await matchFor({ categories: ['Health'] })) as Record<string, { $in: RegExp[] }>;
    expect(match['engagement.interest_categories'].$in).toEqual([/^health$/i]);
  });

  it('omits a filter entirely when it was not asked for', async () => {
    // A `$in: []` matches nothing, so an empty filter that is still emitted
    // turns "no filter" into "no results".
    const match = await matchFor({});
    expect(match).not.toHaveProperty('countryCode');
    expect(match).not.toHaveProperty('feedSourceId');
    expect(match).not.toHaveProperty('qualityScore');
    expect(match).not.toHaveProperty('engagement.interest_categories');
  });
});

describe('runCorpusQuery — result shaping', () => {
  const fullFacets = facetRow({
    total: [{ n: 200 }],
    series: [{ _id: '2026-08-02', count: 3 }],
    bySource: [{ _id: 'src-1', count: 120, country: 'ZW' }],
    byCountry: [
      { _id: 'ZW', count: 120, sources: 4 },
      { _id: '', count: 5, sources: 1 },
    ],
    byCategory: [{ _id: 'politics', count: 50 }],
    byKeyword: [
      { _id: 'load shedding', count: 30 },
      { _id: 'zimbabwe', count: 29 },
      { _id: 'a', count: 28 },
    ],
    byEntity: [
      { _id: { name: 'ZESA', type: 'ORGANIZATION' }, count: 12 },
      { _id: { name: 'news', type: 'ORGANIZATION' }, count: 11 },
    ],
    byAuthor: [{ _id: 'Herald Reporter', count: 8 }],
    bylineCovered: [{ n: 40 }],
    sentiment: [
      { _id: 'positive', count: 10 },
      { _id: 'negative', count: 30 },
    ],
    quality: [{ avg: 0.76543, n: 90 }],
    sample: [
      {
        _id: 'a1',
        headline: 'Load shedding worsens',
        description: '  A lead.  ',
        feedSourceId: 'src-1',
        countryCode: 'ZW',
        datePublished: new Date('2026-08-02T06:00:00.000Z'),
        externalUrl: 'https://herald.co.zw/a1',
        aiSentiment: 'negative',
        qualityScore: 0.81234,
      },
    ],
  });

  async function run(over: Record<string, unknown> = {}) {
    useDb({
      articles: collectionStub({ aggregate: [[{ ...fullFacets, ...over }]] }),
      feedSources: collectionStub({ find: [[{ _id: 'src-1', name: 'The Herald' }]] }),
    });
    return runCorpusQuery({ from: '2026-08-01', to: '2026-08-03' });
  }

  it('zero-fills the daily series so a quiet day reads as 0, not as a gap', async () => {
    // A gap in a time series is read as "we have no data"; a zero is read as
    // "nothing was published". They are different editorial facts, and a line
    // chart that skips the day draws a slope through it.
    const result = await run();
    expect(result.series).toEqual([
      { date: '2026-08-01', count: 0 },
      { date: '2026-08-02', count: 3 },
      { date: '2026-08-03', count: 0 },
    ]);
  });

  it('resolves source ids to display names in one round trip', async () => {
    const result = await run();
    expect(result.bySource[0]).toMatchObject({ sourceId: 'src-1', name: 'The Herald', share: 60 });
    expect(result.sample[0].source).toBe('The Herald');
  });

  it('falls back to the raw id when a source row has gone', async () => {
    useDb({
      articles: collectionStub({ aggregate: [[fullFacets]] }),
      feedSources: collectionStub({ find: [[]] }),
    });
    const result = await runCorpusQuery({ from: '2026-08-01', to: '2026-08-03' });
    expect(result.bySource[0].name).toBe('src-1');
  });

  it('drops a blank country bucket rather than labelling it', async () => {
    // ~23% of the corpus carried no countryCode for a month. An empty bucket
    // would render as a nameless bar sitting near the top of the chart.
    const result = await run();
    expect(result.byCountry.map((c) => c.code)).toEqual(['ZW']);
    expect(result.byCountry[0].name).toBe('Zimbabwe');
  });

  it('drops boilerplate and country tokens from the topic ranking', async () => {
    // Feed-supplied keywords are polluted with section names and the
    // publication's own country, which otherwise dominate a "top topics" panel
    // with entries that carry no information at all.
    const result = await run();
    expect(result.byKeyword.map((k) => k.term)).toEqual(['load shedding']);
    expect(result.byEntity.map((e) => e.name)).toEqual(['ZESA']);
  });

  it('reports coverage alongside every metric computed on an enriched subset', async () => {
    // Sentiment and quality only exist on enriched articles. Presenting the
    // average without the coverage would state a figure derived from 45% of the
    // match as though it described all of it.
    const result = await run();
    expect(result.sentiment).toEqual({
      positive: 10,
      neutral: 0,
      negative: 30,
      mixed: 0,
      covered: 40,
      coverage: 20,
    });
    expect(result.quality).toEqual({ avg: 0.765, covered: 90, coverage: 45 });
    expect(result.bylineCoverage).toEqual({ covered: 40, coverage: 20 });
  });

  it('reports zero coverage — not a missing key — when nothing is enriched', async () => {
    const result = await run({ sentiment: [], quality: [], bylineCovered: [] });
    expect(result.sentiment.coverage).toBe(0);
    expect(result.quality).toEqual({ avg: 0, covered: 0, coverage: 0 });
    expect(result.bylineCoverage).toEqual({ covered: 0, coverage: 0 });
  });

  it('normalises a sample row that is missing every optional field', async () => {
    // An un-enriched, image-less, dateless article is the common case for
    // anything ingested in the last few minutes; the sample table must render it.
    const result = await run({ sample: [{ _id: 'bare' }] });
    expect(result.sample[0]).toEqual({
      id: 'bare',
      headline: '(untitled)',
      description: null,
      source: 'unknown',
      country: null,
      publishedAt: null,
      url: '',
      sentiment: null,
      qualityScore: null,
    });
  });

  it('skips the feedSources round trip when there are no ids to resolve', async () => {
    const feedSources = collectionStub({ find: [[]] });
    useDb({
      articles: collectionStub({ aggregate: [[facetRow({ bySource: [], sample: [] })]] }),
      feedSources,
    });
    await runCorpusQuery({});
    expect(feedSources.find).not.toHaveBeenCalled();
  });

  it('clamps the sample limit before it reaches the pipeline', async () => {
    const articles = collectionStub({ aggregate: [[facetRow({ total: [] })]] });
    useDb({ articles });

    await runCorpusQuery({ sampleLimit: 100_000 });

    expect(JSON.stringify(articles.aggregateCalls[0].pipeline)).toContain('"$limit":100');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getCoverageConcentration
// ───────────────────────────────────────────────────────────────────────────

describe('getCoverageConcentration', () => {
  const rows = [
    {
      _id: 'ZW',
      articles: 100,
      sources: [
        { sourceId: 'src-1', n: 90 },
        { sourceId: 'src-2', n: 10 },
      ],
    },
    { _id: 'LS', articles: 20, sources: [{ sourceId: 'src-3', n: 20 }] },
  ];

  async function run(days?: number) {
    useDb({
      articles: collectionStub({ aggregate: [rows] }),
      feedSources: collectionStub({
        find: [
          [
            { _id: 'src-1', name: 'The Herald' },
            { _id: 'src-3', name: 'Lesotho Times' },
          ],
        ],
      }),
    });
    return getCoverageConcentration(days === undefined ? {} : { days });
  }

  it('computes the top-source share and HHI from the source split', async () => {
    // This is the honest counterweight to a country volume bar chart: a country
    // can look well covered while every story comes from one outlet. HHI above
    // 2500 is "concentrated"; 10000 means one source IS the country's news feed
    // as far as this platform is concerned.
    const result = await run();
    const zw = result.countries.find((c) => c.code === 'ZW')!;
    expect(zw.topSourceShare).toBe(90);
    expect(zw.topSourceName).toBe('The Herald');
    expect(zw.sources).toBe(2);
    expect(zw.hhi).toBe(8200); // 90² + 10²
  });

  it('flags a country served by exactly one source', async () => {
    const result = await run();
    expect(result.countries.find((c) => c.code === 'LS')!.hhi).toBe(10000);
    expect(result.singleSourceCount).toBe(1);
  });

  it('names the countries with no coverage at all', async () => {
    // The absence is the finding. A chart of countries that HAVE articles can
    // never show that 31 of 53 African countries have no source.
    const result = await run();
    const uncovered = result.uncovered.map((c) => c.code);
    expect(uncovered).not.toContain('ZW');
    expect(uncovered).not.toContain('LS');
    expect(uncovered.length).toBeGreaterThan(0);
    expect(result.uncovered[0]).toHaveProperty('name');
  });

  it('falls back to the raw source id when a name is unresolvable', async () => {
    useDb({
      articles: collectionStub({
        aggregate: [[{ _id: 'ZW', articles: 5, sources: [{ sourceId: 'ghost', n: 5 }] }]],
      }),
      feedSources: collectionStub({ find: [[]] }),
    });
    const result = await getCoverageConcentration({});
    expect(result.countries[0].topSourceName).toBe('ghost');
  });

  it('clamps the window', async () => {
    expect((await run(99_999)).days).toBe(MAX_WINDOW_DAYS);
  });

  it('returns an empty-but-typed concentration when the read fails', async () => {
    useDb({ articles: collectionStub({ aggregate: [new Error('timeout')] }) });

    const result = await getCoverageConcentration({ days: 7 });

    expect(result).toMatchObject({ days: 7, countries: [], uncovered: [], singleSourceCount: 0 });
    expect(result.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getQueryFacets
// ───────────────────────────────────────────────────────────────────────────

describe('getQueryFacets', () => {
  it('offers only values the corpus actually contains in the window', async () => {
    // A select that offers a country or category returning zero results reads
    // as a broken console, not as an empty corpus.
    useDb({
      articles: collectionStub({
        aggregate: [
          [
            {
              countries: [{ _id: 'ZW', n: 900 }],
              categories: [{ _id: 'politics', n: 400 }],
            },
          ],
        ],
      }),
    });

    const facets = await getQueryFacets({});

    expect(facets.countries).toEqual([{ code: 'ZW', name: 'Zimbabwe', articles: 900 }]);
    expect(facets.categories).toEqual([{ slug: 'politics', articles: 400 }]);
  });

  it('falls back to the raw code for a country not in the constant', async () => {
    useDb({
      articles: collectionStub({
        aggregate: [[{ countries: [{ _id: 'XX', n: 1 }], categories: [] }]],
      }),
    });
    expect((await getQueryFacets({})).countries[0].name).toBe('XX');
  });

  it('does NOT facet sources — the console has no source select', async () => {
    // Arrived at by clicking a bar, not by choosing from a list. Fetching the
    // top 200 plus a feedSources name lookup only to serialise them unread into
    // the RSC payload was a round trip and a payload for nothing.
    const articles = collectionStub({ aggregate: [[{ countries: [], categories: [] }]] });
    const feedSources = collectionStub({ find: [[]] });
    useDb({ articles, feedSources });

    await getQueryFacets({});

    expect(JSON.stringify(articles.aggregateCalls[0].pipeline)).not.toContain('feedSourceId');
    expect(feedSources.find).not.toHaveBeenCalled();
  });

  it('clamps the window', async () => {
    const articles = collectionStub({ aggregate: [[{ countries: [], categories: [] }]] });
    useDb({ articles });

    await getQueryFacets({ days: 99_999 });

    const match = (articles.aggregateCalls[0].pipeline as Array<{
      $match?: { datePublished: { $gte: Date } };
    }>)[0].$match!;
    const ageDays = (Date.now() - match.datePublished.$gte.getTime()) / 86_400_000;
    expect(ageDays).toBeLessThanOrEqual(MAX_WINDOW_DAYS + 1);
  });

  it('returns empty facets rather than throwing when the aggregation yields nothing', async () => {
    useDb({ articles: collectionStub({ aggregate: [[]] }) });
    expect(await getQueryFacets({})).toEqual({ countries: [], categories: [] });
  });

  it('returns empty facets when the read fails', async () => {
    // The controls degrade to empty selects; the page still renders.
    useDb({ articles: collectionStub({ aggregate: [new Error('no primary')] }) });
    expect(await getQueryFacets({})).toEqual({ countries: [], categories: [] });
  });
});
