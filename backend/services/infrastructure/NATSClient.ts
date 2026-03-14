/**
 * NATSClient - NATS JetStream Event Bus
 *
 * Message queue for event-driven architecture. Handles:
 * - Webhook delivery (fan-out to subscribers)
 * - RSS feed update notifications
 * - Article processing pipeline events
 * - Real-time SSE event distribution
 * - Cross-service communication
 * - Open data change notifications
 *
 * Uses NATS HTTP API since Workers can't maintain TCP connections.
 * NATS runs on Fly.io with JetStream enabled for persistence.
 */

export interface NATSConfig {
  httpUrl: string; // http://nats.internal:8222
  authToken?: string;
  clusterId?: string;
}

export interface NATSMessage<T = unknown> {
  subject: string;
  data: T;
  headers?: Record<string, string>;
  timestamp: string;
  sequence?: number;
}

export interface NATSPublishResult {
  ok: boolean;
  stream?: string;
  seq?: number;
  duplicate?: boolean;
}

export interface NATSConsumerInfo {
  name: string;
  stream: string;
  config: {
    durable_name: string;
    deliver_subject: string;
    filter_subject: string;
    ack_policy: string;
    max_deliver: number;
    ack_wait: number;
  };
  delivered: { consumer_seq: number; stream_seq: number };
  ack_floor: { consumer_seq: number; stream_seq: number };
  num_pending: number;
  num_redelivered: number;
}

// Standard event subjects for the Mukoko platform
export const MUKOKO_SUBJECTS = {
  // Article lifecycle
  ARTICLE_CREATED: 'mukoko.article.created',
  ARTICLE_UPDATED: 'mukoko.article.updated',
  ARTICLE_PUBLISHED: 'mukoko.article.published',
  ARTICLE_DELETED: 'mukoko.article.deleted',
  ARTICLE_FLAGGED: 'mukoko.article.flagged',
  ARTICLE_MODERATED: 'mukoko.article.moderated',

  // Feed processing
  FEED_COLLECTED: 'mukoko.feed.collected',
  FEED_PROCESSED: 'mukoko.feed.processed',
  FEED_ERROR: 'mukoko.feed.error',

  // Source events
  SOURCE_ADDED: 'mukoko.source.added',
  SOURCE_REMOVED: 'mukoko.source.removed',
  SOURCE_HEALTH_CHANGED: 'mukoko.source.health_changed',

  // Publisher events
  PUBLISHER_REGISTERED: 'mukoko.publisher.registered',
  PUBLISHER_VERIFIED: 'mukoko.publisher.verified',
  PUBLISHER_ARTICLE_SUBMITTED: 'mukoko.publisher.article_submitted',

  // User events (anonymized)
  USER_ENGAGEMENT: 'mukoko.user.engagement',

  // Webhook delivery
  WEBHOOK_DISPATCH: 'mukoko.webhook.dispatch',
  WEBHOOK_DELIVERED: 'mukoko.webhook.delivered',
  WEBHOOK_FAILED: 'mukoko.webhook.failed',

  // Moderation events
  MODERATION_REQUIRED: 'mukoko.moderation.required',
  MODERATION_COMPLETED: 'mukoko.moderation.completed',
  FAKE_NEWS_DETECTED: 'mukoko.moderation.fake_news_detected',

  // Open data events
  OPEN_DATA_SNAPSHOT: 'mukoko.opendata.snapshot',
  OPEN_DATA_ACCESSED: 'mukoko.opendata.accessed',

  // Category/tag events
  CATEGORY_CREATED: 'mukoko.category.created',
  KEYWORD_DISCOVERED: 'mukoko.keyword.discovered',
  TAG_TRENDING: 'mukoko.tag.trending',

  // Breaking news
  BREAKING_NEWS: 'mukoko.breaking',

  // PII pipeline
  PII_SCAN_REQUESTED: 'mukoko.pii.scan_requested',
  PII_SCAN_COMPLETED: 'mukoko.pii.scan_completed',
  PII_REMOVED: 'mukoko.pii.removed',
} as const;

// JetStream stream configurations
export const MUKOKO_STREAMS = {
  ARTICLES: {
    name: 'ARTICLES',
    subjects: ['mukoko.article.>'],
    retention: 'limits' as const,
    max_age_hours: 720, // 30 days
    max_bytes: 1024 * 1024 * 1024, // 1GB
    storage: 'file' as const,
  },
  FEEDS: {
    name: 'FEEDS',
    subjects: ['mukoko.feed.>'],
    retention: 'limits' as const,
    max_age_hours: 168, // 7 days
    max_bytes: 256 * 1024 * 1024, // 256MB
    storage: 'file' as const,
  },
  WEBHOOKS: {
    name: 'WEBHOOKS',
    subjects: ['mukoko.webhook.>'],
    retention: 'workqueue' as const,
    max_age_hours: 72, // 3 days
    max_bytes: 512 * 1024 * 1024, // 512MB
    storage: 'file' as const,
  },
  MODERATION: {
    name: 'MODERATION',
    subjects: ['mukoko.moderation.>'],
    retention: 'limits' as const,
    max_age_hours: 2160, // 90 days
    max_bytes: 256 * 1024 * 1024,
    storage: 'file' as const,
  },
  OPEN_DATA: {
    name: 'OPEN_DATA',
    subjects: ['mukoko.opendata.>'],
    retention: 'limits' as const,
    max_age_hours: 720,
    max_bytes: 256 * 1024 * 1024,
    storage: 'file' as const,
  },
  BREAKING: {
    name: 'BREAKING',
    subjects: ['mukoko.breaking'],
    retention: 'limits' as const,
    max_age_hours: 24,
    max_bytes: 64 * 1024 * 1024,
    storage: 'memory' as const,
  },
} as const;

