/**
 * MeilisearchClient - Typo-tolerant, multilingual search engine
 *
 * Meilisearch provides instant search with African language support,
 * typo tolerance, faceting, and filtering. Replaces/complements
 * the existing Vectorize-based AI search for text queries.
 *
 * Key advantages over Vectorize for text search:
 * - Typo tolerance (critical for multilingual content)
 * - Faceted search (country, category, source, date)
 * - Instant results (<50ms)
 * - Custom ranking rules
 * - Synonym support (e.g., "Zim" → "Zimbabwe")
 * - Multi-index (articles, sources, keywords, publishers)
 */

export interface MeilisearchConfig {
  url: string; // http://meilisearch.internal:7700
  apiKey: string;
  timeoutMs?: number;
}

export interface MeilisearchDocument {
  id: string;
  [key: string]: unknown;
}

export interface MeilisearchSearchResult<T = Record<string, unknown>> {
  hits: T[];
  query: string;
  processingTimeMs: number;
  limit: number;
  offset: number;
  estimatedTotalHits: number;
  facetDistribution?: Record<string, Record<string, number>>;
  facetStats?: Record<string, { min: number; max: number }>;
}

export interface MeilisearchTask {
  taskUid: number;
  indexUid: string;
  status: 'enqueued' | 'processing' | 'succeeded' | 'failed';
  type: string;
  enqueuedAt: string;
}

// Index configurations for Mukoko
export const MUKOKO_INDEXES = {
  articles: {
    uid: 'articles',
    primaryKey: 'id',
    searchableAttributes: [
      'title',
      'description',
      'content',
      'author',
      'source_name',
      'keywords',
    ],
    filterableAttributes: [
      'country_code',
      'category',
      'source_id',
      'published_at',
      'status',
      'quality_score',
      'language',
    ],
    sortableAttributes: [
      'published_at',
      'quality_score',
      'views',
      'engagement_score',
    ],
    rankingRules: [
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness',
      'published_at:desc', // Prefer recent articles
    ],
    synonyms: {
      'zim': ['zimbabwe'],
      'sa': ['south africa'],
      'ke': ['kenya'],
      'ng': ['nigeria'],
      'gh': ['ghana'],
      'harare': ['hre'],
      'joburg': ['johannesburg'],
      'nairobi': ['nai', 'nbo'],
      'lagos': ['lag'],
      'economy': ['economics', 'business', 'finance'],
      'politics': ['political', 'government', 'parliament'],
    },
    distinctAttribute: 'source_id', // One result per source for diversity
  },
  sources: {
    uid: 'sources',
    primaryKey: 'id',
    searchableAttributes: ['name', 'description', 'url', 'country_name'],
    filterableAttributes: ['country_code', 'status', 'health_status'],
    sortableAttributes: ['name', 'article_count'],
  },
  keywords: {
    uid: 'keywords',
    primaryKey: 'id',
    searchableAttributes: ['term', 'aliases'],
    filterableAttributes: ['category', 'country_code', 'trending'],
    sortableAttributes: ['usage_count', 'trending_score'],
  },
  publishers: {
    uid: 'publishers',
    primaryKey: 'id',
    searchableAttributes: ['name', 'description', 'domain'],
    filterableAttributes: ['country_code', 'verified', 'status'],
    sortableAttributes: ['name', 'article_count', 'verified_at'],
  },
} as const;

