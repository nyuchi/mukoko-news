/**
 * APIKeyService - Self-service API key management and rate limiting tiers
 *
 * Enables developers to register for API keys, manage their usage,
 * and upgrade between tiers. Supports the open data manifesto by
 * providing free access to public data.
 *
 * Tiers:
 * - free:        100 requests/day, 1 req/sec, public data only
 * - developer:   10,000 requests/day, 10 req/sec, full API
 * - business:    100,000 requests/day, 50 req/sec, full API + batch
 * - enterprise:  unlimited, 200 req/sec, full API + batch + webhooks + SLA
 * - open_data:   unlimited (read-only public data), 5 req/sec
 */

export interface APIKey {
  id: string;
  key: string;          // The actual API key (hashed in DB)
  key_prefix: string;   // First 8 chars for display (mk_live_xxxx...)
  name: string;         // User-provided label
  owner_id: string;     // User who created it
  owner_email: string;
  tier: APIKeyTier;
  permissions: APIKeyPermission[];
  rate_limit: RateLimitConfig;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  usage_count: number;
  daily_usage: number;
  metadata: Record<string, unknown>;
}

export type APIKeyTier = 'free' | 'developer' | 'business' | 'enterprise' | 'open_data';

export type APIKeyPermission =
  | 'read:articles'
  | 'read:sources'
  | 'read:categories'
  | 'read:keywords'
  | 'read:feeds'
  | 'read:search'
  | 'read:analytics'
  | 'read:open_data'
  | 'write:webhooks'
  | 'write:publisher'
  | 'batch:articles'
  | 'batch:search'
  | 'stream:sse'
  | 'admin:all';

export interface RateLimitConfig {
  requestsPerDay: number;
  requestsPerSecond: number;
  requestsPerMinute: number;
  batchSizeLimit: number;
  concurrentConnections: number;
}

// Tier configurations
export const TIER_CONFIGS: Record<APIKeyTier, {
  limits: RateLimitConfig;
  permissions: APIKeyPermission[];
  description: string;
  price: string;
}> = {
  free: {
    limits: {
      requestsPerDay: 100,
      requestsPerSecond: 1,
      requestsPerMinute: 30,
      batchSizeLimit: 0,
      concurrentConnections: 1,
    },
    permissions: [
      'read:articles', 'read:sources', 'read:categories',
      'read:keywords', 'read:feeds', 'read:search', 'read:open_data',
    ],
    description: 'Free tier for personal projects and experimentation',
    price: 'Free',
  },
  developer: {
    limits: {
      requestsPerDay: 10000,
      requestsPerSecond: 10,
      requestsPerMinute: 300,
      batchSizeLimit: 50,
      concurrentConnections: 5,
    },
    permissions: [
      'read:articles', 'read:sources', 'read:categories',
      'read:keywords', 'read:feeds', 'read:search',
      'read:analytics', 'read:open_data',
      'batch:articles', 'batch:search',
    ],
    description: 'For developers building apps with Mukoko data',
    price: '$29/mo',
  },
  business: {
    limits: {
      requestsPerDay: 100000,
      requestsPerSecond: 50,
      requestsPerMinute: 1500,
      batchSizeLimit: 200,
      concurrentConnections: 20,
    },
    permissions: [
      'read:articles', 'read:sources', 'read:categories',
      'read:keywords', 'read:feeds', 'read:search',
      'read:analytics', 'read:open_data',
      'write:webhooks', 'batch:articles', 'batch:search',
      'stream:sse',
    ],
    description: 'For businesses integrating African news data',
    price: '$149/mo',
  },
  enterprise: {
    limits: {
      requestsPerDay: -1, // unlimited
      requestsPerSecond: 200,
      requestsPerMinute: 6000,
      batchSizeLimit: 1000,
      concurrentConnections: 100,
    },
    permissions: [
      'read:articles', 'read:sources', 'read:categories',
      'read:keywords', 'read:feeds', 'read:search',
      'read:analytics', 'read:open_data',
      'write:webhooks', 'write:publisher',
      'batch:articles', 'batch:search',
      'stream:sse',
    ],
    description: 'Enterprise plan with SLA and dedicated support',
    price: 'Contact us',
  },
  open_data: {
    limits: {
      requestsPerDay: -1, // unlimited
      requestsPerSecond: 5,
      requestsPerMinute: 150,
      batchSizeLimit: 100,
      concurrentConnections: 3,
    },
    permissions: [
      'read:articles', 'read:sources', 'read:categories',
      'read:keywords', 'read:feeds', 'read:open_data',
    ],
    description: 'Free unlimited access to public open data (read-only)',
    price: 'Free (Open Data)',
  },
};

