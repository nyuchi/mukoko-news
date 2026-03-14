/**
 * DataSyncService - Multi-database synchronization layer
 *
 * Coordinates data flow between the layered database architecture:
 *   D1 (edge)      → Fast reads, serving API responses
 *   Postgres        → Processing, complex queries, source of truth for writes
 *   CouchDB         → Publisher documents, version history, open data replication
 *   Meilisearch     → Search index
 *   Doris           → Analytics
 *
 * Sync strategy:
 *   1. Writes go to Postgres (source of truth)
 *   2. Changes are propagated to D1 (edge cache), CouchDB (documents), Meilisearch (search)
 *   3. Analytics events are streamed to Kafka → Doris
 *   4. CouchDB provides open data replication endpoint
 */

import type { InfrastructureRegistry } from './index.js';
import type { CouchDBDocument } from './CouchDBClient.js';

export interface SyncResult {
  d1: { success: boolean; error?: string };
  postgres?: { success: boolean; error?: string };
  couchdb?: { success: boolean; error?: string };
  meilisearch?: { success: boolean; error?: string };
  kafka?: { success: boolean; error?: string };
}

export interface ArticleSyncData {
  id: string;
  title: string;
  description?: string;
  content?: string;
  url: string;
  image_url?: string;
  author?: string;
  published_at: string;
  source_id: string;
  source_name: string;
  country_code: string;
  category?: string;
  keywords?: string[];
  quality_score?: number;
  status: string;
  language?: string;
}

export interface SourceSyncData {
  id: string;
  name: string;
  url: string;
  feed_url: string;
  country_code: string;
  description?: string;
  status: string;
  health_status?: string;
  article_count?: number;
}

export interface CategorySyncData {
  id: string;
  name: string;
  slug: string;
  description?: string;
  article_count?: number;
  parent_id?: string;
}

export interface KeywordSyncData {
  id: string;
  term: string;
  slug: string;
  category?: string;
  usage_count: number;
  trending_score?: number;
  aliases?: string[];
  first_seen_at: string;
  last_seen_at: string;
}

export class DataSyncService {
  constructor(
    private db: D1Database,
    private infra: InfrastructureRegistry
  ) {}

  // --- Article Sync ---

  /**
   * Sync an article across all data stores
   */
  async syncArticle(article: ArticleSyncData): Promise<SyncResult> {
    const result: SyncResult = {
      d1: { success: false },
    };

    // 1. D1 (edge) - always sync
    try {
      await this.syncArticleToD1(article);
      result.d1 = { success: true };
    } catch (error) {
      result.d1 = { success: false, error: String(error) };
    }

    // 2. CouchDB (document store) - if configured
    if (this.infra.couchdb) {
      try {
        await this.syncArticleToCouchDB(article);
        result.couchdb = { success: true };
      } catch (error) {
        result.couchdb = { success: false, error: String(error) };
      }
    }

    // 3. Meilisearch (search index) - if configured
    if (this.infra.meilisearch) {
      try {
        await this.infra.meilisearch.addDocuments('articles', [{
          id: article.id,
          title: article.title,
          description: article.description ?? '',
          content: article.content ?? '',
          author: article.author ?? '',
          source_name: article.source_name,
          source_id: article.source_id,
          keywords: article.keywords?.join(' ') ?? '',
          country_code: article.country_code,
          category: article.category ?? '',
          published_at: new Date(article.published_at).getTime(),
          status: article.status,
          quality_score: article.quality_score ?? 0,
          language: article.language ?? 'en',
          views: 0,
          engagement_score: 0,
        }]);
        result.meilisearch = { success: true };
      } catch (error) {
        result.meilisearch = { success: false, error: String(error) };
      }
    }

    // 4. Kafka (analytics pipeline) - if configured
    if (this.infra.kafka) {
      try {
        await this.infra.kafka.publishOpenData('articles', {
          id: article.id,
          title: article.title,
          description: article.description,
          url: article.url,
          source_name: article.source_name,
          country_code: article.country_code,
          category: article.category,
          keywords: article.keywords,
          published_at: article.published_at,
          // No PII fields sent to open data
        });
        result.kafka = { success: true };
      } catch (error) {
        result.kafka = { success: false, error: String(error) };
      }
    }

    return result;
  }

