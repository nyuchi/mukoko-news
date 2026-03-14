import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookService } from '../../platform/WebhookService.js';
import { createMockD1 } from '../helpers.js';

describe('WebhookService', () => {
  let service: WebhookService;
  let db: ReturnType<typeof createMockD1>['db'];
  let statement: ReturnType<typeof createMockD1>['statement'];

  beforeEach(() => {
    ({ db, statement } = createMockD1());
    service = new WebhookService(db as unknown as D1Database);
  });

  describe('createSubscription', () => {
    it('should create a webhook subscription', async () => {
      statement.first.mockResolvedValue({
        id: 'wh-1',
        api_key_id: 'key-1',
        url: 'https://example.com/webhook',
        events: '["article.published"]',
        secret: 'whsec_abc123',
        is_active: 1,
        description: 'Test webhook',
        filters: '{}',
        total_sent: 0,
        total_failed: 0,
        last_delivery_at: null,
        last_status_code: null,
        consecutive_failures: 0,
        created_at: '2026-03-14T00:00:00Z',
        updated_at: '2026-03-14T00:00:00Z',
      });

      const sub = await service.createSubscription({
        api_key_id: 'key-1',
        url: 'https://example.com/webhook',
        events: ['article.published'],
        description: 'Test webhook',
      });

      expect(sub.url).toBe('https://example.com/webhook');
      expect(sub.events).toEqual(['article.published']);
      expect(sub.secret.startsWith('whsec_')).toBe(true);
      expect(db.prepare).toHaveBeenCalled();
    });

    it('should reject non-HTTPS URLs', async () => {
      await expect(
        service.createSubscription({
          api_key_id: 'key-1',
          url: 'http://example.com/webhook',
          events: ['article.published'],
        })
      ).rejects.toThrow('HTTPS');
    });

    it('should reject invalid URLs', async () => {
      await expect(
        service.createSubscription({
          api_key_id: 'key-1',
          url: 'not-a-url',
          events: ['article.published'],
        })
      ).rejects.toThrow();
    });
  });

  describe('dispatch', () => {
    it('should find matching subscriptions', async () => {
      // Mock finding subscriptions
      statement.all.mockResolvedValue({
        results: [{
          id: 'wh-1',
          api_key_id: 'key-1',
          url: 'https://example.com/webhook',
          events: '["article.published"]',
          secret: 'whsec_test123',
          is_active: 1,
          description: '',
          filters: '{}',
          total_sent: 0,
          total_failed: 0,
          last_delivery_at: null,
          last_status_code: null,
          consecutive_failures: 0,
          created_at: '2026-03-14T00:00:00Z',
          updated_at: '2026-03-14T00:00:00Z',
        }],
      });

      // Mock fetch for webhook delivery
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('OK'),
      });
      global.fetch = mockFetch;

      const result = await service.dispatch('article.published', {
        article_id: 'art-1',
        title: 'Test Article',
        country_code: 'ZW',
      });

      expect(result.dispatched).toBe(1);
      expect(mockFetch).toHaveBeenCalled();

      // Verify webhook headers
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://example.com/webhook');
      expect(fetchCall[1].headers['X-Mukoko-Event']).toBe('article.published');
      expect(fetchCall[1].headers['X-Mukoko-Signature']).toBeTruthy();
      expect(fetchCall[1].headers['Content-Type']).toBe('application/json');

      // Verify payload
      const payload = JSON.parse(fetchCall[1].body);
      expect(payload.event).toBe('article.published');
      expect(payload.data.article_id).toBe('art-1');
      expect(payload._mukoko.version).toBe('1.0');
    });

    it('should filter by country', async () => {
      statement.all.mockResolvedValue({
        results: [{
          id: 'wh-1',
          api_key_id: 'key-1',
          url: 'https://example.com/webhook',
          events: '["article.published"]',
          secret: 'whsec_test',
          is_active: 1,
          description: '',
          filters: '{"countries":["ZW"]}',
          total_sent: 0,
          total_failed: 0,
          consecutive_failures: 0,
          created_at: '',
          updated_at: '',
        }],
      });

      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('OK') });

      // Should NOT dispatch (Kenya, but filter is ZW only)
      const result = await service.dispatch('article.published', {
        country_code: 'KE',
      });

      expect(result.dispatched).toBe(0);
    });
  });

  describe('test', () => {
    it('should return not found for missing subscription', async () => {
      statement.first.mockResolvedValue(null);

      const result = await service.test('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
