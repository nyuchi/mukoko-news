/**
 * Tests for SourceHealthService
 * Covers health classification, alert generation, fetch result recording,
 * batch recording, and the full health summary pipeline.
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
        total_error_count: 0,
        total_fetch_count: 20,
        consecutive_failures: 0,
      })).toBe('healthy');
    });

    it('should classify source as healthy with low error rate', () => {
      expect(service.classifyHealth({
        total_error_count: 1,
        total_fetch_count: 20,
        consecutive_failures: 0,
      })).toBe('healthy');
    });

    it('should classify source as degraded after 3 consecutive failures', () => {
      expect(service.classifyHealth({
        total_error_count: 3,
        total_fetch_count: 10,
        consecutive_failures: 3,
      })).toBe('degraded');
    });

    it('should classify source as degraded with high error rate', () => {
      expect(service.classifyHealth({
        total_error_count: 4,
        total_fetch_count: 10,
        consecutive_failures: 0,
      })).toBe('degraded');
    });

    it('should classify source as failing after 5 consecutive failures', () => {
      expect(service.classifyHealth({
        total_error_count: 5,
        total_fetch_count: 10,
        consecutive_failures: 5,
      })).toBe('failing');
    });

    it('should classify source as failing with 50%+ error rate', () => {
      expect(service.classifyHealth({
        total_error_count: 6,
        total_fetch_count: 10,
        consecutive_failures: 1,
      })).toBe('failing');
    });

    it('should classify source as critical after 10 consecutive failures', () => {
      expect(service.classifyHealth({
        total_error_count: 10,
        total_fetch_count: 15,
        consecutive_failures: 10,
      })).toBe('critical');
    });

    it('should classify source as critical with 15 consecutive failures', () => {
      expect(service.classifyHealth({
        total_error_count: 15,
        total_fetch_count: 20,
        consecutive_failures: 15,
      })).toBe('critical');
    });

    it('should classify new source with zero fetches as healthy', () => {
      expect(service.classifyHealth({
        total_error_count: 0,
        total_fetch_count: 0,
        consecutive_failures: 0,
      })).toBe('healthy');
    });

    it('should not classify as degraded by error rate with fewer than 5 fetches', () => {
      // 2/4 = 50% error rate, but < 5 fetches so rate check doesn't trigger
      expect(service.classifyHealth({
        total_error_count: 2,
        total_fetch_count: 4,
        consecutive_failures: 0,
      })).toBe('healthy');
    });

    it('should prioritize consecutive failures over error rate', () => {
      // Consecutive failures = 10 (critical), even though error rate is low overall
      expect(service.classifyHealth({
        total_error_count: 10,
        total_fetch_count: 100,
        consecutive_failures: 10,
      })).toBe('critical');
    });
  });

  describe('recordFetchResult', () => {
    it('should record a successful fetch with last_successful_fetch_at', async () => {
      await service.recordFetchResult('source-1', true);

      expect(mockDb.prepare).toHaveBeenCalledTimes(1);
      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain('total_fetch_count = total_fetch_count + 1');
      expect(sql).toContain('last_successful_fetch_at = datetime');
      expect(sql).toContain('consecutive_failures = 0');
      expect(sql).toContain('last_error = NULL');
      expect(mockStatement.bind).toHaveBeenCalledWith('source-1');
      expect(mockStatement.run).toHaveBeenCalled();
    });

    it('should not update last_successful_fetch_at on failure', async () => {
      await service.recordFetchResult('source-1', false, 'HTTP 404: Not Found');

      expect(mockDb.prepare).toHaveBeenCalledTimes(1);
      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain('total_error_count = total_error_count + 1');
      expect(sql).toContain('consecutive_failures = COALESCE(consecutive_failures, 0) + 1');
      expect(sql).toContain('last_error = ?');
      expect(sql).toContain('last_error_at = datetime');
      expect(sql).not.toContain('last_successful_fetch_at');
      expect(mockStatement.bind).toHaveBeenCalledWith('HTTP 404: Not Found', 'source-1');
    });

    it('should use default error message if none provided', async () => {
      await service.recordFetchResult('source-1', false);

      expect(mockStatement.bind).toHaveBeenCalledWith('Unknown error', 'source-1');
    });

    it('should not throw on database error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockStatement.run.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await service.recordFetchResult('source-1', true);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SourceHealth]'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('recordHealthBatch', () => {
    it('should batch multiple health updates into a single db.batch call', async () => {
      const results = [
        { sourceId: 'source-1', success: true },
        { sourceId: 'source-2', success: false, error: 'HTTP 500' },
        { sourceId: 'source-3', success: true },
      ];

      await service.recordHealthBatch(results);

      // Should prepare 3 statements and call db.batch once
      expect(mockDb.prepare).toHaveBeenCalledTimes(3);
      expect(mockDb.batch).toHaveBeenCalledTimes(1);
      expect(mockDb.batch).toHaveBeenCalledWith(expect.arrayContaining([
        expect.anything(),
        expect.anything(),
        expect.anything(),
      ]));
    });

    it('should do nothing for empty results', async () => {
      await service.recordHealthBatch([]);

      expect(mockDb.prepare).not.toHaveBeenCalled();
      expect(mockDb.batch).not.toHaveBeenCalled();
    });

    it('should use correct SQL for success vs failure', async () => {
      await service.recordHealthBatch([
        { sourceId: 'ok', success: true },
        { sourceId: 'bad', success: false, error: 'Timeout' },
      ]);

      const calls = mockDb.prepare.mock.calls;
      // First call = success SQL
      expect(calls[0][0]).toContain('last_successful_fetch_at = datetime');
      expect(calls[0][0]).toContain('consecutive_failures = 0');
      // Second call = failure SQL
      expect(calls[1][0]).toContain('total_error_count = total_error_count + 1');
      expect(calls[1][0]).not.toContain('last_successful_fetch_at');
    });

    it('should not throw on database error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockDb.batch.mockRejectedValue(new Error('Batch DB error'));

      await service.recordHealthBatch([{ sourceId: 'source-1', success: true }]);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SourceHealth]'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
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
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 0,
            total_fetch_count: 20,
            consecutive_failures: 0,
            last_error: null,
            last_error_at: null,
            last_successful_fetch_at: new Date().toISOString(),
            last_fetched_at: new Date().toISOString(),
          },
          {
            id: 'failing-source',
            name: 'Failing Source',
            url: 'https://bad.com/rss',
            area_served: 'KE',
            article_section_id: 'general',
            total_error_count: 7,
            total_fetch_count: 10,
            consecutive_failures: 7,
            last_error: 'HTTP 500: Internal Server Error',
            last_error_at: new Date().toISOString(),
            last_successful_fetch_at: null,
            last_fetched_at: new Date().toISOString(),
          },
          {
            id: 'critical-source',
            name: 'Critical Source',
            url: 'https://dead.com/rss',
            area_served: 'NG',
            article_section_id: 'general',
            total_error_count: 15,
            total_fetch_count: 15,
            consecutive_failures: 15,
            last_error: 'Request timeout (15s)',
            last_error_at: new Date().toISOString(),
            last_successful_fetch_at: null,
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
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 5,
            total_fetch_count: 10,
            consecutive_failures: 5,
            last_error: 'HTTP 403: Forbidden',
            last_error_at: new Date().toISOString(),
            last_successful_fetch_at: null,
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
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 12,
            total_fetch_count: 20,
            consecutive_failures: 12,
            last_error: 'DNS resolution failed',
            last_error_at: new Date().toISOString(),
            last_successful_fetch_at: null,
            last_fetched_at: new Date().toISOString(),
          },
        ],
      });

      const summary = await service.getHealthSummary();
      const criticalAlerts = summary.alerts.filter(a => a.severity === 'critical');

      expect(criticalAlerts.length).toBeGreaterThanOrEqual(1);
      expect(criticalAlerts[0].type).toBe('consecutive_failures');
    });

    it('should generate stale source alert based on last_successful_fetch_at', async () => {
      const staleSuccessDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(); // 72 hours ago

      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'stale-source',
            name: 'Stale Source',
            url: 'https://stale.com/rss',
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 0,
            total_fetch_count: 10,
            consecutive_failures: 0,
            last_error: null,
            last_error_at: null,
            last_successful_fetch_at: staleSuccessDate,
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

    it('should fall back to last_fetched_at for stale alert when no last_successful_fetch_at', async () => {
      const staleFetchDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'stale-source',
            name: 'Stale Source',
            url: 'https://stale.com/rss',
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 0,
            total_fetch_count: 10,
            consecutive_failures: 0,
            last_error: null,
            last_error_at: null,
            last_successful_fetch_at: null,
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
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 8,
            total_fetch_count: 12,
            consecutive_failures: 1,
            last_error: 'HTTP 503: Service Unavailable',
            last_error_at: new Date().toISOString(),
            last_successful_fetch_at: new Date().toISOString(),
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
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 5,
            total_fetch_count: 5,
            consecutive_failures: 5,
            last_error: 'Received HTML page instead of RSS feed',
            last_error_at: new Date().toISOString(),
            last_successful_fetch_at: null,
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
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 3,
            total_fetch_count: 10,
            consecutive_failures: 3,
            last_error: 'Timeout',
            last_error_at: new Date().toISOString(),
            last_successful_fetch_at: null,
            last_fetched_at: new Date().toISOString(),
          },
          {
            id: 'critical-source',
            name: 'Critical Source',
            url: 'https://crit.com/rss',
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 12,
            total_fetch_count: 12,
            consecutive_failures: 12,
            last_error: 'DNS error',
            last_error_at: new Date().toISOString(),
            last_successful_fetch_at: null,
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

    it('should include last_successful_fetch_at in source health status', async () => {
      const successDate = new Date().toISOString();
      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'source-1',
            name: 'Test Source',
            url: 'https://test.com/rss',
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 0,
            total_fetch_count: 10,
            consecutive_failures: 0,
            last_error: null,
            last_error_at: null,
            last_successful_fetch_at: successDate,
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
        area_served: 'ZW',
        article_section_id: 'general',
        total_error_count: 2,
        total_fetch_count: 20,
        consecutive_failures: 0,
        last_error: null,
        last_error_at: null,
        last_successful_fetch_at: new Date().toISOString(),
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
        area_served: null,
        article_section_id: null,
        total_error_count: 0,
        total_fetch_count: 0,
        consecutive_failures: 0,
        last_error: null,
        last_error_at: null,
        last_successful_fetch_at: null,
        last_fetched_at: null,
      });

      const health = await service.getSourceHealth('test-source');

      expect(health!.area_served).toBe('ZW');
      expect(health!.article_section_id).toBe('general');
    });

    it('should return last_successful_fetch_at from database', async () => {
      const successDate = '2026-01-15T10:00:00.000Z';
      mockStatement.first.mockResolvedValue({
        id: 'test-source',
        name: 'Test Source',
        url: 'https://test.com/rss',
        area_served: 'ZW',
        article_section_id: 'general',
        total_error_count: 3,
        total_fetch_count: 20,
        consecutive_failures: 2,
        last_error: 'Timeout',
        last_error_at: new Date().toISOString(),
        last_successful_fetch_at: successDate,
        last_fetched_at: new Date().toISOString(),
      });

      const health = await service.getSourceHealth('test-source');

      expect(health!.last_success_at).toBe(successDate);
    });

    it('should select last_successful_fetch_at in the SQL query', async () => {
      mockStatement.first.mockResolvedValue(null);

      await service.getSourceHealth('test-source');

      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain('last_successful_fetch_at');
    });
  });

  describe('getFailingSources', () => {
    it('should query for failing sources with correct thresholds', async () => {
      mockStatement.all.mockResolvedValue({ results: [] });

      await service.getFailingSources();

      expect(mockDb.prepare).toHaveBeenCalled();
      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain('consecutive_failures >= ?');
      expect(sql).toContain('total_error_count');
      expect(sql).toContain('last_successful_fetch_at');
      expect(mockStatement.bind).toHaveBeenCalledWith(5, 0.5);
    });

    it('should return failing sources with correct classification', async () => {
      mockStatement.all.mockResolvedValue({
        results: [
          {
            id: 'bad-source',
            name: 'Bad Source',
            url: 'https://bad.com/rss',
            area_served: 'ZW',
            article_section_id: 'general',
            total_error_count: 8,
            total_fetch_count: 10,
            consecutive_failures: 8,
            last_error: 'Connection refused',
            last_error_at: new Date().toISOString(),
            last_successful_fetch_at: null,
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
      expect(sql).toContain('total_error_count = 0');
      expect(sql).toContain('consecutive_failures = 0');
      expect(sql).toContain('last_error = NULL');
      expect(sql).toContain('last_error_at = NULL');
      expect(mockStatement.bind).toHaveBeenCalledWith('source-1');
      expect(mockStatement.run).toHaveBeenCalled();
    });
  });
});
