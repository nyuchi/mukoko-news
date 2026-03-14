/**
 * Infrastructure Registry - Central hub for all external service connections
 *
 * This module initializes and manages connections to all infrastructure services.
 * Services are lazily initialized and cached for the lifetime of the Worker.
 *
 * Architecture:
 *   D1 (Cloudflare)       → Edge reads (fast, <10ms)
 *   Postgres (Fly.io)     → Processing writes, complex queries
 *   CouchDB (Fly.io)      → Document store, publisher content, offline sync
 *   Doris (Fly.io)        → Analytics OLAP (sub-second aggregation)
 *   NATS (Fly.io)         → Event bus, webhook delivery
 *   Kafka (Fly.io)        → Data pipeline, PII removal, analytics streaming
 *   Meilisearch (Fly.io)  → Full-text search, typo-tolerant, multilingual
 *   Dragonfly (Fly.io)    → Redis-compatible cache, rate limiting
 */

export { PostgresClient, PostgresError } from './PostgresClient.js';
export type { PostgresConfig, QueryResult, PostgresStatement } from './PostgresClient.js';

export { CouchDBClient, CouchDBError } from './CouchDBClient.js';
export type { CouchDBConfig, CouchDBDocument, CouchDBResponse, CouchDBViewResult, CouchDBChanges } from './CouchDBClient.js';

export { DorisClient, DorisError, DORIS_TABLES } from './DorisClient.js';
export type { DorisConfig, DorisQueryResult, DorisStreamLoadResult } from './DorisClient.js';

export { NATSClient, NATSError, MUKOKO_SUBJECTS, MUKOKO_STREAMS } from './NATSClient.js';
export type { NATSConfig, NATSMessage, NATSPublishResult } from './NATSClient.js';

export { KafkaClient, KafkaError, MUKOKO_TOPICS, MUKOKO_TOPIC_CONFIGS } from './KafkaClient.js';
export type { KafkaConfig, KafkaRecord, KafkaProduceResult } from './KafkaClient.js';

export { MeilisearchClient, MeilisearchError, MUKOKO_INDEXES } from './MeilisearchClient.js';
export type { MeilisearchConfig, MeilisearchSearchResult, MeilisearchDocument } from './MeilisearchClient.js';

export { DragonflyCacheClient, CacheError } from './DragonflyCacheClient.js';
export type { DragonflyCacheConfig } from './DragonflyCacheClient.js';

export { D1KeyValueAdapter, createD1Cache } from './D1KeyValueAdapter.js';
export type { KVCompatible } from './D1KeyValueAdapter.js';

import { PostgresClient, type PostgresConfig } from './PostgresClient.js';
import { CouchDBClient, type CouchDBConfig } from './CouchDBClient.js';
import { DorisClient, type DorisConfig } from './DorisClient.js';
import { NATSClient, type NATSConfig } from './NATSClient.js';
import { KafkaClient, type KafkaConfig } from './KafkaClient.js';
import { MeilisearchClient, type MeilisearchConfig } from './MeilisearchClient.js';
import { DragonflyCacheClient, type DragonflyCacheConfig } from './DragonflyCacheClient.js';

/**
 * Infrastructure bindings - environment variables for all external services.
 * These are set via wrangler secrets or environment config.
 */
export interface InfrastructureBindings {
  // Fly.io Postgres
  POSTGRES_URL?: string;          // http://postgres-proxy.internal:5432
  POSTGRES_AUTH_TOKEN?: string;

  // CouchDB
  COUCHDB_URL?: string;           // http://couchdb.internal:5984
  COUCHDB_USERNAME?: string;
  COUCHDB_PASSWORD?: string;
  COUCHDB_DATABASE?: string;

  // Apache Doris
  DORIS_HTTP_URL?: string;        // http://doris-fe.internal:8030
  DORIS_USERNAME?: string;
  DORIS_PASSWORD?: string;
  DORIS_DATABASE?: string;

  // NATS
  NATS_HTTP_URL?: string;         // http://nats.internal:8222
  NATS_AUTH_TOKEN?: string;

  // Kafka
  KAFKA_REST_PROXY_URL?: string;  // http://kafka-proxy.internal:8082
  KAFKA_AUTH_TOKEN?: string;

  // Meilisearch
  MEILISEARCH_URL?: string;       // http://meilisearch.internal:7700
  MEILISEARCH_API_KEY?: string;

  // Dragonfly (Redis-compatible cache)
  DRAGONFLY_URL?: string;         // http://dragonfly-proxy.internal:6380
  DRAGONFLY_AUTH_TOKEN?: string;
}

/**
 * InfrastructureRegistry - Lazily initializes and provides access to all services.
 * Each service is only initialized when first accessed.
 */
export class InfrastructureRegistry {
  private _postgres?: PostgresClient;
  private _couchdb?: CouchDBClient;
  private _doris?: DorisClient;
  private _nats?: NATSClient;
  private _kafka?: KafkaClient;
  private _meilisearch?: MeilisearchClient;
  private _dragonfly?: DragonflyCacheClient;

  constructor(private bindings: InfrastructureBindings) {}

  /**
   * Fly.io Managed PostgreSQL - Heavy processing, complex queries
   */
  get postgres(): PostgresClient | null {
    if (!this.bindings.POSTGRES_URL) return null;
    if (!this._postgres) {
      const config: PostgresConfig = {
        connectionString: this.bindings.POSTGRES_URL,
        queryTimeoutMs: 30000,
      };
      this._postgres = new PostgresClient(config);
      if (this.bindings.POSTGRES_AUTH_TOKEN) {
        this._postgres.authenticate(this.bindings.POSTGRES_AUTH_TOKEN);
      }
    }
    return this._postgres;
  }

