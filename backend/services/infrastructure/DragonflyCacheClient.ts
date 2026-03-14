/**
 * DragonflyCacheClient - Redis-compatible high-performance cache
 *
 * Dragonfly is a Redis-compatible in-memory data store with 25x throughput.
 * Runs on Fly.io for low-latency caching.
 *
 * Uses HTTP API (via a lightweight Redis-HTTP bridge on Fly.io)
 * since Workers can't maintain TCP connections.
 *
 * Key use cases:
 * - API response caching (feeds, articles, categories)
 * - Rate limiting counters
 * - Session storage
 * - Real-time leaderboards (trending articles)
 * - API key validation cache
 * - Webhook delivery deduplication
 */

export interface DragonflyCacheConfig {
  httpUrl: string; // http://dragonfly-proxy.internal:6380
  authToken?: string;
  defaultTtlSeconds?: number;
  keyPrefix?: string;
}

export class DragonflyCacheClient {
  private baseUrl: string;
  private authToken?: string;
  private defaultTtl: number;
  private prefix: string;

  constructor(config: DragonflyCacheConfig) {
    this.baseUrl = config.httpUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
    this.defaultTtl = config.defaultTtlSeconds ?? 300; // 5 min default
    this.prefix = config.keyPrefix ?? 'mukoko:';
  }

  // --- Basic Operations ---

  async get<T = string>(key: string): Promise<T | null> {
    const result = await this.command<string>('GET', [this.key(key)]);
    if (result === null) return null;
    try {
      return JSON.parse(result) as T;
    } catch {
      return result as unknown as T;
    }
  }

  async set(
    key: string,
    value: unknown,
    ttlSeconds?: number
  ): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTtl;
    await this.command('SET', [this.key(key), serialized, 'EX', String(ttl)]);
  }

  async del(key: string): Promise<void> {
    await this.command('DEL', [this.key(key)]);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.command<number>('EXISTS', [this.key(key)]);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return await this.command<number>('TTL', [this.key(key)]) ?? -1;
  }

  // --- Increment/Decrement (Rate Limiting) ---

  async incr(key: string): Promise<number> {
    return await this.command<number>('INCR', [this.key(key)]) ?? 0;
  }

  async incrBy(key: string, amount: number): Promise<number> {
    return await this.command<number>('INCRBY', [this.key(key), String(amount)]) ?? 0;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.command('EXPIRE', [this.key(key), String(ttlSeconds)]);
  }

  /**
   * Atomic increment with expiry - perfect for rate limiting
   */
  async rateLimitIncr(
    key: string,
    windowSeconds: number
  ): Promise<{ count: number; ttl: number }> {
    const fullKey = this.key(key);
    // Use MULTI/EXEC for atomicity
    const results = await this.pipeline([
      ['INCR', fullKey],
      ['TTL', fullKey],
    ]);

    const count = (results[0] as number) ?? 1;
    const remainingTtl = (results[1] as number) ?? -1;

    // Set expiry only on first increment (TTL = -1 means no expiry set)
    if (remainingTtl === -1) {
      await this.command('EXPIRE', [fullKey, String(windowSeconds)]);
    }

    return { count, ttl: remainingTtl === -1 ? windowSeconds : remainingTtl };
  }

  // --- Hash Operations (Structured cache) ---

  async hget<T = string>(key: string, field: string): Promise<T | null> {
    const result = await this.command<string>('HGET', [this.key(key), field]);
    if (result === null) return null;
    try {
      return JSON.parse(result) as T;
    } catch {
      return result as unknown as T;
    }
  }

  async hset(
    key: string,
    field: string,
    value: unknown
  ): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.command('HSET', [this.key(key), field, serialized]);
  }

  async hmset(
    key: string,
    fields: Record<string, unknown>
  ): Promise<void> {
    const args = [this.key(key)];
    for (const [field, value] of Object.entries(fields)) {
      args.push(field, typeof value === 'string' ? value : JSON.stringify(value));
    }
    await this.command('HMSET', args);
  }

  async hgetall<T = Record<string, string>>(key: string): Promise<T | null> {
    return await this.command<T>('HGETALL', [this.key(key)]);
  }

  // --- Sorted Sets (Trending, Leaderboards) ---

  async zadd(
    key: string,
    score: number,
    member: string
  ): Promise<void> {
    await this.command('ZADD', [this.key(key), String(score), member]);
  }

  async zaddMulti(
    key: string,
    members: Array<{ score: number; member: string }>
  ): Promise<void> {
    const args = [this.key(key)];
    for (const { score, member } of members) {
      args.push(String(score), member);
    }
    await this.command('ZADD', args);
  }

  async zrangeWithScores(
    key: string,
    start: number,
    stop: number,
    reverse: boolean = false
  ): Promise<Array<{ member: string; score: number }>> {
    const cmd = reverse ? 'ZREVRANGE' : 'ZRANGE';
    const result = await this.command<string[]>(cmd, [
      this.key(key),
      String(start),
      String(stop),
      'WITHSCORES',
    ]);

    if (!result || !Array.isArray(result)) return [];
    const pairs: Array<{ member: string; score: number }> = [];
    for (let i = 0; i < result.length; i += 2) {
      pairs.push({ member: result[i], score: parseFloat(result[i + 1]) });
    }
    return pairs;
  }

  async zincrby(
    key: string,
    increment: number,
    member: string
  ): Promise<number> {
    const result = await this.command<string>('ZINCRBY', [
      this.key(key),
      String(increment),
      member,
    ]);
    return parseFloat(result ?? '0');
  }

  // --- List Operations (Queues) ---

  async lpush(key: string, ...values: string[]): Promise<number> {
    return await this.command<number>('LPUSH', [this.key(key), ...values]) ?? 0;
  }

  async rpop(key: string): Promise<string | null> {
    return await this.command<string>('RPOP', [this.key(key)]);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.command<string[]>('LRANGE', [this.key(key), String(start), String(stop)]) ?? [];
  }

  async llen(key: string): Promise<number> {
    return await this.command<number>('LLEN', [this.key(key)]) ?? 0;
  }

  // --- Set Operations ---

  async sadd(key: string, ...members: string[]): Promise<number> {
    return await this.command<number>('SADD', [this.key(key), ...members]) ?? 0;
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.command<number>('SISMEMBER', [this.key(key), member]);
    return result === 1;
  }

  async smembers(key: string): Promise<string[]> {
    return await this.command<string[]>('SMEMBERS', [this.key(key)]) ?? [];
  }

  // --- Pipeline (Batch commands) ---

  async pipeline(
    commands: Array<[string, ...string[]]>
  ): Promise<unknown[]> {
    return await this.request<unknown[]>('POST', '/pipeline', { commands });
  }

  // --- Cache Patterns ---

  /**
   * Cache-aside pattern: get from cache, or compute and cache
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Invalidate cache entries by pattern
   */
  async invalidatePattern(pattern: string): Promise<number> {
    const result = await this.command<string[]>('KEYS', [this.key(pattern)]);
    if (!result || result.length === 0) return 0;

    await this.command('DEL', result);
    return result.length;
  }

  // --- Health ---

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const result = await this.command<string>('PING', []);
      return { ok: result === 'PONG', latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  // --- Internal ---

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  private async command<T>(cmd: string, args: string[]): Promise<T | null> {
    return await this.request<T>('POST', '/command', { cmd, args });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new CacheError(`Cache ${method} ${path} failed (${response.status}): ${error}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}

export class CacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheError';
  }
}