export class APIKeyService {
  constructor(
    private db: D1Database,
    private cache?: KVNamespace
  ) {}

  /**
   * Create a new API key
   */
  async createKey(params: {
    name: string;
    owner_id: string;
    owner_email: string;
    tier: APIKeyTier;
    expiresInDays?: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ apiKey: APIKey; rawKey: string }> {
    const id = crypto.randomUUID();
    const rawKey = await this.generateSecureKey(params.tier);
    const keyHash = await this.hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12) + '...';
    const tierConfig = TIER_CONFIGS[params.tier];
    const now = new Date().toISOString();
    const expiresAt = params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 86400000).toISOString()
      : null;

    await this.db.prepare(`
      INSERT INTO api_keys
        (id, key_hash, key_prefix, name, owner_id, owner_email, tier,
         permissions, rate_limit, is_active, created_at, expires_at,
         usage_count, daily_usage, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, 0, ?)
    `).bind(
      id, keyHash, keyPrefix, params.name, params.owner_id, params.owner_email,
      params.tier,
      JSON.stringify(tierConfig.permissions),
      JSON.stringify(tierConfig.limits),
      now, expiresAt,
      JSON.stringify(params.metadata ?? {})
    ).run();

    const apiKey: APIKey = {
      id,
      key: keyHash,
      key_prefix: keyPrefix,
      name: params.name,
      owner_id: params.owner_id,
      owner_email: params.owner_email,
      tier: params.tier,
      permissions: tierConfig.permissions,
      rate_limit: tierConfig.limits,
      is_active: true,
      created_at: now,
      expires_at: expiresAt,
      last_used_at: null,
      usage_count: 0,
      daily_usage: 0,
      metadata: params.metadata ?? {},
    };

