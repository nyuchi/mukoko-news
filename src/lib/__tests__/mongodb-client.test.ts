import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { MongoClientMock, connectMock, dbMock } = vi.hoisted(() => {
  const dbMock = vi.fn(() => ({ collection: vi.fn() }));
  const connectMock = vi.fn();
  const clientInstance = { connect: connectMock, db: dbMock };
  connectMock.mockResolvedValue(clientInstance);
  // Regular function so it is constructible via `new MongoClient(...)`
  const MongoClientMock = vi.fn(function MongoClient() {
    return clientInstance;
  });
  return { MongoClientMock, connectMock, dbMock };
});

vi.mock('mongodb', () => ({ MongoClient: MongoClientMock }));

const EXPECTED_TIMEOUTS = {
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
  socketTimeoutMS: 20000,
};

function clearDevGlobalCache() {
  const g = global as typeof globalThis & { _mongoClientPromise?: unknown };
  delete g._mongoClientPromise;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  clearDevGlobalCache();
  vi.stubEnv('MONGODB_URI', 'mongodb://unit-test.example/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearDevGlobalCache();
});

describe('mongodb client fail-fast options', () => {
  it('exports the fail-fast timeout options', async () => {
    const { MONGO_CLIENT_OPTIONS } = await import('../mongodb/client');
    expect(MONGO_CLIENT_OPTIONS).toMatchObject(EXPECTED_TIMEOUTS);
  });

  it('constructs the MongoClient with the timeout options (production branch)', async () => {
    const { getDb } = await import('../mongodb/client');
    await getDb();

    expect(MongoClientMock).toHaveBeenCalledOnce();
    expect(MongoClientMock).toHaveBeenCalledWith(
      'mongodb://unit-test.example/',
      expect.objectContaining(EXPECTED_TIMEOUTS)
    );
    expect(connectMock).toHaveBeenCalledOnce();
  });

  it('constructs the MongoClient with the timeout options (development global-cache branch)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { getDb } = await import('../mongodb/client');
    await getDb();

    expect(MongoClientMock).toHaveBeenCalledOnce();
    expect(MongoClientMock).toHaveBeenCalledWith(
      'mongodb://unit-test.example/',
      expect.objectContaining(EXPECTED_TIMEOUTS)
    );
  });

  it('reuses the cached client on subsequent getDb calls', async () => {
    const { getDb } = await import('../mongodb/client');
    await getDb();
    await getDb();

    expect(MongoClientMock).toHaveBeenCalledOnce();
    expect(dbMock).toHaveBeenCalledTimes(2);
  });

  it('throws when MONGODB_URI is not set', async () => {
    vi.stubEnv('MONGODB_URI', '');
    const { getDb } = await import('../mongodb/client');
    await expect(getDb()).rejects.toThrow('MONGODB_URI environment variable is not set');
    expect(MongoClientMock).not.toHaveBeenCalled();
  });
});