  /**
   * Batch sync articles
   */
  async syncArticleBatch(articles: ArticleSyncData[]): Promise<{
    synced: number;
    failed: number;
    errors: string[];
  }> {
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    // Batch to Meilisearch
    if (this.infra.meilisearch && articles.length > 0) {
      try {
        await this.infra.meilisearch.addDocuments(
          'articles',
          articles.map(a => ({
            id: a.id,
            title: a.title,
            description: a.description ?? '',
            content: a.content ?? '',
            author: a.author ?? '',
            source_name: a.source_name,
            source_id: a.source_id,
            keywords: a.keywords?.join(' ') ?? '',
            country_code: a.country_code,
            category: a.category ?? '',
            published_at: new Date(a.published_at).getTime(),
            status: a.status,
            quality_score: a.quality_score ?? 0,
            language: a.language ?? 'en',
            views: 0,
            engagement_score: 0,
          }))
        );
      } catch (error) {
        errors.push(`Meilisearch batch sync failed: ${error}`);
      }
    }

    // Batch to CouchDB
    if (this.infra.couchdb && articles.length > 0) {
      try {
        const docs: CouchDBDocument[] = articles.map(a => ({
          _id: `article:${a.id}`,
          type: 'article',
          ...a,
          syncedAt: new Date().toISOString(),
        }));
        await this.infra.couchdb.bulkDocs(docs);
      } catch (error) {
        errors.push(`CouchDB batch sync failed: ${error}`);
      }
    }

    // Individual D1 syncs (D1 doesn't support true batch inserts well)
    for (const article of articles) {
      try {
        await this.syncArticleToD1(article);
        synced++;
      } catch (error) {
        failed++;
        errors.push(`D1 sync failed for ${article.id}: ${error}`);
      }
    }

    return { synced, failed, errors };
  }

  // --- Source Sync ---

