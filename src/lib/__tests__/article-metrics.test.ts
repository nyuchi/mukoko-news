import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const findOne = vi.fn();
const countDocuments = vi.fn();
const estimatedDocumentCount = vi.fn();

vi.mock('@/lib/mongodb/client', () => ({
  QUERY_MAX_TIME_MS: 15000,
  getDb: vi.fn(async () => ({
    collection: () => ({ findOne, countDocuments, estimatedDocumentCount }),
  })),
}));

import {
  getArticleProvenance,
  getEnrichmentCoverage,
  __resetEnrichmentCoverageCache,
} from '@/lib/mongodb/article-metrics';

/**
 * An article as the pipeline actually writes it once enrichment has run.
 * Shape taken from a live document (2026-09-10).
 */
const ENRICHED = {
  _id: 'article-1',
  aiProcessed: true,
  aiProcessedAt: new Date('2026-09-10T05:25:14.133Z'),
  qualityScore: 0.85,
  aiQualitySignals: {
    headline_quality: 0.85,
    content_depth: 0.8,
    factual_markers: 0.9,
    local_relevance: 0.9,
  },
  aiSentiment: 'neutral',
  aiKeywords: ['NADC', 'cannabis policy reform'],
  aiNamedEntities: [{ name: 'Navin Ramgoolam', type: 'PERSON', confidence: 0.98 }],
  aiSummary: 'PM Ramgoolam receives the national cannabis policy reform report.',
  ingestionMethod: 'rss_feed',
};

/**
 * The un-enriched article. This is NOT a hypothetical: 53 articles on the live
 * cluster are in exactly this state, and every one of them carries
 * `qualityScore: 0` from ingestion.
 */
const UNENRICHED = {
  _id: 'article-2',
  aiProcessed: false,
  qualityScore: 0,
  ingestionMethod: 'rss_feed',
};

describe('article provenance', () => {
  beforeEach(() => {
    __resetEnrichmentCoverageCache();
    findOne.mockReset();
    countDocuments.mockReset();
    estimatedDocumentCount.mockReset();
    estimatedDocumentCount.mockResolvedValue(63834);
    countDocuments.mockResolvedValue(63781);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for an article that does not exist', async () => {
    findOne.mockResolvedValue(null);
    expect(await getArticleProvenance('nope')).toBeNull();
  });

  it('carries the enrichment values through for an enriched article', async () => {
    findOne.mockResolvedValue(ENRICHED);
    const p = await getArticleProvenance('article-1');
    expect(p?.enriched).toBe(true);
    expect(p?.qualityScore).toBe(0.85);
    expect(p?.sentiment).toBe('neutral');
    expect(p?.keywordCount).toBe(2);
    expect(p?.namedEntityCount).toBe(1);
    expect(p?.hasSummary).toBe(true);
    expect(p?.enrichedAt).toBe('2026-09-10T05:25:14.133Z');
  });

  it('labels the four quality signals the enrichment worker writes', async () => {
    findOne.mockResolvedValue(ENRICHED);
    const p = await getArticleProvenance('article-1');
    expect(p?.qualitySignals.map((s) => s.label)).toEqual([
      'Headline quality',
      'Content depth',
      'Factual markers',
      'Local relevance',
    ]);
  });

  it('humanises an unrecognised signal rather than dropping or renaming it', async () => {
    findOne.mockResolvedValue({
      ...ENRICHED,
      aiQualitySignals: { source_reputation: 0.4 },
    });
    const p = await getArticleProvenance('article-1');
    expect(p?.qualitySignals).toEqual([
      { key: 'source_reputation', label: 'Source reputation', value: 0.4 },
    ]);
  });
});

/**
 * The absent-metric rules, which are the whole reason this module exists.
 *
 * An un-enriched article is not an edge case to be handled defensively — it is
 * a real state on the live cluster, and the ingestion default it carries would
 * render as a confident "0.00 quality" if any of these gates were dropped.
 */
