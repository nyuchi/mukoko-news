import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIKeyService, TIER_CONFIGS } from '../../platform/APIKeyService.js';
import { createMockD1, createMockKV } from '../helpers.js';

describe('APIKeyService', () => {
  let service: APIKeyService;
  let db: ReturnType<typeof createMockD1>['db'];
  let statement: ReturnType<typeof createMockD1>['statement'];
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    ({ db, statement } = createMockD1());
    kv = createMockKV();
    service = new APIKeyService(
      db as unknown as D1Database,
      kv as unknown as KVNamespace
    );
  });

  describe('createKey', () => {
    it('should create a free tier API key', async () => {
      statement.first.mockResolvedValue({
        id: 'key-1',
        key_hash: 'hash',
        key_prefix: 'mk_live_xxxx...',
        name: 'My App',
        owner_id: 'user-1',
        owner_email: 'dev@example.com',
        tier: 'free',
        permissions: JSON.stringify(TIER_CONFIGS.free.permissions),
        rate_limit: JSON.stringify(TIER_CONFIGS.free.limits),
        is_active: 1,
        created_at: '2026-03-14T00:00:00Z',
        expires_at: null,
        last_used_at: null,
        usage_count: 0,
        daily_usage: 0,
        metadata: '{}',
      });

      const result = await service.createKey({
        name: 'My App',
        owner_id: 'user-1',
        owner_email: 'dev@example.com',
        tier: 'free',
      });

      expect(result.rawKey).toBeTruthy();
      expect(result.rawKey.startsWith('mk_live_')).toBe(true);
      expect(result.apiKey.tier).toBe('free');
      expect(db.prepare).toHaveBeenCalled();
    });

    it('should create an open_data tier key with od prefix', async () => {
      const result = await service.createKey({
        name: 'Research Project',
        owner_id: 'user-2',
        owner_email: 'researcher@university.ac.zw',
        tier: 'open_data',
      });

      expect(result.rawKey.startsWith('mk_od_')).toBe(true);
    });
  });

  describe('TIER_CONFIGS', () => {
    it('should have all 5 tiers defined', () => {
      expect(Object.keys(TIER_CONFIGS)).toEqual([
        'free', 'developer', 'business', 'enterprise', 'open_data',
      ]);
    });

    it('should have increasing rate limits', () => {
      expect(TIER_CONFIGS.free.limits.requestsPerDay).toBe(100);
      expect(TIER_CONFIGS.developer.limits.requestsPerDay).toBe(10000);
      expect(TIER_CONFIGS.business.limits.requestsPerDay).toBe(100000);
      expect(TIER_CONFIGS.enterprise.limits.requestsPerDay).toBe(-1); // unlimited
      expect(TIER_CONFIGS.open_data.limits.requestsPerDay).toBe(-1); // unlimited
    });

    it('should give enterprise more permissions', () => {
      const freePerms = TIER_CONFIGS.free.permissions;
      const enterprisePerms = TIER_CONFIGS.enterprise.permissions;

      expect(enterprisePerms.length).toBeGreaterThan(freePerms.length);
      expect(enterprisePerms).toContain('write:webhooks');
      expect(enterprisePerms).toContain('write:publisher');
      expect(freePerms).not.toContain('write:webhooks');
    });

    it('should not give free tier batch access', () => {
      expect(TIER_CONFIGS.free.permissions).not.toContain('batch:articles');
      expect(TIER_CONFIGS.developer.permissions).toContain('batch:articles');
    });
  });

  describe('hasPermission', () => {
    it('should check permissions correctly', () => {
      const apiKey = {
        id: '1', key: '', key_prefix: '', name: '', owner_id: '', owner_email: '',
        tier: 'free' as const,
        permissions: ['read:articles', 'read:sources'] as any[],
        rate_limit: TIER_CONFIGS.free.limits,
        is_active: true, created_at: '', expires_at: null,
        last_used_at: null, usage_count: 0, daily_usage: 0, metadata: {},
      };

      expect(service.hasPermission(apiKey, 'read:articles')).toBe(true);
      expect(service.hasPermission(apiKey, 'write:webhooks')).toBe(false);
    });

    it('should grant all permissions for admin:all', () => {
      const apiKey = {
        id: '1', key: '', key_prefix: '', name: '', owner_id: '', owner_email: '',
        tier: 'enterprise' as const,
        permissions: ['admin:all'] as any[],
        rate_limit: TIER_CONFIGS.enterprise.limits,
        is_active: true, created_at: '', expires_at: null,
        last_used_at: null, usage_count: 0, daily_usage: 0, metadata: {},
      };

      expect(service.hasPermission(apiKey, 'read:articles')).toBe(true);
      expect(service.hasPermission(apiKey, 'write:webhooks')).toBe(true);
      expect(service.hasPermission(apiKey, 'batch:articles')).toBe(true);
    });
  });

  describe('checkRateLimit', () => {
    it('should allow requests within limit', async () => {
      kv.get.mockResolvedValue('50'); // 50 of 100 used

      const apiKey = {
        id: 'key-1', key: '', key_prefix: '', name: '', owner_id: '', owner_email: '',
        tier: 'free' as const,
        permissions: [] as any[],
        rate_limit: TIER_CONFIGS.free.limits,
        is_active: true, created_at: '', expires_at: null,
        last_used_at: null, usage_count: 0, daily_usage: 0, metadata: {},
      };

      const result = await service.checkRateLimit(apiKey);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(49); // 100 - 50 - 1
    });

    it('should block requests exceeding limit', async () => {
      kv.get.mockResolvedValue('100'); // At limit

      const apiKey = {
        id: 'key-1', key: '', key_prefix: '', name: '', owner_id: '', owner_email: '',
        tier: 'free' as const,
        permissions: [] as any[],
        rate_limit: TIER_CONFIGS.free.limits,
        is_active: true, created_at: '', expires_at: null,
        last_used_at: null, usage_count: 0, daily_usage: 0, metadata: {},
      };

      const result = await service.checkRateLimit(apiKey);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should always allow unlimited tiers', async () => {
      const apiKey = {
        id: 'key-1', key: '', key_prefix: '', name: '', owner_id: '', owner_email: '',
        tier: 'enterprise' as const,
        permissions: [] as any[],
        rate_limit: TIER_CONFIGS.enterprise.limits,
        is_active: true, created_at: '', expires_at: null,
        last_used_at: null, usage_count: 0, daily_usage: 0, metadata: {},
      };

      const result = await service.checkRateLimit(apiKey);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1);
    });
  });

  describe('getTiers', () => {
    it('should return all tier configs', () => {
      const tiers = service.getTiers();
      expect(tiers.free.description).toContain('Free');
      expect(tiers.open_data.description).toContain('open data');
      expect(tiers.enterprise.price).toBe('Contact us');
    });
  });
});
