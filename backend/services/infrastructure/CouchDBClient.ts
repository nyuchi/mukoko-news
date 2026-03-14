/**
 * CouchDBClient - Apache CouchDB on Fly.io
 *
 * Document store for publisher content, article revisions, offline sync,
 * and the open data layer. CouchDB's replication protocol enables
 * multi-region sync and offline-first mobile apps.
 *
 * Key use cases:
 * - Publisher submitted articles (full document with revisions)
 * - Article version history
 * - Open data API (public CouchDB replication endpoint)
 * - Offline sync for mobile apps via PouchDB
 */

export interface CouchDBConfig {
  url: string; // http://couchdb.internal:5984
  username: string;
  password: string;
  database: string;
}

export interface CouchDBDocument {
  _id: string;
  _rev?: string;
  type: string;
  [key: string]: unknown;
}

export interface CouchDBResponse {
  ok: boolean;
  id: string;
  rev: string;
}

export interface CouchDBViewResult<T = Record<string, unknown>> {
  total_rows: number;
  offset: number;
  rows: Array<{
    id: string;
    key: unknown;
    value: unknown;
    doc?: T;
  }>;
}

export interface CouchDBChanges {
  last_seq: string;
  pending: number;
  results: Array<{
    seq: string;
    id: string;
    changes: Array<{ rev: string }>;
    deleted?: boolean;
    doc?: CouchDBDocument;
  }>;
}

export interface CouchDBBulkResult {
  id: string;
  ok?: boolean;
  rev?: string;
  error?: string;
  reason?: string;
}

export class CouchDBClient {
  private baseUrl: string;
  private authHeader: string;
  private database: string;

  constructor(config: CouchDBConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.database = config.database;
    this.authHeader = 'Basic ' + btoa(`${config.username}:${config.password}`);
  }

  // --- Document CRUD ---

  /**
   * Get a document by ID
   */
  async get<T extends CouchDBDocument>(id: string): Promise<T | null> {
    const response = await this.request<T>('GET', `/${this.database}/${encodeURIComponent(id)}`);
    return response;
  }

  /**
   * Create or update a document
   */
  async put(doc: CouchDBDocument): Promise<CouchDBResponse> {
    return await this.request<CouchDBResponse>(
      'PUT',
      `/${this.database}/${encodeURIComponent(doc._id)}`,
      doc
    );
  }

  /**
   * Create a document with auto-generated ID
   */
  async post(doc: Omit<CouchDBDocument, '_id'>): Promise<CouchDBResponse> {
    return await this.request<CouchDBResponse>(
      'POST',
      `/${this.database}`,
      doc
    );
  }

  /**
   * Delete a document
   */
  async delete(id: string, rev: string): Promise<CouchDBResponse> {
    return await this.request<CouchDBResponse>(
      'DELETE',
      `/${this.database}/${encodeURIComponent(id)}?rev=${rev}`
    );
  }

  // --- Bulk Operations ---

  /**
   * Bulk insert/update documents
   */
  async bulkDocs(docs: CouchDBDocument[]): Promise<CouchDBBulkResult[]> {
    return await this.request<CouchDBBulkResult[]>(
      'POST',
      `/${this.database}/_bulk_docs`,
      { docs }
    );
  }

  /**
   * Bulk get documents by IDs
   */
  async allDocs<T extends CouchDBDocument>(options: {
    keys?: string[];
    include_docs?: boolean;
    startkey?: string;
    endkey?: string;
    limit?: number;
    skip?: number;
    descending?: boolean;
  } = {}): Promise<CouchDBViewResult<T>> {
    const params = new URLSearchParams();
    if (options.include_docs) params.set('include_docs', 'true');
    if (options.startkey) params.set('startkey', JSON.stringify(options.startkey));
    if (options.endkey) params.set('endkey', JSON.stringify(options.endkey));
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.skip !== undefined) params.set('skip', String(options.skip));
    if (options.descending) params.set('descending', 'true');

    const query = params.toString();
    const path = `/${this.database}/_all_docs${query ? '?' + query : ''}`;