describe('an absent metric is absent, never zero', () => {
  beforeEach(() => {
    __resetEnrichmentCoverageCache();
    findOne.mockReset();
    estimatedDocumentCount.mockResolvedValue(63834);
    countDocuments.mockResolvedValue(63781);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports no quality score for an un-enriched article carrying the 0 sentinel', async () => {
    findOne.mockResolvedValue(UNENRICHED);
    const p = await getArticleProvenance('article-2');
    expect(p?.enriched).toBe(false);
    expect(p?.qualityScore).toBeNull();
    expect(p?.qualityScore).not.toBe(0);
  });

  it('rejects a zero score even if the article claims to be enriched', async () => {
    // Defence in depth: the two gates are independent so neither alone can let
    // the ingestion default through as a verdict.
    findOne.mockResolvedValue({ ...ENRICHED, qualityScore: 0 });
    expect((await getArticleProvenance('article-1'))?.qualityScore).toBeNull();
  });

  it('keeps a genuinely low score — suppression is for the sentinel only', async () => {
    findOne.mockResolvedValue({ ...ENRICHED, qualityScore: 0.1 });
    expect((await getArticleProvenance('article-1'))?.qualityScore).toBe(0.1);
  });

  it('reports no sentiment, signals or counts for an un-enriched article', async () => {
    findOne.mockResolvedValue(UNENRICHED);
    const p = await getArticleProvenance('article-2');
    expect(p?.sentiment).toBeNull();
    expect(p?.qualitySignals).toEqual([]);
    expect(p?.keywordCount).toBeNull();
    expect(p?.namedEntityCount).toBeNull();
    expect(p?.hasSummary).toBe(false);
  });

  it('does not report a keyword count of zero for an un-enriched article', async () => {
    // `0 keywords` is a measurement; no enrichment run is the absence of one.
    findOne.mockResolvedValue({ ...UNENRICHED, aiKeywords: [] });
    expect((await getArticleProvenance('article-2'))?.keywordCount).toBeNull();
  });

  it('omits an absent full-text or newsdata timestamp instead of inventing one', async () => {
    findOne.mockResolvedValue(ENRICHED);
    const p = await getArticleProvenance('article-1');
    expect(p?.fulltextMethod).toBeNull();
    expect(p?.fulltextFetchedAt).toBeNull();
    expect(p?.newsdataEnhancedAt).toBeNull();
  });
});

/**
 * `linkAuditedAt` is load-bearing: an absent `spamLinkDomains` means UNMATCHED,
 * never CLEAN. 63,832 of 63,834 articles have never been audited, so getting
 * this wrong would print a false all-clear on essentially the whole corpus.
 */
describe('the outbound-link audit distinguishes unaudited from clean', () => {
  beforeEach(() => {
    __resetEnrichmentCoverageCache();
    findOne.mockReset();
    estimatedDocumentCount.mockResolvedValue(63834);
    countDocuments.mockResolvedValue(63781);
  });

  it('reports no audit at all when the article was never audited', async () => {
    findOne.mockResolvedValue(ENRICHED);
    expect((await getArticleProvenance('article-1'))?.linkAudit).toBeNull();
  });

  it('does not synthesise a clean audit from an absent spam list', async () => {
    // The trap: `spamLinkDomains` is absent on 100% of the corpus, both for
    // audited-and-clean articles and for never-audited ones.
    findOne.mockResolvedValue({ ...ENRICHED, outboundLinkCount: 3 });
    expect((await getArticleProvenance('article-1'))?.linkAudit).toBeNull();
  });

  it('reports a clean audit only when one actually ran', async () => {
    findOne.mockResolvedValue({
      ...ENRICHED,
      outboundLinkCount: 3,
      linkAuditedAt: new Date('2026-09-10T05:22:42.790Z'),
    });
    expect((await getArticleProvenance('article-1'))?.linkAudit).toEqual({
      auditedAt: '2026-09-10T05:22:42.790Z',
      outboundLinks: 3,
      spamDomains: [],
      spamReasons: [],
    });
  });

  it('carries the flagged domains and the reasons that flagged them', async () => {
    findOne.mockResolvedValue({
      ...ENRICHED,
      outboundLinkCount: 4,
      spamLinkDomains: ['yupitotocasino1.live'],
      spamLinkReasons: ['anchor-lexicon'],
      linkAuditedAt: new Date('2026-09-10T05:22:42.790Z'),
    });
    const audit = (await getArticleProvenance('article-1'))?.linkAudit;
    expect(audit?.spamDomains).toEqual(['yupitotocasino1.live']);
    expect(audit?.spamReasons).toEqual(['anchor-lexicon']);
  });

  it('reports an unknown outbound-link count as unknown, not as zero', async () => {
    findOne.mockResolvedValue({
      ...ENRICHED,
      linkAuditedAt: new Date('2026-09-10T05:22:42.790Z'),
    });
    expect((await getArticleProvenance('article-1'))?.linkAudit?.outboundLinks).toBeNull();
  });
});

