/**
 * SourceHealthService - RSS Source Health Monitoring (D1 Read Layer)
 *
 * Provides D1-based health reads for the admin dashboard (fallback when Python Worker unavailable).
 * Health recording (writes) is handled by the Python Worker via MongoDB.
 *
 * Read operations:
 * - Health status classification (healthy, degraded, failing, critical)
 * - Alerting for sources that cross error thresholds
 * - Source health dashboard data for admin
 * - Admin reset of source health tracking
 */

/** Shape of an rss_sources row returned by health queries */
interface RSSSourceHealthRow {
  id: string;
  name: string;
  url: string;
  country_id: string | null;
  category: string | null;
  error_count: number;
  fetch_count: number;
  consecutive_failures: number;
  last_error: string | null;
  last_error_at: string | null;
  last_success_at: string | null;
  last_fetched_at: string | null;
}

export interface SourceHealthStatus {
  source_id: string;
  source_name: string;
  url: string;
  country_id: string;
  category: string;
  status: 'healthy' | 'degraded' | 'failing' | 'critical';
  error_count: number;
  fetch_count: number;
  consecutive_failures: number;
  error_rate: number;
  last_error: string | null;
  last_error_at: string | null;
  last_success_at: string | null;
  last_fetched_at: string | null;
}

export interface SourceHealthAlert {
  source_id: string;
  source_name: string;
  severity: 'warning' | 'error' | 'critical';
  type: 'consecutive_failures' | 'high_error_rate' | 'stale_source' | 'never_succeeded';
  message: string;
  details: {
    error_count?: number;
    consecutive_failures?: number;
    error_rate?: number;
    last_error?: string | null;
    last_success_at?: string | null;
    hours_since_success?: number;
  };
  created_at: string;
}

export interface SourceHealthSummary {
  total_sources: number;
  healthy: number;
  degraded: number;
  failing: number;
  critical: number;
  alerts: SourceHealthAlert[];
  sources: SourceHealthStatus[];
}

// Thresholds for health classification
const THRESHOLDS = {
  /** Source is degraded after this many consecutive failures */
  DEGRADED_CONSECUTIVE: 3,
  /** Source is failing after this many consecutive failures */
  FAILING_CONSECUTIVE: 5,
  /** Source is critical after this many consecutive failures */
  CRITICAL_CONSECUTIVE: 10,
  /** Error rate above this is considered degraded (30%) */
  DEGRADED_ERROR_RATE: 0.3,
  /** Error rate above this is considered failing (50%) */
  FAILING_ERROR_RATE: 0.5,
  /** Hours without a successful fetch before alert */
  STALE_HOURS: 48,
};

export class SourceHealthService {
  constructor(private db: D1Database) {}

  /**
   * Classify a source's health status based on its metrics.
   */
  classifyHealth(source: {
    error_count: number;
    fetch_count: number;
    consecutive_failures: number;
  }): 'healthy' | 'degraded' | 'failing' | 'critical' {
    const { consecutive_failures, error_count, fetch_count } = source;
    const errorRate = fetch_count > 0 ? error_count / fetch_count : 0;

    if (consecutive_failures >= THRESHOLDS.CRITICAL_CONSECUTIVE) return 'critical';
    if (consecutive_failures >= THRESHOLDS.FAILING_CONSECUTIVE) return 'failing';
    if (consecutive_failures >= THRESHOLDS.DEGRADED_CONSECUTIVE) return 'degraded';
    if (errorRate >= THRESHOLDS.FAILING_ERROR_RATE && fetch_count >= 5) return 'failing';
    if (errorRate >= THRESHOLDS.DEGRADED_ERROR_RATE && fetch_count >= 5) return 'degraded';

    return 'healthy';
  }

  /** Convert an RSSSourceHealthRow to a SourceHealthStatus */
  private rowToHealthStatus(row: RSSSourceHealthRow): SourceHealthStatus {
    const errorCount = row.error_count || 0;
    const fetchCount = row.fetch_count || 0;
    const consecutiveFailures = row.consecutive_failures || 0;
    const errorRate = fetchCount > 0 ? errorCount / fetchCount : 0;

    return {
      source_id: row.id,
      source_name: row.name,
      url: row.url,
      country_id: row.country_id || 'ZW',
      category: row.category || 'general',
      status: this.classifyHealth({
        error_count: errorCount,
        fetch_count: fetchCount,
        consecutive_failures: consecutiveFailures,
      }),
      error_count: errorCount,
      fetch_count: fetchCount,
      consecutive_failures: consecutiveFailures,
      error_rate: Math.round(errorRate * 100) / 100,
      last_error: row.last_error,
      last_error_at: row.last_error_at,
      last_success_at: row.last_success_at,
      last_fetched_at: row.last_fetched_at,
    };
  }

