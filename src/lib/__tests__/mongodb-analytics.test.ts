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
  ENRICHMENT_SCAN_LIMIT,
  __resetCountryTokenCache,
} from '../mongodb/analytics';
import { getDb, getDomainDb } from '../mongodb/client';
import { collectionStub, dbStub, type CollectionStub } from './helpers/mongo';

vi.mock('../mongodb/client', () => ({
  getDb: vi.fn(),
  getDomainDb: vi.fn(),
  QUERY_MAX_TIME_MS: 15000,
}));

/**
 * The `places` SSOT, as the topic filter reads it.
 *
 * Countries are no longer a list in `analytics.ts` — they are a read from
 * `places.placesGeo`, including the `altNames` alias layer. A suite that does
 * not stub this exercises the FALLBACK, not the real path, so it must be
 * explicit about which one it is testing. `usePlaces(null)` is the outage.
 */
function usePlaces(
  countries: Array<{ isoCode: string; name: string; altNames?: string[] }> | null
) {
  if (countries === null) {
    vi.mocked(getDomainDb).mockRejectedValue(new Error('places unreachable') as never);
    return;
  }
  vi.mocked(getDomainDb).mockResolvedValue(
    dbStub({
      placesGeo: collectionStub({ find: [countries.map((c) => ({ ...c, geoType: 'country' }))] }),
    }) as unknown as never
  );
}

const LIVE_COUNTRIES = [
  { isoCode: 'NG', name: 'Nigeria' },
  { isoCode: 'ZA', name: 'South Africa' },
  { isoCode: 'SN', name: 'Senegal', altNames: ['S\u00e9n\u00e9gal'] },
  { isoCode: 'CI', name: "Cote d'Ivoire", altNames: ["C\u00f4te d'Ivoire", 'Ivory Coast'] },
  { isoCode: 'GN', name: 'Guinea', altNames: ['Guin\u00e9e'] },
];

function useDb(collections: Record<string, CollectionStub>) {
  vi.mocked(getDb).mockResolvedValue(dbStub(collections) as unknown as never);
  return collections;
}

/** One `$searchMeta` row, with only the facets a test cares about filled in. */
function metaRow(over: Record<string, unknown> = {}) {
  return {
    count: { total: 200 },
    facet: {
      day: { buckets: [] },
      source: { buckets: [] },
      country: { buckets: [] },
      category: { buckets: [] },
      keyword: { buckets: [] },
      sentiment: { buckets: [] },
      ...over,
    },
  };
}

/** One `$facet` row from the bounded deep pass. */
function deepRow(over: Record<string, unknown> = {}) {
  return { read: [{ n: 200 }], ...over };
}

/** The shape the compound builder produces, as the assertions read it. */
type SearchCompound = {
  filter: Array<Record<string, { path: string; gte?: Date; lt?: Date; value?: string[] }>>;
  mustNot: Array<{ text: { path: string; query: string } }>;
  must?: Array<{ text: { query: string; path: string[] } }>;
};

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
    // A zero total short-circuits: every panel is empty by construction rather
    // than by each one happening to be, so a half-built result cannot leak out.
    const empty = { ...metaRow(), count: { total: 0 } };
    useDb({ articles: collectionStub({ aggregate: [[empty], [deepRow({ read: [] })]] }) });

    const result = await runCorpusQuery({});

    expect(result.total).toBe(0);
    expect(result.series).toEqual([]);
    expect(result.bySource).toEqual([]);
    expect(result.sample).toEqual([]);
  });

  it('survives an aggregation that returns no rows at all', async () => {
    useDb({ articles: collectionStub({ aggregate: [[], []] }) });
    expect((await runCorpusQuery({})).total).toBe(0);
  });
});

