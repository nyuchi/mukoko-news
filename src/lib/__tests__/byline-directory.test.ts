import { describe, it, expect, vi, beforeEach } from 'vitest';

import { collectionStub, dbStub, type CollectionStub } from './helpers/mongo';

vi.mock('@/lib/mongodb/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mongodb/client')>(
    '@/lib/mongodb/client'
  );
  return { ...actual, getDb: vi.fn() };
});

import { getDb } from '@/lib/mongodb/client';
import {
  lookupBylineIdentity,
  publishBylineDirectory,
  BYLINE_DIRECTORY_COLLECTION,
} from '@/lib/mongodb/byline-directory';

const ROW = {
  _id: 'abubakar-ibrahim',
  slug: 'abubakar-ibrahim',
  name: 'Abubakar Ibrahim',
  variants: ['Abubakar Ibrahim'],
  articles: 323,
  newsroomIds: ['org-joy'],
  desk: false,
  generation: '2026-09-19T00:00:00.000Z',
};

const IDENTITY = {
  slug: 'staff-reporter',
  name: 'Staff Reporter',
  variants: ['Staff Reporter'],
  articles: 198,
  newsroomIds: ['org-herald'],
  desk: true,
};

function mount(spec: Parameters<typeof collectionStub>[0]): CollectionStub {
  const directory = collectionStub(spec);
  vi.mocked(getDb).mockResolvedValue(
    dbStub({ [BYLINE_DIRECTORY_COLLECTION]: directory }) as never
  );
  return directory;
}

/**
 * The snapshot layer behind `/author`, and specifically the distinction the
 * byline outage was caused by losing: an empty answer is three different
 * situations, and only one of them is a statement about a journalist.
 */
describe('byline directory snapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('lookup', () => {
    it('resolves a slug with a point lookup on _id, not a scan', async () => {
      // The entire reason this collection exists: `_id` IS the slug, so the
      // read is covered by the one index every collection has. A `find` with a
      // filter on some other field would be a scan of 5,448 rows per page view.
      const directory = mount({ findOne: [ROW] });

      const result = await lookupBylineIdentity('abubakar-ibrahim');

      expect(result).toEqual({
        status: 'ok',
        identity: {
          slug: ROW.slug,
          name: ROW.name,
          variants: ROW.variants,
          articles: ROW.articles,
          newsroomIds: ROW.newsroomIds,
          desk: ROW.desk,
        },
      });
      expect(directory.findCalls[0].filter).toEqual({ _id: 'abubakar-ibrahim' });
      expect(directory.aggregate).not.toHaveBeenCalled();
    });

    it('folds the URL segment before looking it up', async () => {
      // The slug arrives from a URL and is a user-controlled key. Folding it
      // means a differently-cased or accented address lands on the stored row
      // rather than missing and 404ing a real byline.
      const directory = mount({ findOne: [ROW] });

      await lookupBylineIdentity('Abubakar  Ibrahim');

      expect(directory.findCalls[0].filter).toEqual({ _id: 'abubakar-ibrahim' });
    });

    it('answers not-found when the slug is absent but the snapshot has rows', async () => {
      // We looked, in a directory that demonstrably has contents. That is the
      // one situation in which claiming "no such byline" is sound.
      mount({ findOne: [null], estimated: 5448 });

      await expect(lookupBylineIdentity('nobody')).resolves.toEqual({ status: 'not-found' });
    });

    it('answers UNAVAILABLE when the snapshot is empty, never not-found', async () => {
      // A cron that has never fired, a fresh environment, a dropped collection
      // — all look exactly like "this platform has no bylines". Rendering that
      // as a 404 over a named journalist is the original outage, reproduced.
      mount({ findOne: [null], estimated: 0 });

      await expect(lookupBylineIdentity('abubakar-ibrahim')).resolves.toEqual({
        status: 'unavailable',
      });
    });

    it('answers unavailable when the read itself throws', async () => {
      mount({ findOne: [new Error('connection timed out')] });

      await expect(lookupBylineIdentity('abubakar-ibrahim')).resolves.toEqual({
        status: 'unavailable',
      });
    });

    it('rejects a slug that folds to nothing without touching the database', async () => {
      // Punctuation addresses no byline. That is a finding about the URL, so it
      // is not-found — and it must not cost a round trip to establish.
      const directory = mount({});

      await expect(lookupBylineIdentity('///')).resolves.toEqual({ status: 'not-found' });
      expect(directory.findOne).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('upserts every byline and only then sweeps the previous build', async () => {
      // Ordering is the correctness property: until the sweep runs, a reader
      // sees either a new row or the last build's row. Deleting first would
      // open a window where every author page answers `unavailable`.
      const directory = mount({ deleteMany: { deletedCount: 7 } });

      const outcome = await publishBylineDirectory([IDENTITY], true);

      expect(outcome.published).toBe(true);
      expect(outcome.removed).toBe(7);
      expect(directory.bulkWrite.mock.invocationCallOrder[0]).toBeLessThan(
        directory.deleteMany.mock.invocationCallOrder[0]
      );

      const [op] = directory.bulkWriteCalls[0].operations as Array<{
        replaceOne: { filter: unknown; replacement: { generation: string }; upsert: boolean };
      }>;
      expect(op.replaceOne.filter).toEqual({ _id: 'staff-reporter' });
      expect(op.replaceOne.upsert).toBe(true);
      // The sweep is keyed on the generation this build stamped, so it removes
      // exactly what this build did not write.
      expect(directory.deleteManyCalls[0]).toEqual({
        generation: { $ne: op.replaceOne.replacement.generation },
      });
    });

    it('refuses to publish when the source read failed', async () => {
      // A failed corpus read and an empty corpus both arrive as `[]`. Writing
      // the first one would delete every byline on the platform.
      const directory = mount({});

      const outcome = await publishBylineDirectory([], false);

      expect(outcome).toMatchObject({ published: false, reason: 'source-unavailable' });
      expect(directory.bulkWrite).not.toHaveBeenCalled();
      expect(directory.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses an empty build over a populated snapshot', async () => {
      const directory = mount({ estimated: 5448 });

      const outcome = await publishBylineDirectory([], true);

      expect(outcome).toMatchObject({ published: false, reason: 'empty-build' });
      expect(directory.deleteMany).not.toHaveBeenCalled();
    });

    it('allows an empty build when the snapshot is empty too', async () => {
      // A genuinely empty corpus is allowed to publish an empty directory —
      // the guard is against DESTROYING a working one, not against emptiness.
      const directory = mount({ estimated: 0 });

      const outcome = await publishBylineDirectory([], true);

      expect(outcome.published).toBe(true);
      expect(directory.deleteMany).toHaveBeenCalled();
    });

    it('chunks a large build rather than issuing one unbounded bulkWrite', async () => {
      const many = Array.from({ length: 2500 }, (_, i) => ({
        ...IDENTITY,
        slug: `byline-${i}`,
      }));
      const directory = mount({});

      await publishBylineDirectory(many, true);

      expect(directory.bulkWriteCalls).toHaveLength(3);
      expect(directory.bulkWriteCalls[0].operations).toHaveLength(1000);
      expect(directory.bulkWriteCalls[2].operations).toHaveLength(500);
    });
  });
});