export class NATSClient {
  private baseUrl: string;
  private authToken?: string;

  constructor(config: NATSConfig) {
    this.baseUrl = config.httpUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
  }

  // --- Publishing ---

  /**
   * Publish a message to a subject
   */
  async publish<T>(
    subject: string,
    data: T,
    options: {
      headers?: Record<string, string>;
      msgId?: string; // For deduplication
    } = {}
  ): Promise<NATSPublishResult> {
    const message: NATSMessage<T> = {
      subject,
      data,
      headers: {
        ...options.headers,
        'Nats-Msg-Id': options.msgId ?? crypto.randomUUID(),
        'X-Mukoko-Timestamp': new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    const response = await this.request('POST', '/publish', message);
    return response as NATSPublishResult;
  }

  /**
   * Publish a batch of messages
   */
  async publishBatch<T>(
    messages: Array<{ subject: string; data: T }>
  ): Promise<NATSPublishResult[]> {
    const results: NATSPublishResult[] = [];
    // NATS HTTP doesn't support native batch, so we parallelize
    const promises = messages.map(msg =>
      this.publish(msg.subject, msg.data)
    );
    return Promise.all(promises);
  }

  // --- JetStream Management ---

  /**
   * Create or update a JetStream stream
   */
  async createStream(config: {
    name: string;
    subjects: string[];
    retention?: 'limits' | 'interest' | 'workqueue';
    max_age_hours?: number;
    max_bytes?: number;
    storage?: 'file' | 'memory';
    num_replicas?: number;
  }): Promise<{ created: boolean; config: unknown }> {
    const streamConfig = {
      name: config.name,
      subjects: config.subjects,
      retention: config.retention ?? 'limits',
      max_age: config.max_age_hours ? config.max_age_hours * 3600 * 1e9 : 0, // nanoseconds
      max_bytes: config.max_bytes ?? -1,
      storage: config.storage ?? 'file',
      num_replicas: config.num_replicas ?? 1,
      discard: 'old',
      duplicate_window: 120 * 1e9, // 2 minutes dedup window
    };

    try {
      const result = await this.request(
        'POST',
        '/jsz/streams',
        streamConfig
      );
      return { created: true, config: result };
    } catch (error) {
      // Stream may already exist, try to update
      const result = await this.request(
        'PUT',
        `/jsz/streams/${config.name}`,
        streamConfig
      );
      return { created: false, config: result };
    }
  }

  /**
   * Create a durable consumer for a stream
   */
  async createConsumer(
    streamName: string,
    config: {
      durableName: string;
      filterSubject?: string;
      deliverSubject?: string;
      maxDeliver?: number;
      ackWaitSeconds?: number;
      maxAckPending?: number;
    }
  ): Promise<NATSConsumerInfo> {
    const consumerConfig = {
      durable_name: config.durableName,
      filter_subject: config.filterSubject,
      deliver_subject: config.deliverSubject,
      ack_policy: 'explicit',
      max_deliver: config.maxDeliver ?? 5,
      ack_wait: (config.ackWaitSeconds ?? 30) * 1e9, // nanoseconds
      max_ack_pending: config.maxAckPending ?? 1000,
    };

    return await this.request(
      'POST',
      `/jsz/streams/${streamName}/consumers`,
      consumerConfig
    ) as NATSConsumerInfo;
  }

  /**
   * Pull messages from a consumer (for webhook workers)
   */
  async pull(
    streamName: string,
    consumerName: string,
    batchSize: number = 10
  ): Promise<NATSMessage[]> {
    const result = await this.request(
      'POST',
      `/jsz/streams/${streamName}/consumers/${consumerName}/pull`,
      { batch: batchSize, expires: 5000000000 } // 5 second timeout
    );
    return (result as { messages?: NATSMessage[] })?.messages ?? [];
  }

  /**
   * Acknowledge a message
   */
  async ack(
    streamName: string,
    consumerName: string,
    sequence: number
  ): Promise<void> {
    await this.request(
      'POST',
      `/jsz/streams/${streamName}/consumers/${consumerName}/ack`,
      { sequence }
    );
  }

  // --- Stream Info ---

  /**
   * Get stream info
   */
  async streamInfo(streamName: string): Promise<{
    config: unknown;
    state: {
      messages: number;
      bytes: number;
      first_seq: number;
      last_seq: number;
      consumer_count: number;
    };
  }> {
    return await this.request('GET', `/jsz/streams/${streamName}`) as any;
  }

  // --- Initialize Platform Streams ---

  /**
   * Initialize all Mukoko platform streams
   */
  async initializeStreams(): Promise<void> {
    for (const [name, config] of Object.entries(MUKOKO_STREAMS)) {
      try {
        await this.createStream(config);
        console.log(`[NATS] Stream ${name} initialized`);
      } catch (error) {
        console.error(`[NATS] Failed to initialize stream ${name}:`, error);
      }
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<{ ok: boolean; latencyMs: number; serverInfo?: unknown }> {
    const start = Date.now();
    try {
      const info = await this.request('GET', '/healthz');
      return { ok: true, latencyMs: Date.now() - start, serverInfo: info };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  // --- Internal ---

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new NATSError(`NATS ${method} ${path} failed (${response.status}): ${error}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
}

export class NATSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NATSError';
  }
}
