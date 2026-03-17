/**
 * OpenDataService - Mukoko Open Data Platform
 *
 * Mukoko is an open data platform. Business data is open except
 * that which is generally private (PII).
 *
 * Open data includes:
 * - Article metadata (title, description, source, category, keywords, published_at)
 * - Source directory (name, URL, country, health status)
 * - Categories and keywords/tags
 * - Aggregate analytics (trends, engagement stats - anonymized)
 * - Geographic distribution (country-level, not user-level)
 *
 * NOT open data (PII / private):
 * - User accounts, emails, phone numbers
 * - Individual user behavior or preferences
 * - Session tokens, API keys
 * - IP addresses, device identifiers
 * - Precise location data
 *
 * Formats: JSON API, CSV export, CouchDB replication, Kafka stream
 */

export interface OpenDataManifesto {
  version: '1.0';
  organization: 'Mukoko News';
  commitment: string;
  license: string;
  dataCategories: OpenDataCategory[];
  privacyBoundaries: PrivacyBoundary[];
  accessMethods: AccessMethod[];
  updateFrequency: string;
  contact: string;
}

export interface OpenDataCategory {
  name: string;
  description: string;
  endpoints: string[];
  format: string[];
  updateFrequency: string;
  license: string;
}

export interface PrivacyBoundary {
  category: string;
  description: string;
  handling: string;
}

export interface AccessMethod {
  name: string;
  type: 'api' | 'feed' | 'replication' | 'stream' | 'export';
  url: string;
  description: string;
  authentication: string;
}

export interface OpenDataExport {
  format: 'json' | 'csv' | 'jsonl';
  data: Record<string, unknown>[];
  metadata: {
    exported_at: string;
    record_count: number;
    data_type: string;
    license: string;
    attribution: string;
  };
}

// The Mukoko Open Data Manifesto
export const MANIFESTO: OpenDataManifesto = {
  version: '1.0',
  organization: 'Mukoko News',
  commitment: `Mukoko News believes in the free flow of information across Africa.
We are committed to making our business data openly accessible to researchers,
developers, journalists, and the public. Our data is African-first and culturally
aligned, serving the communities from which it originates. We protect individual
privacy while maximizing the public benefit of aggregate information.`,
  license: 'CC BY 4.0 (Creative Commons Attribution 4.0 International)',
  dataCategories: [
    {
      name: 'Articles',
      description: 'News article metadata from across Africa',
      endpoints: ['/api/v1/open-data/articles'],
      format: ['json', 'csv', 'jsonl', 'rss', 'atom'],
      updateFrequency: 'Real-time (via Kafka stream) or hourly (API)',
      license: 'CC BY 4.0',
    },
    {
      name: 'Sources',
      description: 'News source directory with health status',
      endpoints: ['/api/v1/open-data/sources'],
      format: ['json', 'csv'],
      updateFrequency: 'Daily',
      license: 'CC BY 4.0',
    },
    {
      name: 'Categories',
      description: 'News categories and their article counts',
      endpoints: ['/api/v1/open-data/categories'],
      format: ['json'],
      updateFrequency: 'Real-time',
      license: 'CC0 1.0',
    },
    {
      name: 'Keywords/Tags',
      description: 'Trending topics and keywords across African news',
      endpoints: ['/api/v1/open-data/keywords'],
      format: ['json', 'csv'],
      updateFrequency: 'Hourly',
      license: 'CC BY 4.0',
    },
    {
      name: 'Aggregate Analytics',
      description: 'Anonymized engagement and trend data',
      endpoints: ['/api/v1/open-data/analytics'],
      format: ['json'],
      updateFrequency: 'Daily',
      license: 'CC BY 4.0',
    },
    {
      name: 'Countries',
      description: 'African country directory with news source counts',
      endpoints: ['/api/v1/open-data/countries'],
      format: ['json'],
      updateFrequency: 'Weekly',
      license: 'CC0 1.0',
    },
  ],
  privacyBoundaries: [
    {
      category: 'User Identifiers',
      description: 'Email addresses, phone numbers, user IDs',
      handling: 'Never included in open data. Anonymized for analytics.',
    },
    {
      category: 'Authentication',
      description: 'API keys, tokens, session data',
      handling: 'Completely excluded from all data exports.',
    },
    {
      category: 'User Behavior',
      description: 'Individual reading history, preferences',
      handling: 'Only available as aggregated, anonymized statistics.',
    },
    {
      category: 'Location Data',
      description: 'IP addresses, precise coordinates',
      handling: 'Aggregated to country level only. No IP addresses exported.',
    },
    {
      category: 'Device Information',
      description: 'User agents, device IDs, fingerprints',
      handling: 'Completely excluded from all data exports.',
    },
  ],
  accessMethods: [
    {
      name: 'REST API',
      type: 'api',
      url: 'https://mukoko-news-api.fly.dev/api/v1/open-data',
      description: 'JSON API with pagination, filtering, and cursor support',
      authentication: 'API key (free open_data tier available)',
    },
    {
      name: 'RSS/Atom Feeds',
      type: 'feed',
      url: 'https://mukoko-news-api.fly.dev/feeds',
      description: 'Syndication feeds in RSS 2.0, Atom, and JSON Feed formats',
      authentication: 'None (public)',
    },
    {
      name: 'CouchDB Replication',
      type: 'replication',
      url: 'https://opendata.mukoko.com',
      description: 'Full CouchDB replication for local data mirroring',
      authentication: 'API key for write access, read is public',
    },
    {
      name: 'Kafka Stream',
      type: 'stream',
      url: 'kafka://stream.mukoko.com',
      description: 'Real-time data stream via Apache Kafka',
      authentication: 'Enterprise API key required',
    },
    {
      name: 'Bulk Export',
      type: 'export',
      url: 'https://mukoko-news-api.fly.dev/api/v1/open-data/export',
      description: 'CSV/JSONL bulk export with date range filtering',
      authentication: 'API key (any tier)',
    },
  ],
  updateFrequency: 'Articles: real-time. Analytics: daily. Sources: daily. Countries: weekly.',
  contact: 'opendata@mukoko.com',
};

