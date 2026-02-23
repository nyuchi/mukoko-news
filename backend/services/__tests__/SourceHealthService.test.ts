/**
 * Tests for SourceHealthService
 * Covers health classification, alert generation, health summary pipeline,
 * and admin read operations. Write operations (recording) moved to Python Worker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourceHealthService } from '../SourceHealthService';
import { createMockD1 } from './helpers';

describe('SourceHealthService', () => {
  let service: SourceHealthService;
  let mockDb: ReturnType<typeof createMockD1>['db'];
  let mockStatement: ReturnType<typeof createMockD1>['statement'];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    mockDb = mock.db;
    mockStatement = mock.statement;
    service = new SourceHealthService(mockDb as unknown as D1Database);
  });

  describe('classifyHealth', () => {
    it('should classify source as healthy with no errors', () => {
      expect(service.classifyHealth({
        error_count: 0,
        fetch_count: 20,
        consecutive_failures: 0,
      })).toBe('healthy');
    });

    it('should classify source as healthy with low error rate', () => {
      expect(service.classifyHealth({
        error_count: 1,
        fetch_count: 20,
        consecutive_failures: 0,
      })).toBe('healthy');
    });

    it('should classify source as degraded after 3 consecutive failures', () => {
      expect(service.classifyHealth({
        error_count: 3,
        fetch_count: 10,
        consecutive_failures: 3,
      })).toBe('degraded');
    });

    it('should classify source as degraded with high error rate', () => {
      expect(service.classifyHealth({
        error_count: 4,
        fetch_count: 10,
        consecutive_failures: 0,
      })).toBe('degraded');
    });

    it('should classify source as failing after 5 consecutive failures', () => {
      expect(service.classifyHealth({
        error_count: 5,
        fetch_count: 10,
        consecutive_failures: 5,
      })).toBe('failing');
    });

    it('should classify source as failing with 50%+ error rate', () => {
      expect(service.classifyHealth({
        error_count: 6,
        fetch_count: 10,
        consecutive_failures: 1,
      })).toBe('failing');
    });

    it('should classify source as critical after 10 consecutive failures', () => {
      expect(service.classifyHealth({
        error_count: 10,
        fetch_count: 15,
        consecutive_failures: 10,
      })).toBe('critical');
    });

    it('should classify source as critical with 15 consecutive failures', () => {
      expect(service.classifyHealth({
        error_count: 15,
        fetch_count: 20,
        consecutive_failures: 15,
      })).toBe('critical');
    });

    it('should classify new source with zero fetches as healthy', () => {
      expect(service.classifyHealth({
        error_count: 0,
        fetch_count: 0,
        consecutive_failures: 0,
      })).toBe('healthy');
    });

    it('should not classify as degraded by error rate with fewer than 5 fetches', () => {
      // 2/4 = 50% error rate, but < 5 fetches so rate check doesn't trigger
      expect(service.classifyHealth({
        error_count: 2,
        fetch_count: 4,
        consecutive_failures: 0,
      })).toBe('healthy');
    });

    it('should prioritize consecutive failures over error rate', () => {
      // Consecutive failures = 10 (critical), even though error rate is low overall
      expect(service.classifyHealth({
        error_count: 10,
        fetch_count: 100,
        consecutive_failures: 10,
      })).toBe('critical');
    });
  });

  describe('getHealthSummary', () => {
    it('should return empty summary when no sources exist', async () => {
      mockStatement.all.mockResolvedValue({ results: [] });

      const summary = await service.getHealthSummary();

      expect(summary.total_sources).toBe(0);
      expect(summary.healthy).toBe(0);
      expect(summary.degraded).toBe(0);
      expect(summary.failing).toBe(0);
      expect(summary.critical).toBe(0);
      expect(summary.alerts).toHaveLength(0);
      expect(summary.sources).toHaveLength(0);
    });

    it('should classify multiple sources correctly', async () => {
      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'healthy-source',
            name: 'Healthy Source',
            url: 'https://example.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 0,
            fetch_count: 20,
            consecutive_failures: 0,
            last_error: null,
            last_error_at: null,
            last_success_at: new Date().toISOString(),
            last_fetched_at: new Date().toISOString(),
          },
          {
            id: 'failing-source',
            name: 'Failing Source',
            url: 'https://bad.com/rss',
            country_id: 'KE',
            category: 'general',
            error_count: 7,
            fetch_count: 10,
            consecutive_failures: 7,
            last_error: 'HTTP 500: Internal Server Error',
            last_error_at: new Date().toISOString(),
            last_success_at: null,
            last_fetched_at: new Date().toISOString(),
          },
          {
            id: 'critical-source',
            name: 'Critical Source',
            url: 'https://dead.com/rss',
            country_id: 'NG',
            category: 'general',
            error_count: 15,
            fetch_count: 15,
            consecutive_failures: 15,
            last_error: 'Request timeout (15s)',
            last_error_at: new Date().toISOString(),
            last_success_at: null,
            last_fetched_at: new Date().toISOString(),
          },
        ],
      });

      const summary = await service.getHealthSummary();

      expect(summary.total_sources).toBe(3);
      expect(summary.healthy).toBe(1);
      expect(summary.failing).toBe(1);
      expect(summary.critical).toBe(1);
    });

    it('should generate consecutive failure alerts', async () => {
      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'bad-source',
            name: 'Bad Source',
            url: 'https://bad.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 5,
            fetch_count: 10,
            consecutive_failures: 5,
            last_error: 'HTTP 403: Forbidden',
            last_error_at: new Date().toISOString(),
            last_success_at: null,
            last_fetched_at: new Date().toISOString(),
          },
        ],
      });

      const summary = await service.getHealthSummary();
      const failureAlerts = summary.alerts.filter(a => a.type === 'consecutive_failures');

      expect(failureAlerts).toHaveLength(1);
      expect(failureAlerts[0].severity).toBe('error');
      expect(failureAlerts[0].message).toContain('5 consecutive times');
      expect(failureAlerts[0].details.last_error).toBe('HTTP 403: Forbidden');
    });

    it('should generate critical alert for 10+ consecutive failures', async () => {
      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'dead-source',
            name: 'Dead Source',
            url: 'https://dead.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 12,
            fetch_count: 20,
            consecutive_failures: 12,
            last_error: 'DNS resolution failed',
            last_error_at: new Date().toISOString(),
            last_success_at: null,
            last_fetched_at: new Date().toISOString(),
          },
        ],
      });

      const summary = await service.getHealthSummary();
      const criticalAlerts = summary.alerts.filter(a => a.severity === 'critical');

      expect(criticalAlerts.length).toBeGreaterThanOrEqual(1);
      expect(criticalAlerts[0].type).toBe('consecutive_failures');
    });

    it('should generate stale source alert based on last_success_at', async () => {
      const staleSuccessDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(); // 72 hours ago

      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'stale-source',
            name: 'Stale Source',
            url: 'https://stale.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 0,
            fetch_count: 10,
            consecutive_failures: 0,
            last_error: null,
            last_error_at: null,
            last_success_at: staleSuccessDate,
            last_fetched_at: new Date().toISOString(), // fetched recently but success was long ago
          },
        ],
      });

      const summary = await service.getHealthSummary();
      const staleAlerts = summary.alerts.filter(a => a.type === 'stale_source');

      expect(staleAlerts).toHaveLength(1);
      expect(staleAlerts[0].severity).toBe('warning');
      expect(staleAlerts[0].message).toContain('has not successfully fetched');
      expect(staleAlerts[0].details.hours_since_success).toBeGreaterThanOrEqual(72);
      expect(staleAlerts[0].details.last_success_at).toBe(staleSuccessDate);
    });

    it('should fall back to last_fetched_at for stale alert when no last_success_at', async () => {
      const staleFetchDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'stale-source',
            name: 'Stale Source',
            url: 'https://stale.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 0,
            fetch_count: 10,
            consecutive_failures: 0,
            last_error: null,
            last_error_at: null,
            last_success_at: null,
            last_fetched_at: staleFetchDate,
          },
        ],
      });

      const summary = await service.getHealthSummary();
      const staleAlerts = summary.alerts.filter(a => a.type === 'stale_source');

      expect(staleAlerts).toHaveLength(1);
      expect(staleAlerts[0].message).toContain('has not been fetched');
    });

    it('should generate high error rate alert for sources with 50%+ failure', async () => {
      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'flaky-source',
            name: 'Flaky Source',
            url: 'https://flaky.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 8,
            fetch_count: 12,
            consecutive_failures: 1,
            last_error: 'HTTP 503: Service Unavailable',
            last_error_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            last_fetched_at: new Date().toISOString(),
          },
        ],
      });

      const summary = await service.getHealthSummary();
      const rateAlerts = summary.alerts.filter(a => a.type === 'high_error_rate');

      expect(rateAlerts).toHaveLength(1);
      expect(rateAlerts[0].severity).toBe('error');
      expect(rateAlerts[0].message).toContain('67%');
    });

    it('should generate never-succeeded alert', async () => {
      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'broken-source',
            name: 'Broken Source',
            url: 'https://broken.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 5,
            fetch_count: 5,
            consecutive_failures: 5,
            last_error: 'Received HTML page instead of RSS feed',
            last_error_at: new Date().toISOString(),
            last_success_at: null,
            last_fetched_at: new Date().toISOString(),
          },
        ],
      });

      const summary = await service.getHealthSummary();
      const neverAlerts = summary.alerts.filter(a => a.type === 'never_succeeded');

      expect(neverAlerts).toHaveLength(1);
      expect(neverAlerts[0].severity).toBe('critical');
      expect(neverAlerts[0].message).toContain('never successfully fetched');

      // Should NOT also generate a stale_source alert (deduplication)
      const staleAlerts = summary.alerts.filter(a => a.type === 'stale_source');
      expect(staleAlerts).toHaveLength(0);
    });

    it('should sort alerts by severity (critical first)', async () => {
      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'warning-source',
            name: 'Warning Source',
            url: 'https://warn.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 3,
            fetch_count: 10,
            consecutive_failures: 3,
            last_error: 'Timeout',
            last_error_at: new Date().toISOString(),
            last_success_at: null,
            last_fetched_at: new Date().toISOString(),
          },
          {
            id: 'critical-source',
            name: 'Critical Source',
            url: 'https://crit.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 12,
            fetch_count: 12,
            consecutive_failures: 12,
            last_error: 'DNS error',
            last_error_at: new Date().toISOString(),
            last_success_at: null,
            last_fetched_at: new Date().toISOString(),
          },
        ],
      });

      const summary = await service.getHealthSummary();

      expect(summary.alerts.length).toBeGreaterThan(1);
      expect(summary.alerts[0].severity).toBe('critical');
    });

    it('should handle null results gracefully', async () => {
      mockStatement.all.mockResolvedValue({ results: null });

      const summary = await service.getHealthSummary();

      expect(summary.total_sources).toBe(0);
      expect(summary.sources).toHaveLength(0);
    });

    it('should include last_success_at in source health status', async () => {
      const successDate = new Date().toISOString();
      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'source-1',
            name: 'Test Source',
            url: 'https://test.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 0,
            fetch_count: 10,
            consecutive_failures: 0,
            last_error: null,
            last_error_at: null,
            last_success_at: successDate,
            last_fetched_at: successDate,
          },
        ],
      });

      const summary = await service.getHealthSummary();

      expect(summary.sources[0].last_success_at).toBe(successDate);
    });
  });

  describe('getSourceHealth', () => {
    it('should return health for a single source', async () => {
      mockStatement.first.mockResolvedValue({
        id: 'test-source',
        name: 'Test Source',
        url: 'https://test.com/rss',
        country_id: 'ZW',
        category: 'general',
        error_count: 2,
        fetch_count: 20,
        consecutive_failures: 0,
        last_error: null,
        last_error_at: null,
        last_success_at: new Date().toISOString(),
        last_fetched_at: new Date().toISOString(),
      });

      const health = await service.getSourceHealth('test-source');

      expect(health).not.toBeNull();
      expect(health!.source_id).toBe('test-source');
      expect(health!.status).toBe('healthy');
      expect(health!.error_rate).toBe(0.1);
    });

    it('should return null for non-existent source', async () => {
      mockStatement.first.mockResolvedValue(null);

      const health = await service.getSourceHealth('nonexistent');

      expect(health).toBeNull();
    });

    it('should handle missing optional fields with defaults', async () => {
      mockStatement.first.mockResolvedValue({
        id: 'test-source',
        name: 'Test Source',
        url: 'https://test.com/rss',
        country_id: null,
        category: null,
        error_count: 0,
        fetch_count: 0,
        consecutive_failures: 0,
        last_error: null,
        last_error_at: null,
        last_success_at: null,
        last_fetched_at: null,
      });

      const health = await service.getSourceHealth('test-source');

      expect(health!.country_id).toBe('ZW');
      expect(health!.category).toBe('general');
    });

    it('should return last_success_at from database', async () => {
      const successDate = '2026-01-15T10:00:00.000Z';
      mockStatement.first.mockResolvedValue({
        id: 'test-source',
        name: 'Test Source',
        url: 'https://test.com/rss',
        country_id: 'ZW',
        category: 'general',
        error_count: 3,
        fetch_count: 20,
        consecutive_failures: 2,
        last_error: 'Timeout',
        last_error_at: new Date().toISOString(),
        last_success_at: successDate,
        last_fetched_at: new Date().toISOString(),
      });

      const health = await service.getSourceHealth('test-source');

      expect(health!.last_success_at).toBe(successDate);
    });

    it('should select last_success_at in the SQL query', async () => {
      mockStatement.first.mockResolvedValue(null);

      await service.getSourceHealth('test-source');

      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain('last_success_at');
    });
  });

  describe('getFailingSources', () => {
    it('should query for failing sources with correct thresholds', async () => {
      mockStatement.all.mockResolvedValue({ results: [] });

      await service.getFailingSources();

      expect(mockDb.prepare).toHaveBeenCalled();
      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain('consecutive_failures >= ?');
      expect(sql).toContain('error_count');
      expect(sql).toContain('last_success_at');
      expect(mockStatement.bind).toHaveBeenCalledWith(5, 0.5);
    });

    it('should return failing sources with correct classification', async () => {
      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'bad-source',
            name: 'Bad Source',
            url: 'https://bad.com/rss',
            country_id: 'ZW',
            category: 'general',
            error_count: 8,
            fetch_count: 10,
            consecutive_failures: 8,
            last_error: 'Connection refused',
            last_error_at: new Date().toISOString(),
            last_success_at: null,
            last_fetched_at: new Date().toISOString(),
          },
        ],
      });

      const failing = await service.getFailingSources();

      expect(failing).toHaveLength(1);
      expect(failing[0].status).toBe('failing');
      expect(failing[0].last_error).toBe('Connection refused');
    });
  });

  describe('resetSourceHealth', () => {
    it('should reset error tracking for a source', async () => {
      await service.resetSourceHealth('source-1');

      expect(mockDb.prepare).toHaveBeenCalledTimes(1);
      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain('error_count = 0');
      expect(sql).toContain('consecutive_failures = 0');
      expect(sql).toContain('last_error = NULL');
      expect(sql).toContain('last_error_at = NULL');
      expect(mockStatement.bind).toHaveBeenCalledWith('source-1');
      expect(mockStatement.run).toHaveBeenCalled();
    });
  });
});