describe('runCorpusQuery — where the filters go', () => {
  // This is the suite that exists because of the 2026-09-14 outage. Every
  // query on the console timed out, and the cause was placement, not logic:
  // the filters sat in a `$match` AFTER `$search`, so Atlas scored the whole
  // index and fetched every hit before anything narrowed it (10,321 ms on a
  // real query), while the no-term path fetched 42,061 documents to evaluate
  // one unindexed field (18,971 ms). Both are past ANALYTICS_TIMEOUT_MS, so
  // both rendered the fail-soft empty result. A filter that drifts back out of
  // the compound reintroduces exactly that, silently and only at scale — which
  // is why this is asserted structurally rather than left to a timing test.

  function compoundFor(params: Parameters<typeof runCorpusQuery>[0]) {
    const articles = collectionStub({ aggregate: [[metaRow()], [deepRow()]] });
    useDb({ articles });
    return runCorpusQuery(params).then(() => {
      const stage = (articles.aggregateCalls[0].pipeline as Array<{
        $searchMeta: { facet: { operator: { compound: SearchCompound } } };
      }>)[0];
      return stage.$searchMeta.facet.operator.compound;
    });
  }

  it('puts the date window in the compound filter, never in a later $match', async () => {
    const { filter } = await compoundFor({ from: '2026-08-01', to: '2026-08-10' });
    const range = filter.find((f) => 'range' in f)?.range;
    expect(range?.path).toBe('datePublished');
    // `to` is an inclusive calendar day: an exclusive upper bound silently
    // drops the most recent day from every chart.
    expect(range?.gte?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(range?.lt?.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('hides rejected and removed articles with mustNot, which is what $ne means', async () => {
    // `mustNot` excludes the value AND keeps documents where the field is
    // absent. A `filter` clause would drop every article that has never been
    // moderated — which is all of them.
    const { mustNot } = await compoundFor({});
    expect(mustNot.map((m) => m.text.path)).toEqual(['status', 'moderationStatus']);
    expect(mustNot.map((m) => m.text.query)).toEqual(['rejected', 'removed']);
  });

  it('filters country on the article’s own countryCode, with no feedSources join', async () => {
    const { filter } = await compoundFor({ countries: ['zw', 'NG'] });
    expect(filter).toContainEqual({ in: { path: 'countryCode', value: ['ZW', 'NG'] } });
  });

  it('carries source, category, sentiment and quality into the compound', async () => {
    const { filter } = await compoundFor({
      sources: ['src-1'],
      categories: ['Health'],
      sentiments: ['positive'],
      minQuality: 0.5,
    });
    expect(filter).toContainEqual({ in: { path: 'feedSourceId', value: ['src-1'] } });
    expect(filter).toContainEqual({
      in: { path: 'engagement.interest_categories', value: ['health'] },
    });
    expect(filter).toContainEqual({ in: { path: 'aiSentiment', value: ['positive'] } });
    expect(filter).toContainEqual({ range: { path: 'qualityScore', gte: 0.5 } });
  });

  it('omits a filter entirely when it was not asked for', async () => {
    // An `in` with an empty value list matches nothing, so an empty filter that
    // is still emitted turns "no filter" into "no results".
    const { filter } = await compoundFor({});
    expect(filter.map((f) => Object.values(f)[0].path)).toEqual(['datePublished']);
  });

  it('puts the term in must, against the analyzed paths, with no fuzzy expansion', async () => {
    // Fuzzy matching was removed, not forgotten. On the live index it expanded
    // "accidents in Zimbabwe" into junk terms — `accio`, `accis`, `accèd`, and
    // soft-hyphen `zim­babw` — that matched noise and cost most of the 10 s.
    const { must } = await compoundFor({ q: 'cyclone' });
    expect(must).toEqual([
      { text: { query: 'cyclone', path: ['headline', 'description', 'articleBodyProcessed'] } },
    ]);
  });
});

describe('runCorpusQuery — index selection', () => {
  function callsFor(params: Parameters<typeof runCorpusQuery>[0]) {
    const articles = collectionStub({ aggregate: [[metaRow()], [deepRow()]] });
    useDb({ articles });
    return runCorpusQuery(params).then((result) => ({ result, calls: articles.aggregateCalls }));
  }

  it('counts on articles_insights when there is no term', async () => {
    const { calls, result } = await callsFor({});
    const stage = (calls[0].pipeline as Array<{ $searchMeta: { index: string } }>)[0];
    expect(stage.$searchMeta.index).toBe('articles_insights');
    expect(result.exact).toBe(true);
    expect(result.usedSearchIndex).toBe(false);
  });

  it('counts on articles_text_search when there is a term, and says so', async () => {
    const { calls, result } = await callsFor({ q: 'cyclone' });
    const stage = (calls[0].pipeline as Array<{ $searchMeta: { index: string } }>)[0];
    expect(stage.$searchMeta.index).toBe('articles_text_search');
    expect(result.exact).toBe(true);
    expect(result.usedSearchIndex).toBe(true);
  });

  it('asks for an exact total, not the default lower bound', async () => {
    // An approximate headline figure printed beside exact per-bucket counts
    // reads as a bug, and the two would not add up.
    const { calls } = await callsFor({});
    const stage = (calls[0].pipeline as Array<{ $searchMeta: { count: unknown } }>)[0];
    expect(stage.$searchMeta.count).toEqual({ type: 'total' });
  });

  it('gives the day facet one more boundary than the window has days', async () => {
    // A date facet keys each bucket by its LOWER boundary, so N days need N+1
    // edges. One short and the last day of every chart is missing.
    const { calls } = await callsFor({ from: '2026-08-01', to: '2026-08-10' });
    const stage = (calls[0].pipeline as Array<{
      $searchMeta: { facet: { facets: { day: { boundaries: Date[] } } } };
    }>)[0];
    expect(stage.$searchMeta.facet.facets.day.boundaries).toHaveLength(11);
  });

  it('skips the facet pass entirely when no index can express the query', async () => {
    // A term needs the analyzed text; a category needs the enrichment fields;
    // no single index has both. Rather than silently dropping whichever filter
    // does not fit, the deep pass answers alone and the result says it is not
    // counted over the whole match.
    const articles = collectionStub({ aggregate: [[deepRow({ read: [{ n: 7 }] })]] });
    useDb({ articles });

    const result = await runCorpusQuery({ q: 'cyclone', categories: ['health'] });

    expect(articles.aggregateCalls).toHaveLength(1);
    expect(articles.aggregateCalls[0].pipeline[0]).toHaveProperty('$search');
    expect(result.exact).toBe(false);
    expect(result.total).toBe(7);
  });
});

describe('runCorpusQuery — the bounded deep pass', () => {
  function deepPipelineFor(params: Parameters<typeof runCorpusQuery>[0] = {}) {
    const articles = collectionStub({ aggregate: [[metaRow()], [deepRow()]] });
    useDb({ articles });
    return runCorpusQuery(params).then(
      () => articles.aggregateCalls[1].pipeline as Array<Record<string, unknown>>
    );
  }

  it('bounds the id lookup immediately after $search', async () => {
    // `$limit` placed after the `$match` would not help: Atlas materialises
    // every `$search` hit before any later stage sees it, and that fetch is
    // what took 17.6 of the 19 seconds. The bound has to come first.
    const pipeline = await deepPipelineFor();
    expect(pipeline[0]).toHaveProperty('$search');
    expect(pipeline[1]).toEqual({ $limit: ENRICHMENT_SCAN_LIMIT });
  });

  it('still applies the query in MQL, so a sampled article passed every filter', async () => {
    // The compound is a fast approximation; this `$match` is the query's truth,
    // and it is what keeps a removed article out of the sample list — the one
    // place a human would actually be shown one.
    const pipeline = await deepPipelineFor({ categories: ['health'] });
    const match = (pipeline[2] as { $match: Record<string, unknown> }).$match;
    expect(match).toMatchObject({
      status: { $ne: 'rejected' },
      moderationStatus: { $ne: 'removed' },
    });
    expect((match as Record<string, { $in: RegExp[] }>)['engagement.interest_categories'].$in)
      .toEqual([/^health$/i]);
  });

  it('clamps the sample limit before it reaches the pipeline', async () => {
    const articles = collectionStub({ aggregate: [[metaRow()], [deepRow()]] });
    useDb({ articles });

    await runCorpusQuery({ sampleLimit: 100_000 });

    expect(JSON.stringify(articles.aggregateCalls[1].pipeline)).toContain('"$limit":100');
  });
});

describe('runCorpusQuery — result shaping', () => {
  const meta = metaRow({
    day: { buckets: [{ _id: new Date('2026-08-02T00:00:00.000Z'), count: 3 }] },
    source: { buckets: [{ _id: 'src-1', count: 120 }] },
    country: {
      buckets: [
        { _id: 'ZW', count: 120 },
        { _id: '', count: 5 },
      ],
    },
    category: { buckets: [{ _id: 'politics', count: 50 }] },
    keyword: {
      buckets: [
        { _id: 'load shedding', count: 30 },
        { _id: 'zimbabwe', count: 29 },
        { _id: 'a', count: 28 },
      ],
    },
    sentiment: {
      buckets: [
        { _id: 'positive', count: 10 },
        { _id: 'negative', count: 30 },
      ],
    },
  });

  const deep = deepRow({
    read: [{ n: 150 }],
    byEntity: [
      { _id: { name: 'ZESA', type: 'ORGANIZATION' }, count: 12 },
      { _id: { name: 'news', type: 'ORGANIZATION' }, count: 11 },
    ],
    byAuthor: [{ _id: 'Herald Reporter', count: 8 }],
    bylineCovered: [{ n: 30 }],
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

  async function run(overMeta: Record<string, unknown> = {}, overDeep: Record<string, unknown> = {}) {
    useDb({
      articles: collectionStub({
        // `overMeta` names FACETS, which live under `.facet` — spreading it at
        // the top level silently left the original facet in place.
        aggregate: [
          [{ ...meta, facet: { ...meta.facet, ...overMeta } }],
          [{ ...deep, ...overDeep }],
        ],
      }),
      feedSources: collectionStub({ find: [[{ _id: 'src-1', name: 'The Herald', countryCode: 'ZW' }]] }),
    });
    return runCorpusQuery({ from: '2026-08-01', to: '2026-08-03' });
  }

  it('reads the daily series off the date facet and zero-fills the quiet days', async () => {
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

  it('takes a source’s country from the source record, not from one article', async () => {
    // The old pipeline used `$first: '$countryCode'` over the grouped
    // articles — the same answer, reached by reading every document.
    expect((await run()).bySource[0].country).toBe('ZW');
  });

  it('falls back to the raw id when a source row has gone', async () => {
    useDb({
      articles: collectionStub({ aggregate: [[meta], [deep]] }),
      feedSources: collectionStub({ find: [[]] }),
    });
    const result = await runCorpusQuery({ from: '2026-08-01', to: '2026-08-03' });
    expect(result.bySource[0].name).toBe('src-1');
  });

  it('drops a blank country bucket rather than labelling it', async () => {
    const result = await run();
    expect(result.byCountry.map((c) => c.code)).toEqual(['ZW']);
  });

  it('drops boilerplate and country tokens from the topic ranking', async () => {
    const result = await run();
    expect(result.byKeyword.map((k) => k.term)).toEqual(['load shedding']);
  });

  it('reports enriched-subset coverage against what it actually read, not the total', async () => {
    // The facets counted the whole match (200); the deep pass read 150
    // documents. Reporting 90 quality scores as a share of 200 would understate
    // coverage by whatever the scan bound cut off — on a 42,000-article window
    // that is the difference between "96% of what we read" and "4%".
    const result = await run();
    expect(result.deepScanned).toBe(150);
    expect(result.quality).toMatchObject({ avg: 0.765, covered: 90, coverage: 60 });
    expect(result.bylineCoverage).toEqual({ covered: 30, coverage: 20 });
  });

  it('reports sentiment against the full total when the facet counted it', async () => {
    // Sentiment comes from the index on this path, so it covers the whole
    // match and its denominator is the total — unlike quality, which cannot be
    // averaged by a facet at all.
    const result = await run();
    expect(result.sentiment).toMatchObject({ positive: 10, negative: 30, covered: 40, coverage: 20 });
  });

  it('reports zero coverage — not a missing key — when nothing is enriched', async () => {
    const result = await run({ sentiment: { buckets: [] } }, { quality: [], bylineCovered: [] });
    expect(result.sentiment).toMatchObject({ covered: 0, coverage: 0 });
    expect(result.quality).toEqual({ avg: 0, covered: 0, coverage: 0 });
  });

  it('normalises a sample row that is missing every optional field', async () => {
    // Enrichment lands minutes after ingestion, so the newest articles carry
    // none of it; the sample table must render them rather than throw.
    const result = await run({}, { sample: [{ _id: 'bare' }] });
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
      articles: collectionStub({
        aggregate: [[metaRow({ source: { buckets: [] } })], [deepRow({ sample: [] })]],
      }),
      feedSources,
    });

    await runCorpusQuery({});

    expect(feedSources.findCalls).toHaveLength(0);
  });
});

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

/**
 * `runCorpusPreview` — the ANONYMOUS reader's panels.
 *
 * It had no direct coverage at all, which is how both bugs below reached
 * production and stayed there: every suite in this file exercised
 * `runCorpusQuery`, the signed-in path, and the preview quietly diverged from
 * it. Each test here fails against the code as it shipped.
 */
describe('runCorpusPreview', () => {
  // The token memo is module-level, so a stub set here is ignored unless the
  // previous suite's answer is cleared first.
  beforeEach(() => {
    __resetCountryTokenCache();
  });

  const previewMeta = (over: Record<string, unknown> = {}) =>
    collectionStub({ aggregate: [[metaRow(over)]] });

  it('drops country names from Topics, in every spelling the corpus carries', async () => {
    // The alias layer is present, i.e. the real production path.
    usePlaces(LIVE_COUNTRIES);
    // The counts are the live ones measured on the cluster 2026-09-23.
    useDb({
      articles: previewMeta({
        keyword: {
          buckets: [
            { _id: 'Nigeria', count: 6184 },
            { _id: 'South Africa', count: 2871 },
            { _id: 'Sénégal', count: 1213 },
            { _id: "Côte d'Ivoire", count: 727 },
            { _id: 'Guinée', count: 531 },
            { _id: 'football', count: 1609 },
            { _id: 'Bola Tinubu', count: 1544 },
          ],
        },
      }),
      feedSources: collectionStub({ find: [[]] }),
      newsMediaOrganizations: collectionStub({ find: [[]] }),
    });

    const { runCorpusPreview } = await import('../mongodb/analytics');
    const preview = await runCorpusPreview({});

    // Not one country, under any spelling — the `byCountry` panel beside it
    // already answers "where", so these are the same answer printed twice.
    expect(preview.byKeyword?.map((k) => k.term)).toEqual(['football', 'Bola Tinubu']);
  });

  it('reports a withheld facet as null, never as an empty result', async () => {
    usePlaces(LIVE_COUNTRIES);
    // A text term routes to `articles_text_search`, which maps no category,
    // keyword or sentiment path — so `buildMetaFacets` never asks for them and
    // `$searchMeta` returns no such facet. `[]` here would render as
    // "No data for this query", a claim about the corpus we did not measure.
    useDb({
      articles: collectionStub({
        aggregate: [[{ count: { total: 200 }, facet: { day: { buckets: [] }, source: { buckets: [] }, country: { buckets: [] } } }]],
      }),
      feedSources: collectionStub({ find: [[]] }),
      newsMediaOrganizations: collectionStub({ find: [[]] }),
    });

    const { runCorpusPreview } = await import('../mongodb/analytics');
    const preview = await runCorpusPreview({ q: 'election' });

    expect(preview.byKeyword).toBeNull();
    expect(preview.byCategory).toBeNull();
    expect(preview.sentiment).toBeNull();
    // The panels it CAN answer are still arrays, so null is specific to the
    // withheld facets rather than a blanket failure signal.
    expect(Array.isArray(preview.byCountry)).toBe(true);
  });

  it('still returns an empty array when the facet was asked for and had no rows', async () => {
    usePlaces(LIVE_COUNTRIES);
    // The other half of the distinction: this one IS a finding about the
    // corpus, and must not be confused with the withheld case above.
    useDb({
      articles: previewMeta({ keyword: { buckets: [] } }),
      feedSources: collectionStub({ find: [[]] }),
      newsMediaOrganizations: collectionStub({ find: [[]] }),
    });

    const { runCorpusPreview } = await import('../mongodb/analytics');
    const preview = await runCorpusPreview({});

    expect(preview.byKeyword).toEqual([]);
    expect(preview.byKeyword).not.toBeNull();
  });

  it('degrades to English-only country names when places is unreachable', async () => {
    /*
     * The documented fallback, pinned so it cannot silently become something
     * else. A `places` outage must NOT make the filter a no-op — that would put
     * the whole country list back into Topics, which is the bug this closes.
     * It falls back to the same static list the country picker uses, which
     * carries English names only, so foreign spellings survive until `places`
     * is readable again. A smaller, legible loss rather than an unfiltered panel.
     */
    usePlaces(null);
    useDb({
      articles: previewMeta({
        keyword: {
          buckets: [
            { _id: 'Nigeria', count: 6184 },
            { _id: 'Guin\u00e9e', count: 531 },
            { _id: 'football', count: 1609 },
          ],
        },
      }),
      feedSources: collectionStub({ find: [[]] }),
      newsMediaOrganizations: collectionStub({ find: [[]] }),
    });

    const { runCorpusPreview } = await import('../mongodb/analytics');
    const preview = await runCorpusPreview({});

    // Nigeria still filtered (English name is in the static list); Guinée is
    // not, because the alias layer lives in `places` and `places` is down.
    expect(preview.byKeyword?.map((k) => k.term)).toEqual(['Guin\u00e9e', 'football']);
  });
});