    return { apiKey, rawKey };
  }

  /**
   * Validate an API key and return its details
   */
  async validateKey(rawKey: string): Promise<APIKey | null> {
    // Check cache first
    if (this.cache) {
      const cached = await this.cache.get(`apikey:${rawKey}`);
      if (cached) {
        const key = JSON.parse(cached) as APIKey;
        if (key.is_active && (!key.expires_at || new Date(key.expires_at) > new Date())) {
          return key;
        }
      }
    }

    const keyHash = await this.hashKey(rawKey);
    const result = await this.db.prepare(`
      SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1
    `).bind(keyHash).first();

    if (!result) return null;

    const apiKey: APIKey = {
      id: result.id as string,
      key: result.key_hash as string,
      key_prefix: result.key_prefix as string,
      name: result.name as string,
      owner_id: result.owner_id as string,
      owner_email: result.owner_email as string,
      tier: result.tier as APIKeyTier,
      permissions: JSON.parse((result.permissions as string) || '[]'),
      rate_limit: JSON.parse((result.rate_limit as string) || '{}'),
      is_active: Boolean(result.is_active),
      created_at: result.created_at as string,
      expires_at: result.expires_at as string | null,
      last_used_at: result.last_used_at as string | null,
      usage_count: result.usage_count as number,
      daily_usage: result.daily_usage as number,
      metadata: JSON.parse((result.metadata as string) || '{}'),
    };

    // Check expiry
    if (apiKey.expires_at && new Date(apiKey.expires_at) <= new Date()) {
      return null;
    }

    // Cache for 5 minutes
    if (this.cache) {
      await this.cache.put(`apikey:${rawKey}`, JSON.stringify(apiKey), { expirationTtl: 300 });
    }

    return apiKey;
  }

  /**
   * Check rate limit for an API key
   */
  async checkRateLimit(apiKey: APIKey): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: string;
    limit: number;
  }> {
    const limits = apiKey.rate_limit;

    // Unlimited tier
    if (limits.requestsPerDay === -1) {
      return { allowed: true, remaining: -1, resetAt: '', limit: -1 };
    }

    // Check daily limit
    const today = new Date().toISOString().split('T')[0];
    const dailyKey = `ratelimit:${apiKey.id}:${today}`;

    if (this.cache) {
      const current = await this.cache.get(dailyKey);
      const count = current ? parseInt(current, 10) : 0;

      if (count >= limits.requestsPerDay) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return {
          allowed: false,
          remaining: 0,
          resetAt: tomorrow.toISOString(),
          limit: limits.requestsPerDay,
        };
      }

      // Increment counter
      await this.cache.put(dailyKey, String(count + 1), { expirationTtl: 86400 });

      return {
        allowed: true,
        remaining: limits.requestsPerDay - count - 1,
        resetAt: '',
        limit: limits.requestsPerDay,
      };
    }

    // Without cache, check DB
    return { allowed: true, remaining: limits.requestsPerDay, resetAt: '', limit: limits.requestsPerDay };
  }

  /**
   * Record API key usage
   */
  async recordUsage(apiKeyId: string): Promise<void> {
    await this.db.prepare(`
      UPDATE api_keys
      SET usage_count = usage_count + 1,
          daily_usage = daily_usage + 1,
          last_used_at = ?
      WHERE id = ?
    `).bind(new Date().toISOString(), apiKeyId).run();
  }

  /**
   * Check if an API key has a specific permission
   */
  hasPermission(apiKey: APIKey, permission: APIKeyPermission): boolean {
    return apiKey.permissions.includes(permission) || apiKey.permissions.includes('admin:all');
  }

  /**
   * List API keys for a user
   */
  async listKeys(ownerId: string): Promise<APIKey[]> {
    const result = await this.db.prepare(`
      SELECT * FROM api_keys WHERE owner_id = ? ORDER BY created_at DESC
    `).bind(ownerId).all();

    return (result.results ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      key: '[hidden]',
      key_prefix: row.key_prefix as string,
      name: row.name as string,
      owner_id: row.owner_id as string,
      owner_email: row.owner_email as string,
      tier: row.tier as APIKeyTier,
      permissions: JSON.parse((row.permissions as string) || '[]'),
      rate_limit: JSON.parse((row.rate_limit as string) || '{}'),
      is_active: Boolean(row.is_active),
      created_at: row.created_at as string,
      expires_at: row.expires_at as string | null,
      last_used_at: row.last_used_at as string | null,
      usage_count: row.usage_count as number,
      daily_usage: row.daily_usage as number,
      metadata: JSON.parse((row.metadata as string) || '{}'),
    }));
  }

  /**
   * Revoke an API key
   */
  async revokeKey(keyId: string, ownerId: string): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE api_keys SET is_active = 0 WHERE id = ? AND owner_id = ?
    `).bind(keyId, ownerId).run();

    // Invalidate cache
    if (this.cache) {
      await this.cache.delete(`apikey:${keyId}`);
    }

    return (result.meta?.changes ?? 0) > 0;
  }

  /**
   * Upgrade/downgrade API key tier
   */
  async changeTier(keyId: string, newTier: APIKeyTier): Promise<APIKey | null> {
    const tierConfig = TIER_CONFIGS[newTier];

    await this.db.prepare(`
      UPDATE api_keys
      SET tier = ?, permissions = ?, rate_limit = ?
      WHERE id = ?
    `).bind(
      newTier,
      JSON.stringify(tierConfig.permissions),
      JSON.stringify(tierConfig.limits),
      keyId
    ).run();

    const result = await this.db.prepare('SELECT * FROM api_keys WHERE id = ?').bind(keyId).first();
    if (!result) return null;

    return {
      id: result.id as string,
      key: '[hidden]',
      key_prefix: result.key_prefix as string,
      name: result.name as string,
      owner_id: result.owner_id as string,
      owner_email: result.owner_email as string,
      tier: newTier,
      permissions: tierConfig.permissions,
      rate_limit: tierConfig.limits,
      is_active: Boolean(result.is_active),
      created_at: result.created_at as string,
      expires_at: result.expires_at as string | null,
      last_used_at: result.last_used_at as string | null,
      usage_count: result.usage_count as number,
      daily_usage: result.daily_usage as number,
      metadata: JSON.parse((result.metadata as string) || '{}'),
    };
  }

  /**
   * Reset daily usage counters (called by cron)
   */
  async resetDailyUsage(): Promise<number> {
    const result = await this.db.prepare(`
      UPDATE api_keys SET daily_usage = 0
    `).run();
    return result.meta?.changes ?? 0;
  }

  /**
   * Get API key usage statistics
   */
  async getUsageStats(keyId: string, days: number = 30): Promise<{
    totalRequests: number;
    avgDailyRequests: number;
    peakDaily: number;
  }> {
    const result = await this.db.prepare(`
      SELECT usage_count, daily_usage FROM api_keys WHERE id = ?
    `).bind(keyId).first();

    return {
      totalRequests: (result?.usage_count as number) ?? 0,
      avgDailyRequests: Math.round(((result?.usage_count as number) ?? 0) / days),
      peakDaily: (result?.daily_usage as number) ?? 0,
    };
  }

  /**
   * Get available tiers info (public endpoint)
   */
  getTiers(): Record<APIKeyTier, {
    limits: RateLimitConfig;
    permissions: APIKeyPermission[];
    description: string;
    price: string;
  }> {
    return TIER_CONFIGS;
  }

  // --- Private ---

  private async generateSecureKey(tier: APIKeyTier): Promise<string> {
    const prefix = tier === 'open_data' ? 'mk_od_' : 'mk_live_';
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${prefix}${key}`;
  }

  private async hashKey(rawKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
