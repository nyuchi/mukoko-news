/**
 * DorisClient - Apache Doris Analytics Engine
 *
 * Real-time OLAP database for analytics workloads. Apache Doris provides
 * sub-second query performance on large datasets, making it ideal for:
 *
 * - Real-time dashboard analytics
 * - Article performance metrics (views, engagement over time)
 * - Source health trend analysis
 * - User behavior analytics (anonymized)
 * - Geographic distribution of readership
 * - Category trending analysis
 * - Open data analytics API
 *
 * Doris supports MySQL wire protocol, so we use HTTP Stream Load API
 * for ingestion and MySQL-compatible queries via HTTP for reads.
 */

export interface DorisConfig {
  httpUrl: string;   // http://doris-fe.internal:8030
  mysqlUrl?: string; // doris-fe.internal:9030 (MySQL protocol)
  username: string;
  password: string;
  database: string;
}

export interface DorisQueryResult<T = Record<string, unknown>> {
  data: T[];
  meta: {
    rowCount: number;
    queryTimeMs: number;
    status: string;
  };
}

export interface DorisStreamLoadResult {
  Status: string;
  Message: string;
  NumberTotalRows: number;
  NumberLoadedRows: number;
  NumberFilteredRows: number;
  NumberUnselectedRows: number;
  LoadBytes: number;
  LoadTimeMs: number;
  BeginTxnTimeMs: number;
  StreamLoadPutTimeMs: number;
  ReadDataTimeMs: number;
  WriteDataTimeMs: number;
  CommitAndPublishTimeMs: number;
}

// Predefined analytics table schemas
export const DORIS_TABLES = {
  // Article performance metrics (aggregate model)
  article_metrics: `
    CREATE TABLE IF NOT EXISTS article_metrics (
      article_id VARCHAR(64),
      date DATE,
      hour TINYINT,
      country_code VARCHAR(2),
      category VARCHAR(64),
      source_id VARCHAR(64),
      views BIGINT SUM DEFAULT "0",
      likes BIGINT SUM DEFAULT "0",
      saves BIGINT SUM DEFAULT "0",
      shares BIGINT SUM DEFAULT "0",
      read_time_seconds BIGINT SUM DEFAULT "0",
      scroll_depth_sum DOUBLE SUM DEFAULT "0",
      click_throughs BIGINT SUM DEFAULT "0"
    )
    AGGREGATE KEY(article_id, date, hour, country_code, category, source_id)
    DISTRIBUTED BY HASH(article_id) BUCKETS 8
    PROPERTIES (
      "replication_num" = "1",
      "storage_medium" = "SSD"
    )
  `,

  // Source health time series (duplicate model for full history)
  source_health_history: `
    CREATE TABLE IF NOT EXISTS source_health_history (
      recorded_at DATETIME,
      source_id VARCHAR(64),
      source_name VARCHAR(256),
      status VARCHAR(16),
      response_time_ms INT,
      articles_fetched INT,
      error_message VARCHAR(512),
      consecutive_failures INT,
      country_code VARCHAR(2)
    )
    DUPLICATE KEY(recorded_at, source_id)
    DISTRIBUTED BY HASH(source_id) BUCKETS 4
    PROPERTIES (
      "replication_num" = "1"
    )
  `,

  // User behavior analytics (anonymized, aggregate)
  user_analytics: `
    CREATE TABLE IF NOT EXISTS user_analytics (
      date DATE,
      hour TINYINT,
      country_code VARCHAR(2),
      platform VARCHAR(16),
      action VARCHAR(32),
      category VARCHAR(64),
      event_count BIGINT SUM DEFAULT "0",
      unique_users HLL HLL_UNION
    )
    AGGREGATE KEY(date, hour, country_code, platform, action, category)
    DISTRIBUTED BY HASH(country_code) BUCKETS 4
    PROPERTIES (
      "replication_num" = "1"
    )
  `,

  // Search analytics
  search_analytics: `
    CREATE TABLE IF NOT EXISTS search_analytics (
      date DATE,
      hour TINYINT,
      query_text VARCHAR(256),
      country_code VARCHAR(2),
      result_count INT,
      clicked_article_id VARCHAR(64),
      search_count BIGINT SUM DEFAULT "0",
      click_count BIGINT SUM DEFAULT "0"
    )
    AGGREGATE KEY(date, hour, query_text, country_code, result_count, clicked_article_id)
    DISTRIBUTED BY HASH(query_text) BUCKETS 4
    PROPERTIES (
      "replication_num" = "1"
    )
  `,

  // Category trending (for real-time trending topics)
  category_trending: `
    CREATE TABLE IF NOT EXISTS category_trending (
      date DATE,
      hour TINYINT,
      category VARCHAR(64),
      country_code VARCHAR(2),
      keyword VARCHAR(128),
      article_count BIGINT SUM DEFAULT "0",
      total_engagement BIGINT SUM DEFAULT "0",
      velocity DOUBLE REPLACE DEFAULT "0"
    )
    AGGREGATE KEY(date, hour, category, country_code, keyword)
    DISTRIBUTED BY HASH(category) BUCKETS 4
    PROPERTIES (
      "replication_num" = "1"
    )
  `,

  // Publisher analytics
  publisher_analytics: `
    CREATE TABLE IF NOT EXISTS publisher_analytics (
      date DATE,
      publisher_id VARCHAR(64),
      country_code VARCHAR(2),
      articles_published BIGINT SUM DEFAULT "0",
      total_views BIGINT SUM DEFAULT "0",
      total_engagement BIGINT SUM DEFAULT "0",
      avg_quality_score DOUBLE REPLACE DEFAULT "0",
      flagged_count BIGINT SUM DEFAULT "0"
    )
    AGGREGATE KEY(date, publisher_id, country_code)
    DISTRIBUTED BY HASH(publisher_id) BUCKETS 4
    PROPERTIES (
      "replication_num" = "1"
    )
  `,

  // Open data access log (who's using our open data)
  open_data_access_log: `
    CREATE TABLE IF NOT EXISTS open_data_access_log (
      access_time DATETIME,
      api_key_id VARCHAR(64),
      endpoint VARCHAR(256),
      country_code VARCHAR(2),
      response_time_ms INT,
      result_count INT,
      format VARCHAR(16),
      request_count BIGINT SUM DEFAULT "0"
    )
    AGGREGATE KEY(access_time, api_key_id, endpoint, country_code, response_time_ms, result_count, format)
    DISTRIBUTED BY HASH(api_key_id) BUCKETS 4
    PROPERTIES (
      "replication_num" = "1"
    )
  `,
} as const;