  /**
   * Apache CouchDB - Document store, offline sync, open data
   */
  get couchdb(): CouchDBClient | null {
    if (!this.bindings.COUCHDB_URL) return null;
    if (!this._couchdb) {
      const config: CouchDBConfig = {
        url: this.bindings.COUCHDB_URL,
        username: this.bindings.COUCHDB_USERNAME ?? 'admin',
        password: this.bindings.COUCHDB_PASSWORD ?? '',
        database: this.bindings.COUCHDB_DATABASE ?? 'mukoko',
      };
      this._couchdb = new CouchDBClient(config);
    }
    return this._couchdb;
  }

  /**
   * Apache Doris - Real-time analytics OLAP
   */
  get doris(): DorisClient | null {
    if (!this.bindings.DORIS_HTTP_URL) return null;
    if (!this._doris) {
      const config: DorisConfig = {
        httpUrl: this.bindings.DORIS_HTTP_URL,
        username: this.bindings.DORIS_USERNAME ?? 'root',
        password: this.bindings.DORIS_PASSWORD ?? '',
        database: this.bindings.DORIS_DATABASE ?? 'mukoko_analytics',
      };
      this._doris = new DorisClient(config);
    }
    return this._doris;
  }

  /**
   * NATS JetStream - Event bus, webhooks
   */
  get nats(): NATSClient | null {
    if (!this.bindings.NATS_HTTP_URL) return null;
    if (!this._nats) {
      const config: NATSConfig = {
        httpUrl: this.bindings.NATS_HTTP_URL,
        authToken: this.bindings.NATS_AUTH_TOKEN,
      };
      this._nats = new NATSClient(config);
    }
    return this._nats;
  }

  /**
   * Apache Kafka - Data pipeline, PII removal, analytics
   */
  get kafka(): KafkaClient | null {
    if (!this.bindings.KAFKA_REST_PROXY_URL) return null;
    if (!this._kafka) {
      const config: KafkaConfig = {
        restProxyUrl: this.bindings.KAFKA_REST_PROXY_URL,
        authToken: this.bindings.KAFKA_AUTH_TOKEN,
      };
      this._kafka = new KafkaClient(config);
    }
    return this._kafka;
  }

  /**
   * Meilisearch - Full-text search engine
   */
  get meilisearch(): MeilisearchClient | null {
    if (!this.bindings.MEILISEARCH_URL) return null;
    if (!this._meilisearch) {
      const config: MeilisearchConfig = {
        url: this.bindings.MEILISEARCH_URL,
        apiKey: this.bindings.MEILISEARCH_API_KEY ?? '',
      };
      this._meilisearch = new MeilisearchClient(config);
    }
    return this._meilisearch;
  }

  /**
   * Dragonfly - Redis-compatible high-performance cache
   */
  get dragonfly(): DragonflyCacheClient | null {
    if (!this.bindings.DRAGONFLY_URL) return null;
    if (!this._dragonfly) {
      const config: DragonflyCacheConfig = {
        httpUrl: this.bindings.DRAGONFLY_URL,
        authToken: this.bindings.DRAGONFLY_AUTH_TOKEN,
      };
      this._dragonfly = new DragonflyCacheClient(config);
    }
    return this._dragonfly;
  }

  /**
   * Health check all configured services
   */
  async healthCheck(): Promise<Record<string, { ok: boolean; latencyMs: number; error?: string }>> {
    const checks: Record<string, Promise<{ ok: boolean; latencyMs: number }>> = {};

    if (this.postgres) checks.postgres = this.postgres.ping();
    if (this.couchdb) checks.couchdb = this.couchdb.ping();
    if (this.doris) checks.doris = this.doris.ping();
    if (this.nats) checks.nats = this.nats.ping();
    if (this.kafka) checks.kafka = this.kafka.ping();
    if (this.meilisearch) checks.meilisearch = this.meilisearch.ping();
    if (this.dragonfly) checks.dragonfly = this.dragonfly.ping();

    const results: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {};

    for (const [name, promise] of Object.entries(checks)) {
      try {
        results[name] = await promise;
      } catch (error) {
        results[name] = {
          ok: false,
          latencyMs: -1,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return results;
  }

  /**
   * Initialize all configured services (create tables, indexes, streams, topics)
   */
  async initialize(): Promise<void> {
    const tasks: Promise<void>[] = [];

    if (this.doris) tasks.push(this.doris.initializeTables());
    if (this.nats) tasks.push(this.nats.initializeStreams());
    if (this.kafka) tasks.push(this.kafka.initializeTopics());
    if (this.meilisearch) tasks.push(this.meilisearch.initializeIndexes());
    if (this.couchdb) tasks.push(this.couchdb.ensureDatabase());

    await Promise.allSettled(tasks);
    console.log('[INFRA] Infrastructure initialization complete');
  }

  /**
   * Get a summary of which services are configured
   */
  get status(): Record<string, boolean> {
    return {
      postgres: !!this.bindings.POSTGRES_URL,
      couchdb: !!this.bindings.COUCHDB_URL,
      doris: !!this.bindings.DORIS_HTTP_URL,
      nats: !!this.bindings.NATS_HTTP_URL,
      kafka: !!this.bindings.KAFKA_REST_PROXY_URL,
      meilisearch: !!this.bindings.MEILISEARCH_URL,
      dragonfly: !!this.bindings.DRAGONFLY_URL,
    };
  }
}
