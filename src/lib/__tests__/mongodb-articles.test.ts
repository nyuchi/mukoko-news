/**
 * `src/lib/mongodb/articles.ts` is the single most load-bearing module in the
 * app: every article the site renders is read and shaped here, and the file
 * carries a long tail of hard-won, *invisible* invariants — a projection that
 * keeps article bodies off a metered mobile connection, a `popular` rail that
 * deliberately refuses to sort in MongoDB, a keyset cursor whose second key
 * exists because timestamps collide.
 *
 * None of that is expressible in a type, and all of it looks like something a
 * future edit would "tidy up". These tests pin the rules rather than the
 * implementation, and each says what breaks in production if it regresses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getArticles,
  getArticleById,
  getArticleBySlug,
  getRelatedArticles,
  getNewsByteArticles,
  searchArticles,
  getSavedArticles,
  getTopicTimeline,
} from '../mongodb/articles';
import { getDb } from '../mongodb/client';
import { collectionStub, dbStub, type CollectionStub } from './helpers/mongo';

vi.mock('../mongodb/client', () => ({
  getDb: vi.fn(),
  QUERY_MAX_TIME_MS: 15000,
}));

/**
 * The list projection every feed/search/related read must carry. Written out
 * here rather than imported so that *deleting a key from the module* fails this
 * test instead of silently agreeing with it.
 */
const LIST_PROJECTION = {
  embedding: 0,
  articleBody: 0,
  articleBodyProcessed: 0,
  articleBodyMarkdown: 0,
};

function articleDoc(over: Record<string, unknown> = {}) {
  return {
    _id: 'a1',
    feedSourceId: 'src-1',
    headline: 'Cyclone warning issued for Manicaland',
    slug: 'cyclone-warning',
    externalUrl: 'https://herald.co.zw/cyclone',
    createdAt: new Date('2026-09-01T06:00:00.000Z'),
    updatedAt: new Date('2026-09-01T07:00:00.000Z'),
    datePublished: new Date('2026-09-01T06:30:00.000Z'),
    ...over,
  };
}

function sourceDoc(over: Record<string, unknown> = {}) {
  return { _id: 'src-1', name: 'The Herald', countryCode: 'ZW', ...over };
}

function useDb(collections: Record<string, CollectionStub>) {
  vi.mocked(getDb).mockResolvedValue(dbStub(collections) as unknown as never);
  return collections;
}

beforeEach(() => {
  vi.mocked(getDb).mockReset();
});

// ───────────────────────────────────────────────────────────────────────────
// The projection invariant
// ───────────────────────────────────────────────────────────────────────────

