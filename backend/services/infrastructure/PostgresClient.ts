/**
 * PostgresClient - Fly.io Managed Postgres Connection Layer
 *
 * Handles connection to Fly.io managed PostgreSQL for heavy processing workloads.
 * D1 handles edge reads; Postgres handles writes, joins, full-text search,
 * and processing tasks that exceed D1's capabilities.
 *
 * Connection is via Fly.io internal DNS (6PN addressing) for low-latency
 * within the same Fly.io organization.
 */

export interface PostgresConfig {
  connectionString: string; // postgres://user:pass@db.internal:5432/mukoko
  maxConnections?: number;
  idleTimeoutMs?: number;
  queryTimeoutMs?: number;
  ssl?: boolean;
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  fields: string[];
}

export interface PostgresStatement {
  bind(...params: unknown[]): PostgresStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run(): Promise<{ success: boolean; meta: { last_row_id: number; changes: number } }>;
}

/**
 * PostgresClient wraps HTTP-based Postgres access from Cloudflare Workers.
 *
 * Since Workers can't use TCP sockets directly for Postgres wire protocol,
 * this client communicates with a lightweight Postgres HTTP proxy running
 * on Fly.io (e.g., PostgREST, pg-gateway, or a custom Hono proxy).
 *
 * Architecture:
 *   Worker → HTTPS → Fly.io Postgres Proxy → PostgreSQL
 */
export class PostgresClient {
  private baseUrl: string;
  private authToken: string;
  private queryTimeoutMs: number;

  constructor(config: PostgresConfig) {
    this.baseUrl = config.connectionString;
    this.authToken = ''; // Set via authenticate()
    this.queryTimeoutMs = config.queryTimeoutMs ?? 30000;
  }

  /**
   * Set authentication token for the Postgres proxy
   */
  authenticate(token: string): void {
    this.authToken = token;
  }

  /**
   * Prepare a parameterized query (prevents SQL injection)
   */
  prepare(sql: string): PostgresStatement {
    return new PostgresStatementImpl(this, sql);
  }

  /**
   * Execute a raw query against the Postgres proxy
   */
  async execute<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.queryTimeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
          'X-Request-ID': crypto.randomUUID(),
        },
        body: JSON.stringify({ sql, params }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new PostgresError(`Query failed (${response.status}): ${error}`, sql);
      }

      return await response.json() as QueryResult<T>;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new PostgresError(`Query timed out after ${this.queryTimeoutMs}ms`, sql);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction<T>(
    fn: (tx: TransactionClient) => Promise<T>
  ): Promise<T> {
    const txId = crypto.randomUUID();

    // Begin transaction
    await this.executeProxy('/transaction/begin', { txId });

    try {
      const tx = new TransactionClient(this, txId);
      const result = await fn(tx);
      await this.executeProxy('/transaction/commit', { txId });
      return result;
    } catch (error) {
      await this.executeProxy('/transaction/rollback', { txId });
      throw error;
    }
  }

  /**
   * Batch execute multiple queries
   */
  async batch(
    queries: Array<{ sql: string; params?: unknown[] }>
  ): Promise<QueryResult[]> {
    const response = await fetch(`${this.baseUrl}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({ queries }),
    });

    if (!response.ok) {
      throw new PostgresError(`Batch query failed: ${response.status}`, 'BATCH');
    }

    return await response.json() as QueryResult[];
  }

  /**
   * Health check for the Postgres connection
   */
  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const result = await this.execute('SELECT 1 as ping');
      return { ok: result.rows.length > 0, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  private async executeProxy(
    path: string,
    body: Record<string, unknown>
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new PostgresError(`Proxy request failed: ${response.status}`, path);
    }

    return response.json();
  }
}

class PostgresStatementImpl implements PostgresStatement {
  private params: unknown[] = [];

  constructor(
    private client: PostgresClient,
    private sql: string
  ) {}

  bind(...params: unknown[]): PostgresStatement {
    this.params = params;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.client.execute<T>(
      this.sql + ' LIMIT 1',
      this.params
    );
    return result.rows[0] ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<QueryResult<T>> {
    return this.client.execute<T>(this.sql, this.params);
  }

  async run(): Promise<{ success: boolean; meta: { last_row_id: number; changes: number } }> {
    const result = await this.client.execute(this.sql, this.params);
    return {
      success: true,
      meta: { last_row_id: 0, changes: result.rowCount },
    };
  }
}

class TransactionClient {
  constructor(
    private client: PostgresClient,
    private txId: string
  ) {}

  async execute<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    const response = await fetch(`${(this.client as any).baseUrl}/transaction/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(this.client as any).authToken}`,
      },
      body: JSON.stringify({ txId: this.txId, sql, params }),
    });

    if (!response.ok) {
      throw new PostgresError(`Transaction query failed: ${response.status}`, sql);
    }

    return await response.json() as QueryResult<T>;
  }
}

export class PostgresError extends Error {
  constructor(
    message: string,
    public readonly query: string
  ) {
    super(message);
    this.name = 'PostgresError';
  }
}
