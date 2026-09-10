/**
 * A stand-in for the MongoDB driver surface the `src/lib/mongodb/*` readers use.
 *
 * There is no database in CI, and these readers are where the app's real risk
 * lives: every article the site serves is shaped here. Mocking at the driver
 * seam (rather than at the module boundary) is what lets a test assert on the
 * QUERY that was issued — the projection, the sort key, the filter — which is
 * the half of these functions that costs money and uptime when it regresses.
 *
 * Lives under `__tests__/` so it stays out of the coverage denominator; it is a
 * fixture, not shippable code.
 */

import { vi, type Mock } from 'vitest';

export type Rows = unknown[];

/** One `find(filter, options)` call plus whatever was chained onto its cursor. */
export interface FindCall {
  filter: unknown;
  options: unknown;
  sort?: unknown;
  skip?: number;
  limit?: number;
  maxTimeMS?: number;
  /** Convenience: the projection the caller passed in `options`. */
  projection: unknown;
}

export interface AggregateCall {
  pipeline: unknown[];
  options?: unknown;
}

export interface CountCall {
  filter: unknown;
  options: unknown;
}

export interface CollectionStub {
  find: Mock;
  findOne: Mock;
  aggregate: Mock;
  countDocuments: Mock;
  estimatedDocumentCount: Mock;
  distinct: Mock;
  findCalls: FindCall[];
  aggregateCalls: AggregateCall[];
  countCalls: CountCall[];
}

/**
 * A queue entry is either the rows the call resolves with, or an Error the call
 * rejects with — so a test can drive the fail-soft path of one specific query
 * without disabling the rest of the collection.
 *
 * A queue with a single entry repeats it for every call; a longer queue is
 * consumed in order. That keeps the common case ("this collection always
 * answers X") terse without hiding call counts from a test that cares.
 */
type QueueEntry = Rows | Error;

interface CollectionSpec {
  /** Results for successive `find(...).toArray()` calls, in order. */
  find?: QueueEntry[];
  /** Results for successive `findOne(...)` calls, in order. */
  findOne?: Array<unknown | Error>;
  /** Results for successive `aggregate(...).toArray()` calls, in order. */
  aggregate?: QueueEntry[];
  /** Result of `countDocuments`. */
  count?: number | Error;
  /** Result of `estimatedDocumentCount`. */
  estimated?: number | Error;
  distinct?: unknown[];
}

function nextFrom<T>(queue: T[] | undefined, fallback: T): T {
  if (!queue || queue.length === 0) return fallback;
  return queue.length === 1 ? queue[0] : (queue.shift() as T);
}

function settle(value: unknown): Promise<unknown> {
  return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
}

export function collectionStub(spec: CollectionSpec = {}): CollectionStub {
  const findQueue = spec.find ? [...spec.find] : undefined;
  const findOneQueue = spec.findOne ? [...spec.findOne] : undefined;
  const aggregateQueue = spec.aggregate ? [...spec.aggregate] : undefined;

  const stub: CollectionStub = {
    findCalls: [],
    aggregateCalls: [],
    countCalls: [],
    find: vi.fn(),
    findOne: vi.fn(),
    aggregate: vi.fn(),
    countDocuments: vi.fn(),
    estimatedDocumentCount: vi.fn(),
    distinct: vi.fn(async () => spec.distinct ?? []),
  };

  stub.find.mockImplementation((filter: unknown, options: unknown) => {
    const record: FindCall = {
      filter,
      options,
      projection: (options as { projection?: unknown } | undefined)?.projection,
    };
    stub.findCalls.push(record);
    const result = nextFrom<QueueEntry>(findQueue, []);
    const cursor: Record<string, unknown> = {
      sort: vi.fn((s: unknown) => ((record.sort = s), cursor)),
      skip: vi.fn((n: number) => ((record.skip = n), cursor)),
      limit: vi.fn((n: number) => ((record.limit = n), cursor)),
      maxTimeMS: vi.fn((n: number) => ((record.maxTimeMS = n), cursor)),
      toArray: vi.fn(() => settle(result)),
    };
    return cursor;
  });

  stub.findOne.mockImplementation((filter: unknown) => {
    stub.findCalls.push({ filter, options: undefined, projection: undefined });
    return settle(nextFrom<unknown | Error>(findOneQueue, null));
  });

  stub.aggregate.mockImplementation((pipeline: unknown[], options?: unknown) => {
    stub.aggregateCalls.push({ pipeline, options });
    const result = nextFrom<QueueEntry>(aggregateQueue, []);
    return { toArray: vi.fn(() => settle(result)) };
  });

  stub.countDocuments.mockImplementation((filter: unknown, options: unknown) => {
    stub.countCalls.push({ filter, options });
    return settle(spec.count ?? 0);
  });

  stub.estimatedDocumentCount.mockImplementation(() => settle(spec.estimated ?? 0));

  return stub;
}

/**
 * Build a `db` object over named collection stubs. Any collection a reader asks
 * for that the test did not declare answers empty, so a test only has to
 * describe the queries it cares about.
 */
export function dbStub(collections: Record<string, CollectionStub>) {
  return {
    collection: vi.fn((name: string) => {
      if (!collections[name]) collections[name] = collectionStub();
      return collections[name];
    }),
  };
}
