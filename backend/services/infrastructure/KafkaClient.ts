/**
 * KafkaClient - Apache Kafka for Data Pipeline
 *
 * Kafka handles the POST-PUBLISH analytics pipeline:
 * - Analytics event streaming to Doris (views, engagement, search queries)
 * - PII scrubbing from analytics data via Flink (NOT article content)
 * - Open data export pipeline (aggregated, anonymized metrics)
 * - Source health telemetry streaming
 *
 * IMPORTANT: Kafka is NOT used for article content ingestion.
 * Article content flows: RSS → D1 (edge) / CouchDB (documents).
 * Kafka only handles post-publish analytics and anonymized data.
 *
 * Uses Kafka REST Proxy (Confluent or Karapace) since Workers
 * can't maintain TCP connections for the Kafka wire protocol.
 *
 * Architecture:
 *   Worker → HTTPS → Kafka REST Proxy → Kafka → Flink (PII) → Sinks
 */

export interface KafkaConfig {
  restProxyUrl: string; // http://kafka-proxy.internal:8082
  authToken?: string;
  clusterId?: string;
}

export interface KafkaRecord<T = unknown> {
  key?: string;
  value: T;
  partition?: number;
  timestamp?: number;
  headers?: Record<string, string>;
}

export interface KafkaProduceResult {
  offsets: Array<{
    partition: number;
    offset: number;
    error_code?: number;
    error?: string;
  }>;
  key_schema_id?: number;
  value_schema_id?: number;
}

export interface KafkaConsumeResult<T = unknown> {
  records: Array<{
    topic: string;
    key: string | null;
    value: T;
    partition: number;
    offset: number;
    timestamp: number;
    headers?: Record<string, string>;
  }>;
}

// Standard Kafka topics for the Mukoko pipeline
export const MUKOKO_TOPICS = {
  // Raw article ingestion (before PII removal)
  RAW_ARTICLES: 'mukoko.raw.articles',

  // PII-scrubbed articles (after Flink processing)
  CLEAN_ARTICLES: 'mukoko.clean.articles',

  // Open data export (public, PII-free)
  OPEN_DATA_ARTICLES: 'mukoko.opendata.articles',
  OPEN_DATA_SOURCES: 'mukoko.opendata.sources',
  OPEN_DATA_CATEGORIES: 'mukoko.opendata.categories',
  OPEN_DATA_TRENDING: 'mukoko.opendata.trending',

  // Analytics events (to Doris sink)
  ANALYTICS_ARTICLE_VIEWS: 'mukoko.analytics.article_views',
  ANALYTICS_SEARCH_QUERIES: 'mukoko.analytics.search_queries',
  ANALYTICS_USER_EVENTS: 'mukoko.analytics.user_events',
  ANALYTICS_SOURCE_HEALTH: 'mukoko.analytics.source_health',
  ANALYTICS_PUBLISHER: 'mukoko.analytics.publisher',

  // Moderation pipeline
  MODERATION_QUEUE: 'mukoko.moderation.queue',
  MODERATION_RESULTS: 'mukoko.moderation.results',

  // PII detection/removal pipeline
  PII_SCAN_QUEUE: 'mukoko.pii.scan_queue',
  PII_SCAN_RESULTS: 'mukoko.pii.scan_results',
  PII_REMOVAL_LOG: 'mukoko.pii.removal_log',

  // Dead letter queue for failed processing
  DLQ: 'mukoko.dlq',
} as const;

// Topic configurations (partitions, retention, etc.)
export const MUKOKO_TOPIC_CONFIGS: Record<string, {
  partitions: number;
  replicationFactor: number;
  retentionMs: number;
  cleanupPolicy: 'delete' | 'compact' | 'compact,delete';
}> = {
  [MUKOKO_TOPICS.RAW_ARTICLES]: {
    partitions: 8,
    replicationFactor: 1,
    retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    cleanupPolicy: 'delete',
  },
  [MUKOKO_TOPICS.CLEAN_ARTICLES]: {
    partitions: 8,
    replicationFactor: 1,
    retentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    cleanupPolicy: 'delete',
  },
  [MUKOKO_TOPICS.OPEN_DATA_ARTICLES]: {
    partitions: 4,
    replicationFactor: 1,
    retentionMs: 365 * 24 * 60 * 60 * 1000, // 1 year
    cleanupPolicy: 'compact,delete',
  },
  [MUKOKO_TOPICS.PII_SCAN_QUEUE]: {
    partitions: 4,
    replicationFactor: 1,
    retentionMs: 3 * 24 * 60 * 60 * 1000, // 3 days
    cleanupPolicy: 'delete',
  },
  [MUKOKO_TOPICS.MODERATION_QUEUE]: {
    partitions: 4,
    replicationFactor: 1,
    retentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    cleanupPolicy: 'delete',
  },
  [MUKOKO_TOPICS.DLQ]: {
    partitions: 2,
    replicationFactor: 1,
    retentionMs: 90 * 24 * 60 * 60 * 1000, // 90 days
    cleanupPolicy: 'delete',
  },
};