export class OpenDataService {
  constructor(private db: D1Database) {}

  /**
   * Get the open data manifesto
   */
  getManifesto(): OpenDataManifesto {
    return MANIFESTO;
  }

  /**
   * Get open data articles (PII-free)
   */
  async getArticles(options: {
    country?: string;
    category?: string;
    since?: string;
    until?: string;
    limit?: number;
    cursor?: string;
    format?: 'json' | 'csv' | 'jsonl';
  } = {}): Promise<OpenDataExport> {
    const conditions: string[] = ["status = 'published'"];
    const params: unknown[] = [];

    if (options.country) {
      conditions.push('country_id = ?');
      params.push(options.country);
    }

    if (options.since) {
      conditions.push('published_at >= ?');
      params.push(options.since);
    }

    if (options.until) {
      conditions.push('published_at <= ?');
      params.push(options.until);
    }

    if (options.cursor) {
      conditions.push('id > ?');
      params.push(options.cursor);
    }

    const limit = Math.min(options.limit ?? 100, 1000);
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const result = await this.db.prepare(`
      SELECT id, title, description, url, image_url, author,
             published_at, source_id, country_id as country_code,
             quality_score, views, likes, saves, shares
      FROM articles
      ${whereClause}
      ORDER BY id ASC
      LIMIT ?
    `).bind(...params, limit).all();

    // Strip any remaining PII (defense in depth)
    const data = (result.results ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      url: row.url,
      image_url: row.image_url,
      author: row.author,
      published_at: row.published_at,
      source_id: row.source_id,
      country_code: row.country_code,
      quality_score: row.quality_score,
      engagement: {
        views: row.views,
        likes: row.likes,
        saves: row.saves,
        shares: row.shares,
      },
    }));

    return {
      format: options.format ?? 'json',
      data,
      metadata: {
        exported_at: new Date().toISOString(),
        record_count: data.length,
        data_type: 'articles',
        license: 'CC BY 4.0',
        attribution: 'Mukoko News (news.mukoko.com)',
      },
    };
  }

  /**
   * Get open data sources
   */
  async getSources(): Promise<OpenDataExport> {
    const result = await this.db.prepare(`
      SELECT rs.id, rs.name, rs.url, rs.country_id as country_code,
             rs.enabled,
             COUNT(a.id) as article_count
      FROM rss_sources rs
      LEFT JOIN articles a ON a.source_id = rs.id
      GROUP BY rs.id
      ORDER BY rs.name
    `).all();

    return {
      format: 'json',
      data: (result.results ?? []) as Record<string, unknown>[],
      metadata: {
        exported_at: new Date().toISOString(),
        record_count: result.results?.length ?? 0,
        data_type: 'sources',
        license: 'CC BY 4.0',
        attribution: 'Mukoko News (news.mukoko.com)',
      },
    };
  }

  /**
   * Get open data categories
   */
  async getCategories(): Promise<OpenDataExport> {
    const result = await this.db.prepare(`
      SELECT c.id, c.name, c.slug, c.description,
             COUNT(ac.article_id) as article_count
      FROM categories c
      LEFT JOIN article_sections ac ON ac.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name
    `).all();

    return {
      format: 'json',
      data: (result.results ?? []) as Record<string, unknown>[],
      metadata: {
        exported_at: new Date().toISOString(),
        record_count: result.results?.length ?? 0,
        data_type: 'categories',
        license: 'CC0 1.0',
        attribution: 'Mukoko News (news.mukoko.com)',
      },
    };
  }

  /**
   * Get open data keywords/trending topics
   */
  async getKeywords(options: {
    limit?: number;
    trending?: boolean;
  } = {}): Promise<OpenDataExport> {
    const limit = options.limit ?? 100;
    const filter = options.trending ? 'WHERE trending_score > 0' : '';

    const result = await this.db.prepare(`
      SELECT id, term, slug, category, usage_count, trending_score,
             first_seen_at, last_seen_at
      FROM defined_terms
      ${filter}
      ORDER BY trending_score DESC, usage_count DESC
      LIMIT ?
    `).bind(limit).all();

    return {
      format: 'json',
      data: (result.results ?? []) as Record<string, unknown>[],
      metadata: {
        exported_at: new Date().toISOString(),
        record_count: result.results?.length ?? 0,
        data_type: 'keywords',
        license: 'CC BY 4.0',
        attribution: 'Mukoko News (news.mukoko.com)',
      },
    };
  }

  /**
   * Get aggregate analytics (anonymized)
   */
  async getAnalytics(days: number = 30): Promise<OpenDataExport> {
    const result = await this.db.prepare(`
      SELECT country_id as country_code,
             COUNT(*) as article_count,
             COALESCE(SUM(views), 0) as total_views,
             COALESCE(SUM(likes + saves + shares), 0) as total_engagement,
             COALESCE(AVG(quality_score), 0) as avg_quality
      FROM articles
      WHERE published_at >= datetime('now', '-' || ? || ' days')
        AND status = 'published'
      GROUP BY country_id
      ORDER BY article_count DESC
    `).bind(days).all();

    return {
      format: 'json',
      data: (result.results ?? []) as Record<string, unknown>[],
      metadata: {
        exported_at: new Date().toISOString(),
        record_count: result.results?.length ?? 0,
        data_type: 'analytics_aggregate',
        license: 'CC BY 4.0',
        attribution: 'Mukoko News (news.mukoko.com)',
      },
    };
  }

  /**
   * Export data as CSV
   */
  formatAsCSV(data: Record<string, unknown>[]): string {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const rows = data.map(row =>
      headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        // Escape CSV values
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Export data as JSONL (newline-delimited JSON)
   */
  formatAsJSONL(data: Record<string, unknown>[]): string {
    return data.map(row => JSON.stringify(row)).join('\n');
  }
}
