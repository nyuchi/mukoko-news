import { describe, it, expect, beforeEach, vi } from 'vitest';
import { D1KeyValueAdapter, createD1Cache } from '../../infrastructure/D1KeyValueAdapter.js';

// Mock D1Database
function createMockD1() {
  const mockResults: Record<string, any> = {};

  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
  };

  const db = {
    prepare: vi.fn().mockReturnValue(mockStatement),
    _mockStatement: mockStatement,
    _setFirstResult: (val: any) => { mockStatement.first.mockResolvedValue(val); },
    _setAllResult: (val: any) => { mockStatement.all.mockResolvedValue({ results: val }); },
    _setRunResult: (changes: number) => { mockStatement.run.mockResolvedValue({ meta: { changes } }); },
  };

  return db as any;
}

describe('D1KeyValueAdapter', () => {
  let db: ReturnType<typeof createMockD1>;
  let adapter: D1KeyValueAdapter;

  beforeEach(() => {
    db = createMockD1();
    adapter = new D1KeyValueAdapter(db, 'cache');
  });

  describe('get', () => {
    it('should return null when key does not exist', async () => {
      const result = await adapter.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return value when key exists and not expired', async () => {
      db._setFirstResult({ value: '{"foo":"bar"}' });
      const result = await adapter.get('mykey');
      expect(result).toBe('{"foo":"bar"}');
    });

    it('should pass namespace and key to query', async () => {
      await adapter.get('session:abc123');
      expect(db.prepare).toHaveBeenCalled();
      const bindCall = db._mockStatement.bind.mock.calls.find(
        (call: any[]) => call[1] === 'session:abc123'
      );
      expect(bindCall).toBeTruthy();
      expect(bindCall[0]).toBe('cache');
    });
  });

  describe('put', () => {
    it('should store a value with TTL', async () => {
      await adapter.put('mykey', 'myvalue', { expirationTtl: 3600 });
      expect(db.prepare).toHaveBeenCalled();
      expect(db._mockStatement.bind).toHaveBeenCalled();
      expect(db._mockStatement.run).toHaveBeenCalled();
    });

    it('should store a value without TTL', async () => {
      await adapter.put('mykey', 'myvalue');
      expect(db._mockStatement.run).toHaveBeenCalled();
    });

    it('should handle expiration (absolute unix timestamp)', async () => {
      const expiration = Math.floor(Date.now() / 1000) + 3600;
      await adapter.put('mykey', 'myvalue', { expiration });
      expect(db._mockStatement.bind).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a key', async () => {
      await adapter.delete('mykey');
      expect(db.prepare).toHaveBeenCalled();
      expect(db._mockStatement.bind).toHaveBeenCalledWith('cache', 'mykey');
      expect(db._mockStatement.run).toHaveBeenCalled();
    });
  });

  describe('atomicIncr', () => {
    it('should increment existing key', async () => {
      db._setFirstResult({ count: 5 });
      const result = await adapter.atomicIncr('rate:1.2.3.4', 60);
      expect(result).toBe(5);
    });

    it('should create key with value 1 if not exists', async () => {
      // First call returns null (key doesn't exist), then insert
      db._mockStatement.first.mockResolvedValueOnce(null);
      const result = await adapter.atomicIncr('rate:1.2.3.4', 60);
      expect(result).toBe(1);
    });
  });

  describe('list', () => {
    it('should list keys by prefix', async () => {
      db._setAllResult([{ key: 'session:a' }, { key: 'session:b' }]);
      const keys = await adapter.list('session:');
      expect(keys).toEqual(['session:a', 'session:b']);
    });

    it('should respect limit parameter', async () => {
      db._setAllResult([{ key: 'k1' }]);
      await adapter.list('prefix:', 10);
      expect(db._mockStatement.bind).toHaveBeenCalled();
    });
  });

  describe('count', () => {
    it('should count keys without prefix', async () => {
      db._setFirstResult({ cnt: 42 });
      const count = await adapter.count();
      expect(count).toBe(42);
    });

    it('should count keys with prefix filter', async () => {
      db._setFirstResult({ cnt: 7 });
      const count = await adapter.count('session:');
      expect(count).toBe(7);
    });
  });

  describe('cleanup', () => {
    it('should delete expired entries', async () => {
      db._setRunResult(15);
      const deleted = await adapter.cleanup();
      expect(deleted).toBe(15);
    });
  });

  describe('clear', () => {
    it('should delete all entries in namespace', async () => {
      db._setRunResult(100);
      const deleted = await adapter.clear();
      expect(deleted).toBe(100);
    });
  });

  describe('createD1Cache factory', () => {
    it('should create auth namespace adapter', () => {
      const cache = createD1Cache(db, 'auth');
      expect(cache).toBeInstanceOf(D1KeyValueAdapter);
    });

    it('should create cache namespace adapter', () => {
      const cache = createD1Cache(db, 'cache');
      expect(cache).toBeInstanceOf(D1KeyValueAdapter);
    });
  });

  describe('KV compatibility', () => {
    it('should work as a drop-in KVNamespace replacement', async () => {
      // The adapter implements get/put/delete matching KVNamespace interface
      const kv = adapter as any;
      expect(typeof kv.get).toBe('function');
      expect(typeof kv.put).toBe('function');
      expect(typeof kv.delete).toBe('function');
    });

    it('should handle JSON-stringified session data', async () => {
      const session = {
        user_id: 'u1',
        email: 'test@mukoko.com',
        role: 'admin',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };

      await adapter.put('session:tok123', JSON.stringify(session), {
        expirationTtl: 604800, // 7 days
      });

      expect(db._mockStatement.run).toHaveBeenCalled();
    });

    it('should handle rate limit counter strings', async () => {
      db._setFirstResult({ value: '5' });
      const count = await adapter.get('ratelimit:login:1.2.3.4');
      expect(count).toBe('5');
    });
  });
});
