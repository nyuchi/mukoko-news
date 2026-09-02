import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The membership read is an access-control input, so what is tested here is
 * mostly what it must REFUSE to return.
 */

const mockAggregate = vi.fn();
const mockDb = {
  collection: () => ({ aggregate: (...args: unknown[]) => mockAggregate(...args) }),
};
vi.mock('mongodb', () => ({
  MongoClient: class {
    connect() {
      return Promise.resolve({ db: () => mockDb });
    }
  },
}));
vi.mock('../mongodb/client', () => ({ MONGO_CLIENT_OPTIONS: {} }));

import { getActiveMemberships, isMemberOfEntity } from '@/lib/mongodb/entity';

function rows(value: unknown[]) {
  mockAggregate.mockReturnValue({ toArray: () => Promise.resolve(value) });
}

describe('getActiveMemberships', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MONGODB_URI = 'mongodb://test';
  });

  it('filters on BOTH isActive and endedAt', async () => {
    // Neither check is redundant: on the live cluster `endedAt` is set on more
    // rows than `isActive: false` covers, so checking one alone grants access to
    // people whose membership has ended.
    rows([]);
    await getActiveMemberships('person-1');
    const pipeline = mockAggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const match = pipeline[0].$match as Record<string, unknown>;
    expect(match.personId).toBe('person-1');
    expect(match.isActive).toBe(true);
    expect(match.$or).toBeDefined();
  });

  it('resolves the organization name from the owning collection', async () => {
    rows([
      {
        entityId: 'e1',
        entityName: 'The Herald',
        entityType: 'organization',
        role: 'founder',
        title: 'Founder',
        permissions: ['herald:publish'],
        joinedAt: new Date('2026-07-14T00:00:00Z'),
      },
    ]);
    const result = await getActiveMemberships('person-1');
    expect(result).toEqual([
      {
        entityId: 'e1',
        entityName: 'The Herald',
        entityType: 'organization',
        role: 'founder',
        title: 'Founder',
        entityPermissions: ['herald:publish'],
        joinedAt: '2026-07-14T00:00:00.000Z',
      },
    ]);
  });

  it('strips reserved namespaces so an entity row cannot mint platform authority', async () => {
    // A live membership really does carry `permissions: ["platform:admin"]`, on
    // an entity with no workosOrgId to reconcile it against. `entity` is written
    // by the gateway webhook, not by this app — a slug from there must never be
    // able to name a platform power.
    rows([
      {
        entityId: 'e1',
        permissions: [
          'platform:admin',
          'mukoko:news-moderator',
          'admin',
          'SuperAdmin',
          'news:publish',
          'herald:publish',
        ],
      },
    ]);
    const [row] = await getActiveMemberships('person-1');
    expect(row.entityPermissions).toEqual(['herald:publish']);
  });

  it('returns nothing for a missing person id rather than querying', async () => {
    const result = await getActiveMemberships('');
    expect(result).toEqual([]);
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it('degrades to empty — never throws — when the read fails', async () => {
    mockAggregate.mockImplementation(() => {
      throw new Error('cluster down');
    });
    await expect(getActiveMemberships('person-1')).resolves.toEqual([]);
  });

  it('drops non-string permission entries', async () => {
    rows([{ entityId: 'e1', permissions: ['ok', 42, null, { a: 1 }] }]);
    const [row] = await getActiveMemberships('person-1');
    expect(row.entityPermissions).toEqual(['ok']);
  });
});

describe('isMemberOfEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MONGODB_URI = 'mongodb://test';
  });

  it('is false for an entity the caller does not belong to', async () => {
    rows([{ entityId: 'e1', permissions: [] }]);
    await expect(isMemberOfEntity('person-1', 'e2')).resolves.toBe(false);
  });

  it('is false when either id is missing', async () => {
    await expect(isMemberOfEntity('', 'e1')).resolves.toBe(false);
    await expect(isMemberOfEntity('person-1', '')).resolves.toBe(false);
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it('is false when the read fails, never true by default', async () => {
    mockAggregate.mockImplementation(() => {
      throw new Error('cluster down');
    });
    await expect(isMemberOfEntity('person-1', 'e1')).resolves.toBe(false);
  });
});