export class KafkaClient {
  private baseUrl: string;
  private authToken?: string;

  constructor(config: KafkaConfig) {
    this.baseUrl = config.restProxyUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
  }

  // --- Producing ---

  /**
   * Produce a single record to a topic
   */
  async produce<T>(
    topic: string,
    record: KafkaRecord<T>
  ): Promise<KafkaProduceResult> {
    return this.produceBatch(topic, [record]);
  }

  /**
   * Produce multiple records to a topic
   */
  async produceBatch<T>(
    topic: string,
    records: KafkaRecord<T>[]
  ): Promise<KafkaProduceResult> {
    const kafkaRecords = records.map(r => ({
      key: r.key ? { type: 'STRING', data: r.key } : undefined,
      value: { type: 'JSON', data: r.value },
      partition: r.partition,
      headers: r.headers
        ? Object.entries(r.headers).map(([key, value]) => ({
            key,
            value: btoa(value),
          }))
        : undefined,
    }));

    return await this.request<KafkaProduceResult>(
      'POST',
      `/topics/${topic}/records`,
      { records: kafkaRecords }
    );
  }

  // --- PII Pipeline Helpers ---

  /**
   * Submit an article for PII scanning
   */
  async submitForPIIScan(article: {
    articleId: string;
    title: string;
    content: string;
    author?: string;
    source: string;
    metadata?: Record<string, unknown>;
  }): Promise<KafkaProduceResult> {
    return this.produce(MUKOKO_TOPICS.PII_SCAN_QUEUE, {
      key: article.articleId,
      value: {
        ...article,
        submittedAt: new Date().toISOString(),
        pipeline: 'pii_removal',
      },
    });
  }

  /**
   * Submit an article for moderation
   */
  async submitForModeration(article: {
    articleId: string;
    title: string;
    content: string;
    source: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    checks: Array<'fake_news' | 'bias' | 'hate_speech' | 'quality' | 'cultural_sensitivity'>;
  }): Promise<KafkaProduceResult> {
    return this.produce(MUKOKO_TOPICS.MODERATION_QUEUE, {
      key: article.articleId,
      value: {
        ...article,
        submittedAt: new Date().toISOString(),
        pipeline: 'moderation',
      },
    });
  }