describe('LIST_PROJECTION — article bodies never ship in a list response', () => {
  /**
   * If this regresses, every feed request pulls `embedding` (1024 floats) plus
   * three full renditions of the article body for every card on screen. That is
   * a data bill for a reader on an African mobile network and a server-side
   * FETCH cost measured at 50s for 20,000 documents. It is also completely
   * invisible in the UI, which is why it needs a test.
   */
  it('is applied by the latest feed read', async () => {
    const articles = collectionStub({ find: [[articleDoc()]] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    await getArticles({ limit: 5 });

    expect(articles.findCalls[0].projection).toEqual(LIST_PROJECTION);
  });

  it('is applied by the popular rail, the newsbytes rail, saves and the topic timeline', async () => {
    for (const run of [
      () => getArticles({ sort: 'popular' }),
      () => getNewsByteArticles(5),
      () => getSavedArticles('user:123'),
      () => getTopicTimeline('zimbabwe-elections'),
    ]) {
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({
        articles,
        feedSources: collectionStub({ find: [[sourceDoc()]] }),
        articleSaves: collectionStub({ find: [[{ articleId: 'a1' }]] }),
      });
      await run();
      expect(articles.findCalls[0].projection).toEqual(LIST_PROJECTION);
    }
  });

  it('is NOT applied to the single-article reads, which are the one page that needs the body', async () => {
    const articles = collectionStub({ findOne: [articleDoc({ articleBody: '<p>Full text</p>' })] });
    useDb({ articles, feedSources: collectionStub({ findOne: [sourceDoc()] }) });

    const article = await getArticleById('a1');

    expect(articles.findCalls[0].projection).toBeUndefined();
    expect(article?.content).toBe('Full text');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// toArticle — document → Article mapping
// ───────────────────────────────────────────────────────────────────────────

describe('toArticle', () => {
  async function mapOne(doc: Record<string, unknown>, source = sourceDoc()) {
    const articles = collectionStub({ findOne: [doc] });
    useDb({ articles, feedSources: collectionStub({ findOne: [source] }) });
    return getArticleById(String(doc._id ?? 'a1'));
  }

  async function mapInList(doc: Record<string, unknown>) {
    const articles = collectionStub({ find: [[doc]] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });
    const { articles: mapped } = await getArticles({ limit: 5 });
    return mapped[0];
  }

  it('keeps the body out of a LIST item even if the projection is bypassed', async () => {
    // Belt and braces with the projection above: `LIST_PROJECTION` stops the
    // fields being read, this stops them being serialised if they ever are.
    // The comment above this line in the source once described the intent while
    // the code did the opposite — 20 full article bodies shipped on every feed.
    const item = await mapInList(
      articleDoc({ articleBodyProcessed: '<p>body</p>', articleBodyMarkdown: '# body' })
    );
    expect(item.content).toBeUndefined();
    expect(item.content_markdown).toBeUndefined();
  });

  it('prefers the sanitised body over the raw one and strips its HTML', async () => {
    const article = await mapOne(
      articleDoc({ articleBodyProcessed: '<p>Sanitised</p>', articleBody: '<script>raw</script>' })
    );
    expect(article?.content).toBe('Sanitised');
  });

  it('falls back to the source id when the feed source cannot be resolved', async () => {
    // A source row can be missing (retired duplicate, id drift). Rendering the
    // raw id is ugly; rendering `undefined` in a byline slot is a broken card.
    const articles = collectionStub({ findOne: [articleDoc()] });
    useDb({ articles, feedSources: collectionStub({ findOne: [null] }) });
    const article = await getArticleById('a1');
    expect(article?.source).toBe('src-1');
    expect(article?.country).toBeUndefined();
  });

  it('falls back to createdAt when the publisher gave no publication date', async () => {
    const article = await mapOne(articleDoc({ datePublished: undefined }));
    expect(article?.published_at).toBe('2026-09-01T06:00:00.000Z');
  });

  describe('image resolution across the shapes the pipeline has written', () => {
    it.each([
      ['schema.org array', { image: [{ url: 'https://cdn/a.jpg' }] }],
      ['schema.org object', { image: { url: 'https://cdn/a.jpg' } }],
      ['bare string', { image: 'https://cdn/a.jpg' }],
      ['flat imageUrl', { imageUrl: 'https://cdn/a.jpg' }],
      ['flat image_url', { image_url: 'https://cdn/a.jpg' }],
    ])('reads %s', async (_label, shape) => {
      // Five collectors across five pipeline versions wrote five shapes. Drop
      // one and that era of the corpus renders imageless cards forever.
      const article = await mapOne(articleDoc(shape));
      expect(article?.image_url).toBe('https://cdn/a.jpg');
    });

    it('yields undefined rather than null when there is no image at all', async () => {
      const article = await mapOne(articleDoc({ image: [] }));
      expect(article?.image_url).toBeUndefined();
    });
  });

  describe('category resolution', () => {
    it('uses the AI-classified interest category', async () => {
      const article = await mapOne(
        articleDoc({ engagement: { interest_categories: ['politics'] } })
      );
      expect(article?.category).toBe('politics');
    });

    it('reads a label off an object-shaped entry', async () => {
      const article = await mapOne(
        articleDoc({ engagement: { interest_categories: [{ slug: 'health' }] } })
      );
      expect(article?.category).toBe('health');
    });

    it('DROPS a legacy articleSection of "general"', async () => {
      // Both collectors hardcode `articleSection: "general"` at ingestion, so
      // surfacing it badges every un-enriched article "General" — the
      // "everything is general" symptom. An un-enriched article is the common
      // case, so this branch runs constantly.
      const article = await mapOne(articleDoc({ articleSection: 'General' }));
      expect(article?.category).toBeUndefined();
    });

    it('keeps a legacy articleSection that carries real signal', async () => {
      const article = await mapOne(articleDoc({ articleSection: 'Business' }));
      expect(article?.category).toBe('Business');
    });
  });

  describe('keyword resolution', () => {
    it('maps string tags and object tags onto the same shape', async () => {
      const article = await mapOne(
        articleDoc({ engagement: { tags: ['drought', { slug: 'zesa', name: 'ZESA' }] } })
      );
      expect(article?.keywords).toEqual([
        { id: 'drought', name: 'drought', slug: 'drought' },
        { id: 'zesa', name: 'ZESA', slug: 'zesa' },
      ]);
    });

    it('returns undefined — not an empty array — when nothing survives', async () => {
      // An empty array renders an empty tag rail with padding; undefined
      // renders nothing.
      const article = await mapOne(articleDoc({ engagement: { tags: ['  ', {}] } }));
      expect(article?.keywords).toBeUndefined();
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getArticles — the feed
// ───────────────────────────────────────────────────────────────────────────

describe('getArticles (latest)', () => {
  it('fetches limit + 1 and answers hasMore from the extra row, with no count at all', async () => {
    // "Is there another page" is answered exactly and for free by the extra
    // row. The alternative — countDocuments over two `$ne`s — COLLSCANs, and is
    // the call that took the site down on 2026-09-10.
    const docs = Array.from({ length: 6 }, (_, i) =>
      articleDoc({ _id: `a${i}`, datePublished: new Date(Date.UTC(2026, 8, 10 - i)) })
    );
    const articles = collectionStub({ find: [docs] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const result = await getArticles({ limit: 5 });

    expect(articles.findCalls[0].limit).toBe(6);
    expect(result.articles).toHaveLength(5);
    expect(result.hasMore).toBe(true);
    expect(result.total).toBeNull();
    expect(articles.countDocuments).not.toHaveBeenCalled();
  });

  it('emits no cursor on the last page', async () => {
    const articles = collectionStub({ find: [[articleDoc()]] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const result = await getArticles({ limit: 5 });

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('sorts on datePublished ALONE, never {datePublished, _id}', async () => {
    // Adding `_id` to the sort key looks more correct and is catastrophic: no
    // index carries `_id` within `datePublished` order, so the planner drops
    // the streaming SORT_MERGE and blocks on a sort over most of the
    // collection. Measured: that variant did not finish inside 60 seconds.
    const articles = collectionStub({ find: [[articleDoc()]] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    await getArticles({ limit: 5 });

    expect(articles.findCalls[0].sort).toEqual({ datePublished: -1 });
  });

  it('bounds the read server-side with maxTimeMS', async () => {
    // The driver's socket timeout is the LAST line of defence, not the first:
    // when it fires the server keeps executing the query anyway. maxTimeMS is
    // what actually abandons the work at the source.
    const articles = collectionStub({ find: [[articleDoc()]] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    await getArticles({ limit: 5 });

    expect(articles.findCalls[0].maxTimeMS).toBe(15000);
  });

  it('excludes rejected and removed articles from every read', async () => {
    const articles = collectionStub({ find: [[articleDoc()]] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    await getArticles({});

    expect(articles.findCalls[0].filter).toMatchObject({
      status: { $ne: 'rejected' },
      moderationStatus: { $ne: 'removed' },
    });
  });

  describe('keyset cursor', () => {
    const cursorFor = (publishedAt: string, id: string) =>
      Buffer.from(`${publishedAt}|${id}`, 'utf8').toString('base64url');

    it('keeps same-timestamp siblings with an id tie-break branch', async () => {
      // ~6% of recent articles share a timestamp with another article. A bare
      // `$lt` on the timestamp would silently drop every one of those siblings
      // at each page boundary — articles that exist and are simply never shown.
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      await getArticles({ cursor: cursorFor('2026-09-01T06:30:00.000Z', 'a1') });

      const filter = articles.findCalls[0].filter as { $or: unknown[] };
      expect(filter.$or).toEqual([
        { datePublished: { $lt: new Date('2026-09-01T06:30:00.000Z') } },
        { datePublished: new Date('2026-09-01T06:30:00.000Z'), _id: { $lt: 'a1' } },
      ]);
    });

    it('never skips when reading from a cursor', async () => {
      // Skipping as well as seeking would drop a page's worth of articles on
      // every scroll — the two paging schemes are mutually exclusive.
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      await getArticles({ cursor: cursorFor('2026-09-01T06:30:00.000Z', 'a1'), page: 9 });

      expect(articles.findCalls[0].skip).toBe(0);
    });

    it('falls back to offset paging when no cursor is supplied', async () => {
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      await getArticles({ limit: 10, page: 3 });

      expect(articles.findCalls[0].skip).toBe(20);
    });

    it('ignores a malformed cursor rather than throwing at a reader', async () => {
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      await getArticles({ cursor: 'not-a-cursor' });

      expect(articles.findCalls[0].filter).not.toHaveProperty('$or');
    });
  });

  describe('filters', () => {
    it('filters on the AI-classified categories, case-insensitively and anchored', async () => {
      // Anchoring matters: an unanchored regex makes "health" match
      // "mental-health" and "public-health", so a nav tab returns a superset of
      // its own category.
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      await getArticles({ category: 'health' });

      const filter = articles.findCalls[0].filter as Record<string, RegExp>;
      expect(filter['engagement.interest_categories']).toEqual(/^health$/i);
      expect(filter).not.toHaveProperty('articleSection');
    });

    it('escapes regex metacharacters in a caller-supplied category', async () => {
      // These slugs arrive from the query string. An unescaped `.*` would match
      // every category, and a `(` would throw a SyntaxError at request time.
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      await getArticles({ category: 'a.*b(' });

      const filter = articles.findCalls[0].filter as Record<string, RegExp>;
      expect(filter['engagement.interest_categories'].source).toBe('^a\\.\\*b\\($');
    });

    it('prefers the multi-category filter over the single one', async () => {
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      await getArticles({ categories: ['health', 'sport'], category: 'ignored' });

      const filter = articles.findCalls[0].filter as Record<string, { $in: RegExp[] }>;
      expect(filter['engagement.interest_categories'].$in).toEqual([/^health$/i, /^sport$/i]);
    });

    it('resolves a country filter through feedSources rather than guessing', async () => {
      const feedSources = collectionStub({
        find: [[{ _id: 'src-1' }, { _id: 'src-9' }], [sourceDoc()]],
      });
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources });

      await getArticles({ countries: ['ZW'] });

      expect(feedSources.findCalls[0].filter).toEqual({ countryCode: { $in: ['ZW'] } });
      expect(articles.findCalls[0].filter).toMatchObject({
        feedSourceId: { $in: ['src-1', 'src-9'] },
      });
    });
  });

  describe('withTotal', () => {
    it('caps the count and only runs it when asked', async () => {
      // Even capped at 5,000 this costs ~9.4s, because the scan reads 5,000 fat
      // documents to test two `$ne`s. Nothing in the UI renders the number.
      const articles = collectionStub({ find: [[articleDoc()]], count: 5000 });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      const result = await getArticles({ withTotal: true });

      expect(result.total).toBe(5000);
      expect(articles.countCalls[0].options).toMatchObject({ limit: 5000, maxTimeMS: 15000 });
    });

    it('reports null — not a plausible-looking guess — when it was not asked for', async () => {
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      expect((await getArticles({})).total).toBeNull();
    });
  });

  describe('limit and page clamping', () => {
    it('clamps an unbounded limit before it reaches the driver', async () => {
      // Server Actions clamp already; this is the defensive second layer for
      // every other call path into the module.
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      await getArticles({ limit: 100000 });

      expect(articles.findCalls[0].limit).toBe(101); // MAX_LIMIT (100) + 1
    });

    it('clamps a negative page to the first page', async () => {
      const articles = collectionStub({ find: [[articleDoc()]] });
      useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

      await getArticles({ page: -5 });

      expect(articles.findCalls[0].skip).toBe(0);
    });
  });
});

describe('getArticles (popular)', () => {
  const pool = [
    articleDoc({ _id: 'low', qualityScore: 0.2, datePublished: new Date('2026-09-03') }),
    articleDoc({ _id: 'unenriched', datePublished: new Date('2026-09-04') }),
    articleDoc({ _id: 'high', qualityScore: 0.9, datePublished: new Date('2026-09-01') }),
  ];

  it('does NOT ask MongoDB to sort by qualityScore', async () => {
    // `{qualityScore: -1, datePublished: -1}` has no index behind it, so it
    // plans as COLLSCAN → blocking in-memory SORT and did not finish inside 60s
    // over a 14-day window. The rail reads a recent pool on the index instead
    // and ranks it in application code, where sorting 200 objects is free.
    const articles = collectionStub({ find: [pool] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    await getArticles({ sort: 'popular' });

    expect(articles.findCalls[0].sort).toEqual({ datePublished: -1 });
    expect(articles.findCalls[0].limit).toBe(200);
  });

  it('ranks the pool by quality, breaking ties on recency', async () => {
    const articles = collectionStub({ find: [pool] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const result = await getArticles({ sort: 'popular' });

    expect(result.articles.map((a) => a.id)).toEqual(['high', 'low', 'unenriched']);
  });

  it('ranks an un-enriched article last instead of dropping it', async () => {
    // No qualityScore means unranked, not bad. Dropping them would make the
    // rail silently exclude everything the pipeline has not reached yet — and
    // the newest articles are exactly the ones it has not reached.
    const articles = collectionStub({ find: [pool] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const result = await getArticles({ sort: 'popular' });

    expect(result.articles.map((a) => a.id)).toContain('unenriched');
  });

  it('reports the pool size as an exact total and never emits a cursor', async () => {
    // The pool IS the result set for this rail, so its size is exact. A cursor
    // over an application-side ranking would loop the client back to page one
    // forever.
    const articles = collectionStub({ find: [pool] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const result = await getArticles({ sort: 'popular', limit: 2 });

    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  it('routes `trending` down the same pooled path', async () => {
    const articles = collectionStub({ find: [pool] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const result = await getArticles({ sort: 'trending' });

    expect(result.nextCursor).toBeNull();
    expect(articles.findCalls[0].limit).toBe(200);
  });

  it('pages within the pool by offset', async () => {
    const articles = collectionStub({ find: [pool] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const result = await getArticles({ sort: 'popular', limit: 2, page: 2 });

    expect(result.articles.map((a) => a.id)).toEqual(['unenriched']);
    expect(result.hasMore).toBe(false);
  });

  it('ignores a cursor, which has no meaning over an application-side ranking', async () => {
    const articles = collectionStub({ find: [pool] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    await getArticles({
      sort: 'popular',
      cursor: Buffer.from('2026-09-01T00:00:00.000Z|a1', 'utf8').toString('base64url'),
    });

    expect(articles.findCalls[0].filter).not.toHaveProperty('$or');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Single-article reads
// ───────────────────────────────────────────────────────────────────────────

describe('getArticleById / getArticleBySlug', () => {
  it('returns null for an id that resolves to nothing', async () => {
    // The article page turns exactly this null into a 404. If it ever became a
    // throw instead, a dead id would render the outage path (HTTP 200) and stay
    // in Google's index as a thin duplicate.
    useDb({ articles: collectionStub({ findOne: [null] }) });
    expect(await getArticleById('gone')).toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    useDb({ articles: collectionStub({ findOne: [null] }) });
    expect(await getArticleBySlug('gone')).toBeNull();
  });

  it('resolves the article by slug with its source and full body', async () => {
    useDb({
      articles: collectionStub({ findOne: [articleDoc({ articleBodyMarkdown: '# Lead' })] }),
      feedSources: collectionStub({ findOne: [sourceDoc()] }),
    });

    const article = await getArticleBySlug('cyclone-warning');

    expect(article?.source).toBe('The Herald');
    expect(article?.country).toBe('ZW');
    expect(article?.content_markdown).toBe('# Lead');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Related articles
// ───────────────────────────────────────────────────────────────────────────

describe('getRelatedArticles', () => {
  it('returns an empty list when the seed article does not exist', async () => {
    useDb({ articles: collectionStub({ findOne: [null] }) });
    expect(await getRelatedArticles('gone')).toEqual([]);
  });

  it('uses Atlas Vector Search when the article carries an embedding, excluding itself', async () => {
    const articles = collectionStub({
      findOne: [articleDoc({ embedding: [0.1, 0.2] })],
      aggregate: [[articleDoc({ _id: 'a2' })]],
    });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const related = await getRelatedArticles('a1', 3);

    const pipeline = articles.aggregateCalls[0].pipeline as Array<Record<string, never>>;
    expect(pipeline[0]).toHaveProperty('$vectorSearch');
    // Self-exclusion: without it the "related" rail leads with the article the
    // reader is already on.
    expect(pipeline).toContainEqual({ $match: { _id: { $ne: 'a1' } } });
    expect(pipeline).toContainEqual({ $project: LIST_PROJECTION });
    expect(related.map((a) => a.id)).toEqual(['a2']);
  });

  it('falls back to same-source, same-section recency when there is no embedding', async () => {
    // An un-enriched article has no embedding, and un-enriched is the common
    // case for anything published in the last few minutes.
    const articles = collectionStub({
      findOne: [articleDoc({ articleSection: 'Business' })],
      find: [[articleDoc({ _id: 'a3' })]],
    });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    await getRelatedArticles('a1', 4);

    expect(articles.aggregate).not.toHaveBeenCalled();
    expect(articles.findCalls[1].filter).toMatchObject({
      _id: { $ne: 'a1' },
      feedSourceId: 'src-1',
      articleSection: 'Business',
    });
    expect(articles.findCalls[1].limit).toBe(4);
  });

  it('omits the section constraint when the article has none', async () => {
    const articles = collectionStub({ findOne: [articleDoc()], find: [[]] });
    useDb({ articles, feedSources: collectionStub({ find: [[]] }) });

    await getRelatedArticles('a1');

    expect(articles.findCalls[1].filter).not.toHaveProperty('articleSection');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Newsbytes
// ───────────────────────────────────────────────────────────────────────────

describe('getNewsByteArticles', () => {
  it('requires a short article that has an image in any of the stored shapes', async () => {
    // Newsbytes is an image-led rail: an entry with no image is a blank card.
    // The `$or` has one branch per image shape the pipeline has ever written,
    // so dropping a branch quietly empties that era of the corpus out of the rail.
    const articles = collectionStub({ find: [[articleDoc({ wordCount: 120 })]] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    await getNewsByteArticles(4);

    const filter = articles.findCalls[0].filter as { wordCount: unknown; $or: unknown[] };
    expect(filter.wordCount).toEqual({ $lte: 300 });
    expect(filter.$or).toHaveLength(5);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Search
// ───────────────────────────────────────────────────────────────────────────

describe('searchArticles', () => {
  it('leads with Atlas Search', async () => {
    const articles = collectionStub({ aggregate: [[articleDoc()]] });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const results = await searchArticles('cyclone', 10);

    const pipeline = articles.aggregateCalls[0].pipeline as Array<Record<string, never>>;
    expect(pipeline[0]).toHaveProperty('$search');
    expect(results).toHaveLength(1);
  });

  it('narrows the search with a category filter when one is supplied', async () => {
    const articles = collectionStub({ aggregate: [[]] });
    useDb({ articles, feedSources: collectionStub({ find: [[]] }) });

    await searchArticles('cyclone', 10, { category: 'weather' });

    const stage = articles.aggregateCalls[0].pipeline[0] as {
      $search: { compound: { filter: unknown[] } };
    };
    expect(stage.$search.compound.filter).toContainEqual({
      equals: { path: 'articleSection', value: 'weather' },
    });
  });

  it('degrades to a regex scan when the Atlas Search index is not active', async () => {
    // The index can be missing or still building on a fresh cluster. Search
    // returning zero results looks identical to "no matches" to a reader, so
    // the fallback is the difference between a working search box and a dead one.
    const articles = collectionStub({
      aggregate: [new Error('index not found')],
      find: [[articleDoc()]],
    });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const results = await searchArticles('cyclone', 10);

    expect(results).toHaveLength(1);
    expect(articles.findCalls[0].filter).toMatchObject({
      status: { $in: ['approved', 'published'] },
    });
    expect(articles.findCalls[0].projection).toEqual(LIST_PROJECTION);
  });

  it('escapes regex metacharacters in the fallback query', async () => {
    // The query string is reader input. `.*` unescaped matches every article,
    // and an unbalanced `(` throws a SyntaxError mid-request.
    const articles = collectionStub({ aggregate: [new Error('no index')], find: [[]] });
    useDb({ articles, feedSources: collectionStub({ find: [[]] }) });

    await searchArticles('a.*b(', 10);

    const filter = articles.findCalls[0].filter as { $or: Array<{ headline?: RegExp }> };
    expect(filter.$or[0].headline?.source).toBe('a\\.\\*b\\(');
  });

  it('post-filters by country against the sources that actually belong to it', async () => {
    const articles = collectionStub({
      aggregate: [[articleDoc({ _id: 'zw' }), articleDoc({ _id: 'ng', feedSourceId: 'src-9' })]],
    });
    // First find resolves the country's sources; second resolves display names.
    const feedSources = collectionStub({ find: [[{ _id: 'src-1' }], [sourceDoc()]] });
    useDb({ articles, feedSources });

    const results = await searchArticles('cyclone', 10, { countryCode: 'ZW' });

    expect(results.map((a) => a.id)).toEqual(['zw']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Saved articles
// ───────────────────────────────────────────────────────────────────────────

describe('getSavedArticles', () => {
  it('short-circuits without touching the articles collection when nothing is saved', async () => {
    const articles = collectionStub();
    useDb({ articles, articleSaves: collectionStub({ find: [[]] }) });

    expect(await getSavedArticles('user:1')).toEqual({ articles: [] });
    expect(articles.find).not.toHaveBeenCalled();
  });

  it('returns saves newest-first, in save order rather than publication order', async () => {
    // Mongo returns the `$in` result in storage order, so re-imposing the save
    // order here is what makes "Saved" read as a list the reader built.
    const saves = collectionStub({ find: [[{ articleId: 'b' }, { articleId: 'a' }]] });
    const articles = collectionStub({
      find: [[articleDoc({ _id: 'a' }), articleDoc({ _id: 'b' })]],
    });
    useDb({ articles, articleSaves: saves, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const result = await getSavedArticles('user:1');

    expect(result.articles.map((a) => a.id)).toEqual(['b', 'a']);
    expect(saves.findCalls[0].sort).toEqual({ createdAt: -1 });
  });

  it('drops a save whose article has since been deleted rather than emitting a hole', async () => {
    const saves = collectionStub({ find: [[{ articleId: 'a' }, { articleId: 'deleted' }]] });
    useDb({
      articles: collectionStub({ find: [[articleDoc({ _id: 'a' })]] }),
      articleSaves: saves,
      feedSources: collectionStub({ find: [[sourceDoc()]] }),
    });

    const result = await getSavedArticles('user:1');

    expect(result.articles.map((a) => a.id)).toEqual(['a']);
  });

  it('scopes the read to the caller’s own engagement subject', async () => {
    // `sessionId` is the engagement subject key — a WorkOS user or an anonymous
    // cookie. If this filter were ever dropped, one reader's saved list would
    // be everyone's.
    const saves = collectionStub({ find: [[]] });
    useDb({ articleSaves: saves });

    await getSavedArticles('user:abc');

    expect(saves.findCalls[0].filter).toEqual({ sessionId: 'user:abc' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Topic timeline
// ───────────────────────────────────────────────────────────────────────────

describe('getTopicTimeline', () => {
  it('matches a slug across every enrichment surface, in slug and spaced-name form', async () => {
    // Enrichment writes tags as bare slugs on some articles and {slug, name}
    // objects on others, and the same topic reaches an article via tags, AI
    // categories or raw keywords. Matching only one surface empties the
    // developing-story timeline for most topics.
    const articles = collectionStub({ find: [[articleDoc()]], count: 12 });
    useDb({ articles, feedSources: collectionStub({ find: [[sourceDoc()]] }) });

    const result = await getTopicTimeline('zimbabwe-elections');

    const filter = articles.findCalls[0].filter as { $or: Array<Record<string, unknown>> };
    const paths = filter.$or.map((clause) => Object.keys(clause)[0]);
    expect(paths).toEqual([
      'engagement.tags',
      'engagement.tags.slug',
      'engagement.tags.name',
      'engagement.interest_categories',
      'aiKeywords',
    ]);
    // The hyphenated slug and its spaced name form are both accepted.
    expect((filter.$or[0] as { 'engagement.tags': { $in: RegExp[] } })['engagement.tags'].$in).toEqual(
      [/^zimbabwe-elections$/i, /^zimbabwe elections$/i]
    );
    expect(result.total).toBe(12);
  });

  it('caps the window and the count so one topic page cannot scan the corpus', async () => {
    const articles = collectionStub({ find: [[]], count: 5000 });
    useDb({ articles, feedSources: collectionStub({ find: [[]] }) });

    await getTopicTimeline('drought', { days: 9999, limit: 9999 });

    expect(articles.findCalls[0].limit).toBe(100); // MAX_LIMIT
    expect(articles.countCalls[0].options).toMatchObject({ limit: 5000 });
  });

  it('escapes a hostile slug before it becomes a regex', async () => {
    const articles = collectionStub({ find: [[]], count: 0 });
    useDb({ articles, feedSources: collectionStub({ find: [[]] }) });

    await getTopicTimeline('a.*b');

    const filter = articles.findCalls[0].filter as {
      $or: Array<{ 'engagement.tags.slug'?: RegExp }>;
    };
    expect(filter.$or[1]['engagement.tags.slug']?.source).toBe('^a\\.\\*b$');
  });
});
