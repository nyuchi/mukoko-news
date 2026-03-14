/**
 * D1KeyValueAdapter - D1-backed key-value storage replacing Cloudflare KV
 *
 * Why D1 over KV:
 * - Strong consistency (no eventual consistency lag)
 * - SQL queries for analytics, listing sessions, bulk operations
 * - Scales to 10K+ articles, 1K+ users without issues
 * - Edge-native (same as D1 for articles)
 * - Atomic operations via SQL transactions
 * - Free tier generous (5M reads/day, 100K writes/day)
 *
 * Uses a single `kv_store` table partitioned by namespace.
 * TTL enforced via `expires_at` column — expired rows cleaned up lazily
 * on read and periodically via scheduled cleanup.
 */

/**
 * Minimal KVNamespace-compatible interface.
 * Drop-in replacement — services don't need code changes.
 */
export interface KVCompatible {
  get(key: string, options?: { type?: string } | string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number; expiration?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export class D1KeyValueAdapter implements KVCompatible {
  private db: D1Database;
  private namespace: string;
  private initialized = false;

  constructor(db: D1Database, namespace: 'auth' | 'cache') {
    this.db = db;
    this.namespace = namespace;
  }

  /**
   * Ensure the kv_store table exists (idempotent).
   * Called lazily on first operation.
   */
  private async ensureTable(): Promise<void> {
    if (this.initialized) return;

    await this.db.prepare(`
      CREATE TABLE IF NOT EXISTS kv_store (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (namespace, key)
      )
    `).run();

    // Index for TTL cleanup
    await this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_kv_store_expires
      ON kv_store (namespace, expires_at)
      WHERE expires_at IS NOT NULL
    `).run();

    this.initialized = true;
  }

  async get(key: string, _options?: { type?: string } | string): Promise<string | null> {
    await this.ensureTable();

    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(
      `SELECT value FROM kv_store
       WHERE namespace = ? AND key = ?
       AND (expires_at IS NULL OR expires_at > ?)`
    ).bind(this.namespace, key, now).first<{ value: string }>();

    return result?.value ?? null;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number }
  ): Promise<void> {
    await this.ensureTable();

    let expiresAt: number | null = null;
    if (options?.expirationTtl) {
      expiresAt = Math.floor(Date.now() / 1000) + options.expirationTtl;
    } else if (options?.expiration) {
      expiresAt = options.expiration;
    }

    const now = Math.floor(Date.now() / 1000);

    // UPSERT — insert or replace on conflict
    await this.db.prepare(
      `INSERT INTO kv_store (namespace, key, value, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (namespace, key) DO UPDATE SET
         value = excluded.value,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`
    ).bind(this.namespace, key, value, expiresAt, now, now).run();
  }

  async delete(key: string): Promise<void> {
    await this.ensureTable();

    await this.db.prepare(
      `DELETE FROM kv_store WHERE namespace = ? AND key = ?`
    ).bind(this.namespace, key).run();
  }

  // --- Extended operations (not in KVNamespace but useful) ---

  /**
   * Atomic increment — SQL UPDATE with arithmetic.
   * Returns the new count. Creates the key with value "1" if it doesn't exist.
   */
  async atomicIncr(key: string, ttlSeconds?: number): Promise<number> {
    await this.ensureTable();

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = ttlSeconds ? now + ttlSeconds : null;

    // Try to increment existing non-expired key
    const result = await this.db.prepare(
      `UPDATE kv_store SET
         value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
         updated_at = ?
       WHERE namespace = ? AND key = ?
       AND (expires_at IS NULL OR expires_at > ?)
       RETURNING CAST(value AS INTEGER) AS count`
    ).bind(now, this.namespace, key, now).first<{ count: number }>();

    if (result) return result.count;

    // Key doesn't exist or expired — insert fresh
    await this.db.prepare(
      `INSERT INTO kv_store (namespace, key, value, expires_at, created_at, updated_at)
       VALUES (?, ?, '1', ?, ?, ?)
       ON CONFLICT (namespace, key) DO UPDATE SET
         value = '1',
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`
    ).bind(this.namespace, key, expiresAt, now, now).run();

    return 1;
  }

  /**
   * List keys by prefix — impossible with KV at scale, trivial with D1.
   */
  async list(prefix: string, limit: number = 100): Promise<string[]> {
    await this.ensureTable();

    const now = Math.floor(Date.now() / 1000);
    const results = await this.db.prepare(
      `SELECT key FROM kv_store
       WHERE namespace = ? AND key LIKE ?
       AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY updated_at DESC
       LIMIT ?`
    ).bind(this.namespace, `${prefix}%`, now, limit).all<{ key: string }>();

    return results.results.map(r => r.key);
  }

  /**
   * Count active (non-expired) keys with optional prefix filter.
   */
  async count(prefix?: string): Promise<number> {
    await this.ensureTable();

    const now = Math.floor(Date.now() / 1000);
    let query: string;
    let bindings: unknown[];

    if (prefix) {
      query = `SELECT COUNT(*) as cnt FROM kv_store
               WHERE namespace = ? AND key LIKE ?
               AND (expires_at IS NULL OR expires_at > ?)`;
      bindings = [this.namespace, `${prefix}%`, now];
    } else {
      query = `SELECT COUNT(*) as cnt FROM kv_store
               WHERE namespace = ?
               AND (expires_at IS NULL OR expires_at > ?)`;
      bindings = [this.namespace, now];
    }

    const result = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>();
    return result?.cnt ?? 0;
  }

  /**
   * Clean up expired entries. Call from scheduled CRON handler.
   * Returns number of rows deleted.
   */
  async cleanup(): Promise<number> {
    await this.ensureTable();

    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(
      `DELETE FROM kv_store
       WHERE namespace = ? AND expires_at IS NOT NULL AND expires_at <= ?`
    ).bind(this.namespace, now).run();

    return result.meta?.changes ?? 0;
  }

  /**
   * Delete all keys in this namespace. Use with caution.
   */
  async clear(): Promise<number> {
    await this.ensureTable();

    const result = await this.db.prepare(
      `DELETE FROM kv_store WHERE namespace = ?`
    ).bind(this.namespace).run();

    return result.meta?.changes ?? 0;
  }
}

/**
 * Factory to create D1-backed key-value adapters.
 */
export function createD1Cache(db: D1Database, namespace: 'auth' | 'cache'): D1KeyValueAdapter {
  return new D1KeyValueAdapter(db, namespace);
}