    if (options.keys) {
      return await this.request<CouchDBViewResult<T>>('POST', path, { keys: options.keys });
    }
    return await this.request<CouchDBViewResult<T>>('GET', path);
  }

  // --- Views ---

  /**
   * Query a CouchDB view
   */
  async view<T = Record<string, unknown>>(
    designDoc: string,
    viewName: string,
    options: {
      key?: unknown;
      keys?: unknown[];
      startkey?: unknown;
      endkey?: unknown;
      limit?: number;
      skip?: number;
      descending?: boolean;
      include_docs?: boolean;
      group?: boolean;
      group_level?: number;
      reduce?: boolean;
    } = {}
  ): Promise<CouchDBViewResult<T>> {
    const params = new URLSearchParams();
    if (options.key !== undefined) params.set('key', JSON.stringify(options.key));
    if (options.startkey !== undefined) params.set('startkey', JSON.stringify(options.startkey));
    if (options.endkey !== undefined) params.set('endkey', JSON.stringify(options.endkey));
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.skip !== undefined) params.set('skip', String(options.skip));
    if (options.descending) params.set('descending', 'true');
    if (options.include_docs) params.set('include_docs', 'true');
    if (options.group) params.set('group', 'true');
    if (options.group_level !== undefined) params.set('group_level', String(options.group_level));
    if (options.reduce !== undefined) params.set('reduce', String(options.reduce));

    const query = params.toString();
    const path = `/${this.database}/_design/${designDoc}/_view/${viewName}${query ? '?' + query : ''}`;

    if (options.keys) {
      return await this.request<CouchDBViewResult<T>>('POST', path, { keys: options.keys });
    }
    return await this.request<CouchDBViewResult<T>>('GET', path);
  }

  // --- Changes Feed ---

  /**
   * Get changes feed (for sync and replication)
   */
  async changes(options: {
    since?: string;
    limit?: number;
    include_docs?: boolean;
    filter?: string;
    doc_ids?: string[];
    style?: 'main_only' | 'all_docs';
  } = {}): Promise<CouchDBChanges> {
    const params = new URLSearchParams();
    if (options.since) params.set('since', options.since);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.include_docs) params.set('include_docs', 'true');
    if (options.filter) params.set('filter', options.filter);
    if (options.style) params.set('style', options.style);

    const query = params.toString();
    const path = `/${this.database}/_changes${query ? '?' + query : ''}`;

    if (options.doc_ids) {
      return await this.request<CouchDBChanges>('POST', path, { doc_ids: options.doc_ids });
    }
    return await this.request<CouchDBChanges>('GET', path);
  }

  // --- Search (Mango Queries) ---

  /**
   * Find documents using Mango query syntax
   */
  async find<T extends CouchDBDocument>(query: {
    selector: Record<string, unknown>;
    fields?: string[];
    sort?: Array<Record<string, 'asc' | 'desc'>>;
    limit?: number;
    skip?: number;
    use_index?: string | [string, string];
  }): Promise<{ docs: T[]; bookmark: string; warning?: string }> {
    return await this.request('POST', `/${this.database}/_find`, query);
  }

  /**
   * Create a Mango index
   */
  async createIndex(index: {
    fields: string[];
    name?: string;
    ddoc?: string;
    type?: 'json' | 'text';
  }): Promise<{ result: string; id: string; name: string }> {
    return await this.request('POST', `/${this.database}/_index`, {
      index: { fields: index.fields },
      name: index.name,
      ddoc: index.ddoc,
      type: index.type || 'json',
    });
  }

  // --- Database Management ---

  /**
   * Ensure database exists
   */
  async ensureDatabase(): Promise<void> {
    try {
      await this.request('PUT', `/${this.database}`);
    } catch (error) {
      // 412 = database already exists, which is fine
      if (error instanceof CouchDBError && error.statusCode === 412) {
        return;
      }
      throw error;
    }
  }

  /**
   * Get database info
   */
  async info(): Promise<{
    db_name: string;
    doc_count: number;
    doc_del_count: number;
    update_seq: string;
    disk_size: number;
    compact_running: boolean;
  }> {
    return await this.request('GET', `/${this.database}`);
  }

  /**
   * Health check
   */
  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.request('GET', '/');
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  // --- Replication (Open Data) ---

  /**
   * Set up replication to another CouchDB instance
   * Used for open data distribution
   */
  async replicate(target: {
    url: string;
    auth?: { username: string; password: string };
  }, options: {
    continuous?: boolean;
    filter?: string;
    doc_ids?: string[];
    create_target?: boolean;
  } = {}): Promise<{
    ok: boolean;
    session_id: string;
    replication_id_version: number;
  }> {
    const targetConfig: Record<string, unknown> = { url: target.url };
    if (target.auth) {
      targetConfig.headers = {
        Authorization: 'Basic ' + btoa(`${target.auth.username}:${target.auth.password}`),
      };
    }

    return await this.request('POST', '/_replicate', {
      source: `${this.baseUrl}/${this.database}`,
      target: targetConfig,
      continuous: options.continuous ?? false,
      filter: options.filter,
      doc_ids: options.doc_ids,
      create_target: options.create_target ?? false,
    });
  }

  // --- Internal ---

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Accept': 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new CouchDBError(
        `CouchDB ${method} ${path} failed (${response.status}): ${errorBody}`,
        response.status
      );
    }

    return await response.json() as T;
  }
}

export class CouchDBError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'CouchDBError';
  }
}