export class DorisClient {
  private baseUrl: string;
  private authHeader: string;
  private database: string;

  constructor(config: DorisConfig) {
    this.baseUrl = config.httpUrl.replace(/\/$/, '');
    this.database = config.database;
    this.authHeader = 'Basic ' + btoa(`${config.username}:${config.password}`);
  }

  // --- Query ---

  /**
   * Execute a SQL query and return typed results
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<DorisQueryResult<T>> {
    const start = Date.now();

    // Parameter substitution (Doris HTTP API doesn't support prepared statements)
    let processedSql = sql;
    if (params) {
      params.forEach((param, i) => {
        const value = this.escapeValue(param);
        processedSql = processedSql.replace(`$${i + 1}`, value);
      });
    }

    const response = await fetch(`${this.baseUrl}/api/${this.database}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.authHeader,
      },
      body: JSON.stringify({ sql: processedSql }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new DorisError(`Query failed (${response.status}): ${error}`, processedSql);
    }

    const result = await response.json() as {
      data: { data: T[]; meta: Array<{ name: string; type: string }> };
      status: number;
      msg: string;
    };

    return {
      data: result.data?.data ?? [],
      meta: {
        rowCount: result.data?.data?.length ?? 0,
        queryTimeMs: Date.now() - start,
        status: result.msg || 'OK',
      },
    };
  }

  // --- Stream Load (High-throughput ingestion) ---

  /**
   * Load data into a table using Stream Load API
   * Supports JSON and CSV formats
   */
  async streamLoad(
    table: string,
    data: Record<string, unknown>[],
    options: {
      format?: 'json' | 'csv';
      columns?: string[];
      maxFilterRatio?: number;
      label?: string;
    } = {}
  ): Promise<DorisStreamLoadResult> {
    const format = options.format ?? 'json';
    const label = options.label ?? `mukoko_${table}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Expect': '100-continue',
      'label': label,
      'format': format,
    };

    if (format === 'json') {
      headers['strip_outer_array'] = 'true';
      headers['Content-Type'] = 'application/json';
    }

    if (options.columns) {
      headers['columns'] = options.columns.join(',');
    }

    if (options.maxFilterRatio !== undefined) {
      headers['max_filter_ratio'] = String(options.maxFilterRatio);
    }

    const body = format === 'json'
      ? JSON.stringify(data)
      : this.toCsv(data, options.columns);

    const response = await fetch(
      `${this.baseUrl}/api/${this.database}/${table}/_stream_load`,
      { method: 'PUT', headers, body }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new DorisError(`Stream load failed (${response.status}): ${error}`, table);
    }

    return await response.json() as DorisStreamLoadResult;
  }

  // --- Analytics Queries ---

  /**
   * Get article performance over time
   */
  async getArticlePerformance(
    articleId: string,
    days: number = 30
  ): Promise<DorisQueryResult> {
    return this.query(`
      SELECT date, SUM(views) as views, SUM(likes) as likes,
             SUM(saves) as saves, SUM(shares) as shares,
             SUM(click_throughs) as click_throughs
      FROM article_metrics
      WHERE article_id = '${this.escape(articleId)}'
        AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY)
      GROUP BY date
      ORDER BY date
    `);
  }

  /**
   * Get trending categories by engagement velocity
   */
  async getTrendingCategories(
    countryCode?: string,
    hours: number = 24
  ): Promise<DorisQueryResult> {
    const countryFilter = countryCode
      ? `AND country_code = '${this.escape(countryCode)}'`
      : '';

    return this.query(`
      SELECT category, SUM(article_count) as articles,
             SUM(total_engagement) as engagement,
             AVG(velocity) as avg_velocity
      FROM category_trending
      WHERE date >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
        ${countryFilter}
      GROUP BY category
      ORDER BY avg_velocity DESC
      LIMIT 20
    `);
  }

  /**
   * Get geographic readership distribution
   */
  async getGeographicDistribution(
    days: number = 7
  ): Promise<DorisQueryResult> {
    return this.query(`
      SELECT country_code, SUM(event_count) as events,
             COUNT(DISTINCT date) as active_days
      FROM user_analytics
      WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY)
        AND action = 'page_view'
      GROUP BY country_code
      ORDER BY events DESC
    `);
  }

  /**
   * Get source reliability trends
   */
  async getSourceReliabilityTrends(
    sourceId?: string,
    days: number = 30
  ): Promise<DorisQueryResult> {
    const sourceFilter = sourceId
      ? `WHERE source_id = '${this.escape(sourceId)}'`
      : '';

    return this.query(`
      SELECT DATE(recorded_at) as date, source_id, source_name,
             AVG(response_time_ms) as avg_response_time,
             SUM(articles_fetched) as total_articles,
             SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) as healthy_checks,
             COUNT(*) as total_checks
      FROM source_health_history
      ${sourceFilter}
        ${sourceFilter ? 'AND' : 'WHERE'} recorded_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY DATE(recorded_at), source_id, source_name
      ORDER BY date DESC
    `);
  }

  /**
   * Get publisher performance dashboard
   */
  async getPublisherDashboard(
    publisherId: string,
    days: number = 30
  ): Promise<DorisQueryResult> {
    return this.query(`
      SELECT date, articles_published, total_views,
             total_engagement, avg_quality_score, flagged_count
      FROM publisher_analytics
      WHERE publisher_id = '${this.escape(publisherId)}'
        AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY)
      ORDER BY date DESC
    `);
  }

  // --- Table Management ---

  /**
   * Initialize all analytics tables
   */
  async initializeTables(): Promise<void> {
    for (const [name, ddl] of Object.entries(DORIS_TABLES)) {
      try {
        await this.query(ddl);
        console.log(`[DORIS] Table ${name} initialized`);
      } catch (error) {
        console.error(`[DORIS] Failed to initialize table ${name}:`, error);
      }
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<{ ok: boolean; latencyMs: number; version?: string }> {
    const start = Date.now();
    try {
      const result = await this.query<{ version: string }>('SELECT version() as version');
      return {
        ok: true,
        latencyMs: Date.now() - start,
        version: result.data[0]?.version,
      };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  // --- Utility ---

  private escape(value: string): string {
    return value.replace(/'/g, "''").replace(/\\/g, '\\\\');
  }

  private escapeValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (value instanceof Date) return `'${value.toISOString()}'`;
    return `'${this.escape(String(value))}'`;
  }

  private toCsv(
    data: Record<string, unknown>[],
    columns?: string[]
  ): string {
    if (data.length === 0) return '';
    const cols = columns ?? Object.keys(data[0]);
    const rows = data.map(row =>
      cols.map(col => {
        const val = row[col];
        if (val === null || val === undefined) return '\\N';
        return String(val).replace(/\t/g, ' ').replace(/\n/g, ' ');
      }).join('\t')
    );
    return rows.join('\n');
  }
}

export class DorisError extends Error {
  constructor(
    message: string,
    public readonly context: string
  ) {
    super(message);
    this.name = 'DorisError';
  }
}