export class MeilisearchClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(config: MeilisearchConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  // --- Search ---

  /**
   * Search an index
   */
  async search<T = Record<string, unknown>>(
    indexUid: string,
    query: string,
    options: {
      filter?: string | string[];
      sort?: string[];
      facets?: string[];
      limit?: number;
      offset?: number;
      attributesToRetrieve?: string[];
      attributesToHighlight?: string[];
      attributesToCrop?: string[];
      cropLength?: number;
      showMatchesPosition?: boolean;
      matchingStrategy?: 'all' | 'last' | 'frequency';
    } = {}
  ): Promise<MeilisearchSearchResult<T>> {
    const body: Record<string, unknown> = { q: query, ...options };
    return await this.request<MeilisearchSearchResult<T>>(
      'POST',
      `/indexes/${indexUid}/search`,
      body
    );
  }

  /**
   * Multi-search across multiple indexes
   */
  async multiSearch(
    queries: Array<{
      indexUid: string;
      q: string;
      filter?: string | string[];
      limit?: number;
      offset?: number;
      sort?: string[];
    }>
  ): Promise<{ results: MeilisearchSearchResult[] }> {
    return await this.request('POST', '/multi-search', { queries });
  }

  // --- Document Management ---

  /**
   * Add or update documents
   */
  async addDocuments(
    indexUid: string,
    documents: MeilisearchDocument[],
    primaryKey?: string
  ): Promise<MeilisearchTask> {
    const query = primaryKey ? `?primaryKey=${primaryKey}` : '';
    return await this.request<MeilisearchTask>(
      'POST',
      `/indexes/${indexUid}/documents${query}`,
      documents
    );
  }

  /**
   * Get a document by ID
   */
  async getDocument<T = Record<string, unknown>>(
    indexUid: string,
    documentId: string
  ): Promise<T> {
    return await this.request<T>(
      'GET',
      `/indexes/${indexUid}/documents/${encodeURIComponent(documentId)}`
    );
  }

  /**
   * Delete a document
   */
  async deleteDocument(
    indexUid: string,
    documentId: string
  ): Promise<MeilisearchTask> {
    return await this.request<MeilisearchTask>(
      'DELETE',
      `/indexes/${indexUid}/documents/${encodeURIComponent(documentId)}`
    );
  }

  /**
   * Delete documents by filter
   */
  async deleteDocumentsByFilter(
    indexUid: string,
    filter: string
  ): Promise<MeilisearchTask> {
    return await this.request<MeilisearchTask>(
      'POST',
      `/indexes/${indexUid}/documents/delete`,
      { filter }
    );
  }

  // --- Index Management ---

  /**
   * Create an index
   */
  async createIndex(
    uid: string,
    primaryKey?: string
  ): Promise<MeilisearchTask> {
    return await this.request<MeilisearchTask>(
      'POST',
      '/indexes',
      { uid, primaryKey }
    );
  }

  /**
   * Update index settings
   */
  async updateSettings(
    indexUid: string,
    settings: {
      searchableAttributes?: string[];
      filterableAttributes?: string[];
      sortableAttributes?: string[];
      rankingRules?: string[];
      synonyms?: Record<string, string[]>;
      distinctAttribute?: string | null;
      stopWords?: string[];
      typoTolerance?: {
        enabled?: boolean;
        minWordSizeForTypos?: { oneTypo?: number; twoTypos?: number };
      };
    }
  ): Promise<MeilisearchTask> {
    return await this.request<MeilisearchTask>(
      'PATCH',
      `/indexes/${indexUid}/settings`,
      settings
    );
  }

  // --- Task Management ---

  /**
   * Get task status
   */
  async getTask(taskUid: number): Promise<MeilisearchTask & {
    startedAt?: string;
    finishedAt?: string;
    duration?: string;
    error?: { message: string; code: string; type: string };
  }> {
    return await this.request('GET', `/tasks/${taskUid}`);
  }

  /**
   * Wait for a task to complete
   */
  async waitForTask(
    taskUid: number,
    maxWaitMs: number = 30000,
    pollIntervalMs: number = 250
  ): Promise<MeilisearchTask> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const task = await this.getTask(taskUid);
      if (task.status === 'succeeded' || task.status === 'failed') {
        return task;
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    throw new MeilisearchError('Task wait timeout');
  }

  // --- Initialize Platform Indexes ---

  /**
   * Initialize all Mukoko search indexes
   */
  async initializeIndexes(): Promise<void> {
    for (const [name, config] of Object.entries(MUKOKO_INDEXES)) {
      try {
        // Create index
        const createTask = await this.createIndex(config.uid, config.primaryKey);
        await this.waitForTask(createTask.taskUid).catch(() => {
          // Index may already exist
        });

        // Update settings
        const settings: Record<string, unknown> = {};
        if ('searchableAttributes' in config) settings.searchableAttributes = config.searchableAttributes;
        if ('filterableAttributes' in config) settings.filterableAttributes = config.filterableAttributes;
        if ('sortableAttributes' in config) settings.sortableAttributes = config.sortableAttributes;
        if ('rankingRules' in config) settings.rankingRules = config.rankingRules;
        if ('synonyms' in config) settings.synonyms = config.synonyms;
        if ('distinctAttribute' in config) settings.distinctAttribute = config.distinctAttribute;

        const settingsTask = await this.updateSettings(config.uid, settings);
        await this.waitForTask(settingsTask.taskUid);

        console.log(`[MEILISEARCH] Index ${name} initialized`);
      } catch (error) {
        console.error(`[MEILISEARCH] Failed to initialize index ${name}:`, error);
      }
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<{ ok: boolean; latencyMs: number; status?: string }> {
    const start = Date.now();
    try {
      const result = await this.request<{ status: string }>('GET', '/health');
      return { ok: true, latencyMs: Date.now() - start, status: result.status };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  // --- Internal ---

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
      };

      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new MeilisearchError(
          `Meilisearch ${method} ${path} failed (${response.status}): ${error}`
        );
      }

      const text = await response.text();
      return text ? JSON.parse(text) : ({} as T);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new MeilisearchError(`Meilisearch request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class MeilisearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeilisearchError';
  }
}