  /**
   * Emit analytics event
   */
  async emitAnalytics(
    type: 'article_view' | 'search_query' | 'user_event' | 'source_health' | 'publisher',
    data: Record<string, unknown>
  ): Promise<KafkaProduceResult> {
    const topicMap: Record<string, string> = {
      article_view: MUKOKO_TOPICS.ANALYTICS_ARTICLE_VIEWS,
      search_query: MUKOKO_TOPICS.ANALYTICS_SEARCH_QUERIES,
      user_event: MUKOKO_TOPICS.ANALYTICS_USER_EVENTS,
      source_health: MUKOKO_TOPICS.ANALYTICS_SOURCE_HEALTH,
      publisher: MUKOKO_TOPICS.ANALYTICS_PUBLISHER,
    };

    return this.produce(topicMap[type], {
      key: (data.id as string) ?? crypto.randomUUID(),
      value: {
        ...data,
        eventType: type,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Publish to open data topic (PII-free)
   */
  async publishOpenData(
    type: 'articles' | 'sources' | 'categories' | 'trending',
    data: Record<string, unknown>
  ): Promise<KafkaProduceResult> {
    const topicMap: Record<string, string> = {
      articles: MUKOKO_TOPICS.OPEN_DATA_ARTICLES,
      sources: MUKOKO_TOPICS.OPEN_DATA_SOURCES,
      categories: MUKOKO_TOPICS.OPEN_DATA_CATEGORIES,
      trending: MUKOKO_TOPICS.OPEN_DATA_TRENDING,
    };

    return this.produce(topicMap[type], {
      key: (data.id as string) ?? crypto.randomUUID(),
      value: {
        ...data,
        publishedAt: new Date().toISOString(),
        openData: true,
      },
    });
  }

  // --- Topic Management ---

  /**
   * Create a topic
   */
  async createTopic(
    name: string,
    config?: {
      partitions?: number;
      replicationFactor?: number;
      retentionMs?: number;
      cleanupPolicy?: string;
    }
  ): Promise<{ topic: string }> {
    const topicConfig = MUKOKO_TOPIC_CONFIGS[name] ?? {};
    return await this.request('POST', '/topics', {
      topic_name: name,
      partitions_count: config?.partitions ?? topicConfig.partitions ?? 4,
      replication_factor: config?.replicationFactor ?? topicConfig.replicationFactor ?? 1,
      configs: [
        { name: 'retention.ms', value: String(config?.retentionMs ?? topicConfig.retentionMs ?? 604800000) },
        { name: 'cleanup.policy', value: config?.cleanupPolicy ?? topicConfig.cleanupPolicy ?? 'delete' },
      ],
    });
  }

  /**
   * List topics
   */
  async listTopics(): Promise<string[]> {
    const result = await this.request<string[]>('GET', '/topics');
    return result;
  }

  /**
   * Get topic info
   */
  async topicInfo(topic: string): Promise<{
    name: string;
    partitions: Array<{
      partition: number;
      leader: number;
      replicas: number[];
    }>;
  }> {
    return await this.request('GET', `/topics/${topic}`);
  }

  // --- Consumer Groups ---

  /**
   * Create a consumer instance in a consumer group
   */
  async createConsumer(
    groupId: string,
    config: {
      instanceId?: string;
      format?: 'json' | 'binary' | 'avro';
      autoOffsetReset?: 'earliest' | 'latest';
      autoCommitEnable?: boolean;
    } = {}
  ): Promise<{ instance_id: string; base_uri: string }> {
    return await this.request('POST', `/consumers/${groupId}`, {
      name: config.instanceId ?? `mukoko-${crypto.randomUUID().slice(0, 8)}`,
      format: config.format ?? 'json',
      'auto.offset.reset': config.autoOffsetReset ?? 'earliest',
      'auto.commit.enable': config.autoCommitEnable ?? false,
    });
  }

  /**
   * Subscribe a consumer to topics
   */
  async subscribe(
    groupId: string,
    instanceId: string,
    topics: string[]
  ): Promise<void> {
    await this.request(
      'POST',
      `/consumers/${groupId}/instances/${instanceId}/subscription`,
      { topics }
    );
  }

  /**
   * Poll for records from a consumer
   */
  async poll<T = unknown>(
    groupId: string,
    instanceId: string,
    maxRecords?: number
  ): Promise<KafkaConsumeResult<T>> {
    const params = maxRecords ? `?max_records=${maxRecords}` : '';
    const records = await this.request<Array<{
      topic: string;
      key: string | null;
      value: T;
      partition: number;
      offset: number;
      timestamp: number;
    }>>(
      'GET',
      `/consumers/${groupId}/instances/${instanceId}/records${params}`
    );
    return { records: records ?? [] };
  }

  /**
   * Commit offsets for a consumer
   */
  async commitOffsets(
    groupId: string,
    instanceId: string,
    offsets?: Array<{ topic: string; partition: number; offset: number }>
  ): Promise<void> {
    await this.request(
      'POST',
      `/consumers/${groupId}/instances/${instanceId}/offsets`,
      offsets ? { offsets } : {}
    );
  }

  // --- Initialize Platform Topics ---

  /**
   * Initialize all Mukoko Kafka topics
   */
  async initializeTopics(): Promise<void> {
    const existingTopics = await this.listTopics().catch(() => [] as string[]);

    for (const [, topicName] of Object.entries(MUKOKO_TOPICS)) {
      if (existingTopics.includes(topicName)) {
        console.log(`[KAFKA] Topic ${topicName} already exists`);
        continue;
      }

      try {
        await this.createTopic(topicName);
        console.log(`[KAFKA] Topic ${topicName} created`);
      } catch (error) {
        console.error(`[KAFKA] Failed to create topic ${topicName}:`, error);
      }
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<{ ok: boolean; latencyMs: number; brokerCount?: number }> {
    const start = Date.now();
    try {
      const result = await this.request<{ brokers: unknown[] }>('GET', '/brokers');
      return {
        ok: true,
        latencyMs: Date.now() - start,
        brokerCount: result?.brokers?.length,
      };
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
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.kafka.v2+json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/vnd.kafka.json.v2+json';
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new KafkaError(`Kafka ${method} ${path} failed (${response.status}): ${error}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : ({} as T);
  }
}

export class KafkaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KafkaError';
  }
}