  /**
   * Get health status for all enabled sources with alerts.
   */
  async getHealthSummary(): Promise<SourceHealthSummary> {
    const result = await this.db
      .prepare(`
        SELECT
          id, name, url, country_id, category,
          COALESCE(error_count, 0) as error_count,
          COALESCE(fetch_count, 0) as fetch_count,
          COALESCE(consecutive_failures, 0) as consecutive_failures,
          last_error,
          last_error_at,
          last_success_at,
          last_fetched_at
        FROM rss_sources
        WHERE enabled = 1
        ORDER BY COALESCE(consecutive_failures, 0) DESC, error_count DESC
      `)
      .all();

    const sources: SourceHealthStatus[] = [];
    const alerts: SourceHealthAlert[] = [];
    let healthy = 0, degraded = 0, failing = 0, critical = 0;
    const now = Date.now();

    for (const row of (result.results || []) as unknown as RSSSourceHealthRow[]) {
      const healthStatus = this.rowToHealthStatus(row);
      sources.push(healthStatus);

      // Count by status
      switch (healthStatus.status) {
        case 'healthy': healthy++; break;
        case 'degraded': degraded++; break;
        case 'failing': failing++; break;
        case 'critical': critical++; break;
      }

      // Generate alerts for non-healthy sources
      const consecutiveFailures = healthStatus.consecutive_failures;
      if (consecutiveFailures >= THRESHOLDS.CRITICAL_CONSECUTIVE) {
        alerts.push({
          source_id: row.id,
          source_name: row.name,
          severity: 'critical',
          type: 'consecutive_failures',
          message: `${row.name} has failed ${consecutiveFailures} consecutive times`,
          details: {
            consecutive_failures: consecutiveFailures,
            last_error: row.last_error,
            error_count: healthStatus.error_count,
          },
          created_at: new Date().toISOString(),
        });
      } else if (consecutiveFailures >= THRESHOLDS.FAILING_CONSECUTIVE) {
        alerts.push({
          source_id: row.id,
          source_name: row.name,
          severity: 'error',
          type: 'consecutive_failures',
          message: `${row.name} has failed ${consecutiveFailures} consecutive times`,
          details: {
            consecutive_failures: consecutiveFailures,
            last_error: row.last_error,
            error_count: healthStatus.error_count,
          },
          created_at: new Date().toISOString(),
        });
      } else if (consecutiveFailures >= THRESHOLDS.DEGRADED_CONSECUTIVE) {
        alerts.push({
          source_id: row.id,
          source_name: row.name,
          severity: 'warning',
          type: 'consecutive_failures',
          message: `${row.name} has failed ${consecutiveFailures} consecutive times`,
          details: {
            consecutive_failures: consecutiveFailures,
            last_error: row.last_error,
          },
          created_at: new Date().toISOString(),
        });
      }

      // Stale source alert: no successful fetch for 48+ hours
      // Skip for sources that have never succeeded (covered by never_succeeded alert)
      const neverSucceeded = healthStatus.fetch_count > 0 && healthStatus.error_count === healthStatus.fetch_count;
      if (!neverSucceeded) {
        if (row.last_success_at) {
          const hoursSinceSuccess = (now - new Date(row.last_success_at).getTime()) / (1000 * 60 * 60);
          if (hoursSinceSuccess >= THRESHOLDS.STALE_HOURS) {
            alerts.push({
              source_id: row.id,
              source_name: row.name,
              severity: 'warning',
              type: 'stale_source',
              message: `${row.name} has not successfully fetched in ${Math.round(hoursSinceSuccess)} hours`,
              details: {
                hours_since_success: Math.round(hoursSinceSuccess),
                last_success_at: row.last_success_at,
                last_error: row.last_error,
              },
              created_at: new Date().toISOString(),
            });
          }
        } else if (row.last_fetched_at) {
          // No recorded success, but has been fetched — use last_fetched_at as fallback
          const hoursSinceFetch = (now - new Date(row.last_fetched_at).getTime()) / (1000 * 60 * 60);
          if (hoursSinceFetch >= THRESHOLDS.STALE_HOURS) {
            alerts.push({
              source_id: row.id,
              source_name: row.name,
              severity: 'warning',
              type: 'stale_source',
              message: `${row.name} has not been fetched in ${Math.round(hoursSinceFetch)} hours`,
              details: {
                hours_since_success: Math.round(hoursSinceFetch),
                last_error: row.last_error,
              },
              created_at: new Date().toISOString(),
            });
          }
        }
      }

      // High error rate alert
      if (healthStatus.fetch_count >= 10 && healthStatus.error_rate >= THRESHOLDS.FAILING_ERROR_RATE) {
        alerts.push({
          source_id: row.id,
          source_name: row.name,
          severity: 'error',
          type: 'high_error_rate',
          message: `${row.name} has a ${Math.round(healthStatus.error_rate * 100)}% error rate (${healthStatus.error_count}/${healthStatus.fetch_count} fetches failed)`,
          details: {
            error_rate: healthStatus.error_rate,
            error_count: healthStatus.error_count,
            last_error: row.last_error,
          },
          created_at: new Date().toISOString(),
        });
      }

      // Never succeeded alert
      if (healthStatus.fetch_count > 0 && healthStatus.error_count === healthStatus.fetch_count) {
        alerts.push({
          source_id: row.id,
          source_name: row.name,
          severity: 'critical',
          type: 'never_succeeded',
          message: `${row.name} has never successfully fetched (${healthStatus.fetch_count} attempts, all failed)`,
          details: {
            error_count: healthStatus.error_count,
            last_error: row.last_error,
          },
          created_at: new Date().toISOString(),
        });
      }
    }

    // Sort alerts by severity (critical first)
    const severityOrder = { critical: 0, error: 1, warning: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return {
      total_sources: sources.length,
      healthy,
      degraded,
      failing,
      critical,
      alerts,
      sources,
    };
  }

  /**
   * Get health status for a single source.
   */
  async getSourceHealth(sourceId: string): Promise<SourceHealthStatus | null> {
    const row = await this.db
      .prepare(`
        SELECT
          id, name, url, country_id, category,
          COALESCE(error_count, 0) as error_count,
          COALESCE(fetch_count, 0) as fetch_count,
          COALESCE(consecutive_failures, 0) as consecutive_failures,
          last_error,
          last_error_at,
          last_success_at,
          last_fetched_at
        FROM rss_sources
        WHERE id = ?
      `)
      .bind(sourceId)
      .first<RSSSourceHealthRow>();

    if (!row) return null;

    return this.rowToHealthStatus(row);
  }

  /**
   * Get only failing and critical sources (for quick admin overview).
   */
  async getFailingSources(): Promise<SourceHealthStatus[]> {
    const result = await this.db
      .prepare(`
        SELECT
          id, name, url, country_id, category,
          COALESCE(error_count, 0) as error_count,
          COALESCE(fetch_count, 0) as fetch_count,
          COALESCE(consecutive_failures, 0) as consecutive_failures,
          last_error,
          last_error_at,
          last_success_at,
          last_fetched_at
        FROM rss_sources
        WHERE enabled = 1
          AND (consecutive_failures >= ? OR (
            fetch_count >= 5
            AND CAST(error_count AS REAL) / CAST(fetch_count AS REAL) >= ?
          ))
        ORDER BY consecutive_failures DESC, error_count DESC
      `)
      .bind(THRESHOLDS.FAILING_CONSECUTIVE, THRESHOLDS.FAILING_ERROR_RATE)
      .all();

    return ((result.results || []) as unknown as RSSSourceHealthRow[]).map((row) =>
      this.rowToHealthStatus(row)
    );
  }

  /**
   * Reset error tracking for a source (e.g., after manual fix).
   */
  async resetSourceHealth(sourceId: string): Promise<void> {
    await this.db
      .prepare(`
        UPDATE rss_sources
        SET error_count = 0,
            consecutive_failures = 0,
            last_error = NULL,
            last_error_at = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `)
      .bind(sourceId)
      .run();
  }
}