describe('enrichment coverage', () => {
  beforeEach(() => {
    __resetEnrichmentCoverageCache();
    countDocuments.mockReset();
    estimatedDocumentCount.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the enriched share of the corpus to one decimal place', async () => {
    estimatedDocumentCount.mockResolvedValue(63834);
    countDocuments.mockResolvedValue(63781);
    expect(await getEnrichmentCoverage()).toEqual({
      enriched: 63781,
      total: 63834,
      percent: 99.9,
    });
  });

  it('reads the corpus once for a burst of article views', async () => {
    estimatedDocumentCount.mockResolvedValue(63834);
    countDocuments.mockResolvedValue(63781);
    await Promise.all([getEnrichmentCoverage(), getEnrichmentCoverage()]);
    await getEnrichmentCoverage();
    expect(countDocuments).toHaveBeenCalledTimes(1);
  });

  it('reports coverage as unknown rather than guessing when the count fails', async () => {
    // A caption claiming 100% because a count failed is exactly the confident
    // wrong number this module exists to avoid.
    estimatedDocumentCount.mockRejectedValue(new Error('atlas unreachable'));
    countDocuments.mockRejectedValue(new Error('atlas unreachable'));
    expect(await getEnrichmentCoverage()).toBeNull();
  });

  it('does not divide by an empty corpus', async () => {
    estimatedDocumentCount.mockResolvedValue(0);
    countDocuments.mockResolvedValue(0);
    expect(await getEnrichmentCoverage()).toBeNull();
  });
});

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

/**
 * The owner's binding constraint: verification, trust and quality have exactly
 * ONE instance and must never be copied across articles. That is a property of
 * the SHAPE of this code, not of its behaviour — a stray `updateOne` would pass
 * every behavioural test above — so it is asserted structurally, the way
 * `publisher-organizations.test.ts` asserts the same property for publishers.
 */
describe('article metrics are read, never written', () => {
  const WRITE_CALLS =
    /\.(updateOne|updateMany|insertOne|insertMany|bulkWrite|replaceOne|findOneAndUpdate|findOneAndReplace|findOneAndDelete|deleteOne|deleteMany)\(/;

  it('the metrics read module issues no writes', () => {
    expect(read('src/lib/mongodb/article-metrics.ts')).not.toMatch(WRITE_CALLS);
  });

  it('the metrics server action issues no writes', () => {
    expect(read('src/lib/actions/article-metrics.ts')).not.toMatch(WRITE_CALLS);
  });

  it('the article mapper still issues no writes', () => {
    expect(read('src/lib/mongodb/articles.ts')).not.toMatch(WRITE_CALLS);
  });

  it('adds no field to the article document', () => {
    // Everything surfaced is already on the document or derived at read time.
    // A `$set` here would be the denormalised copy the owner ruled out.
    const src = read('src/lib/mongodb/article-metrics.ts');
    expect(src).not.toContain('$set');
    expect(src).not.toContain('upsert');
  });
});