  /**
   * Sync a news source across all stores
   */
  async syncSource(source: SourceSyncData): Promise<SyncResult> {
    const result: SyncResult = { d1: { success: false } };

    try {
      await this.db.prepare(`
        INSERT OR REPLACE INTO rss_sources (id, name, url, feed_url, country_id, description, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        source.id, source.name, source.url, source.feed_url,
        source.country_code, source.description ?? '', source.status === 'active' ? 1 : 0
      ).run();
      result.d1 = { success: true };
    } catch (error) {
      result.d1 = { success: false, error: String(error) };
    }

    if (this.infra.meilisearch) {
      try {
        await this.infra.meilisearch.addDocuments('sources', [{
          id: source.id,
          name: source.name,
          url: source.url,
          description: source.description ?? '',
          country_code: source.country_code,
          country_name: source.country_code, // Resolve from constants
          status: source.status,
          health_status: source.health_status ?? 'unknown',
          article_count: source.article_count ?? 0,
        }]);
        result.meilisearch = { success: true };
      } catch (error) {
        result.meilisearch = { success: false, error: String(error) };
      }
    }

    if (this.infra.kafka) {
      try {
        await this.infra.kafka.publishOpenData('sources', {
          id: source.id,
          name: source.name,
          url: source.url,
          country_code: source.country_code,
          status: source.status,
          health_status: source.health_status,
        });
        result.kafka = { success: true };
      } catch (error) {
        result.kafka = { success: false, error: String(error) };
      }
    }

    return result;
  }

  // --- Category Sync ---

  /**
   * Sync a category (dynamic, DB-driven)
   */
  async syncCategory(category: CategorySyncData): Promise<SyncResult> {
    const result: SyncResult = { d1: { success: false } };

    try {
      await this.db.prepare(`
        INSERT OR REPLACE INTO categories (id, name, slug, description)
        VALUES (?, ?, ?, ?)
      `).bind(
        category.id, category.name, category.slug, category.description ?? ''
      ).run();
      result.d1 = { success: true };
    } catch (error) {
      result.d1 = { success: false, error: String(error) };
    }

    if (this.infra.kafka) {
      try {
        await this.infra.kafka.publishOpenData('categories', {
          id: category.id,
          name: category.name,
          slug: category.slug,
          article_count: category.article_count ?? 0,
        });
        result.kafka = { success: true };
      } catch (error) {
        result.kafka = { success: false, error: String(error) };
      }
    }

    return result;
  }

  // --- Keyword/Tag Sync ---

  /**
   * Sync a keyword/tag (dynamic, auto-discovered)
   */
  async syncKeyword(keyword: KeywordSyncData): Promise<SyncResult> {
    const result: SyncResult = { d1: { success: false } };

    try {
      await this.db.prepare(`
        INSERT OR REPLACE INTO defined_terms (id, term, slug, category, usage_count, trending_score, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        keyword.id, keyword.term, keyword.slug, keyword.category ?? '',
        keyword.usage_count, keyword.trending_score ?? 0,
        keyword.first_seen_at, keyword.last_seen_at
      ).run();
      result.d1 = { success: true };
    } catch (error) {
      result.d1 = { success: false, error: String(error) };
    }

    if (this.infra.meilisearch) {
      try {
        await this.infra.meilisearch.addDocuments('keywords', [{
          id: keyword.id,
          term: keyword.term,
          aliases: keyword.aliases?.join(' ') ?? '',
          category: keyword.category ?? '',
          country_code: '',
          trending: (keyword.trending_score ?? 0) > 0,
          usage_count: keyword.usage_count,
          trending_score: keyword.trending_score ?? 0,
        }]);
        result.meilisearch = { success: true };
      } catch (error) {
        result.meilisearch = { success: false, error: String(error) };
      }
    }

    return result;
  }

  // --- Analytics Sync ---

  /**
   * Stream an analytics event to Doris via Kafka
   */
  async streamAnalytics(
    type: 'article_view' | 'search_query' | 'user_event' | 'source_health',
    data: Record<string, unknown>
  ): Promise<void> {
    // Direct to Doris if available
    if (this.infra.doris) {
      try {
        const tableMap: Record<string, string> = {
          article_view: 'article_metrics',
          search_query: 'search_analytics',
          user_event: 'user_analytics',
          source_health: 'source_health_history',
        };
        await this.infra.doris.streamLoad(tableMap[type], [data]);
        return;
      } catch (error) {
        console.error(`[SYNC] Direct Doris load failed, falling back to Kafka: ${error}`);
      }
    }

    // Fallback to Kafka pipeline
    if (this.infra.kafka) {
      await this.infra.kafka.emitAnalytics(type, data);
    }
  }

  // --- Private Helpers ---

  private async syncArticleToD1(article: ArticleSyncData): Promise<void> {
    await this.db.prepare(`
      INSERT OR REPLACE INTO articles
        (id, title, description, content, url, image_url, author, published_at,
         source_id, country_id, status, quality_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      article.id, article.title, article.description ?? '',
      article.content ?? '', article.url, article.image_url ?? '',
      article.author ?? '', article.published_at, article.source_id,
      article.country_code, article.status, article.quality_score ?? 0
    ).run();
  }

  private async syncArticleToCouchDB(article: ArticleSyncData): Promise<void> {
    if (!this.infra.couchdb) return;

    const doc: CouchDBDocument = {
      _id: `article:${article.id}`,
      type: 'article',
      ...article,
      syncedAt: new Date().toISOString(),
    };

    // Try to get existing doc for revision
    const existing = await this.infra.couchdb.get(`article:${article.id}`);
    if (existing?._rev) {
      doc._rev = existing._rev;
    }

    await this.infra.couchdb.put(doc);
  }
}
