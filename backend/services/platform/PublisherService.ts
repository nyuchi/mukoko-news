/**
 * PublisherService - Publisher verification, push API, analytics
 *
 * Enables news publishers across Africa to:
 * - Register and verify their identity
 * - Push articles directly to Mukoko (like Apple News)
 * - View analytics on their content performance
 * - Manage their source profile
 *
 * Verification levels:
 * - unverified:  Submitted application, awaiting review
 * - basic:       Domain ownership verified (DNS TXT record)
 * - verified:    Editorial review passed, organization confirmed
 * - premium:     Partnership agreement, priority distribution
 */

export interface Publisher {
  id: string;
  name: string;
  domain: string;
  description: string;
  logo_url: string | null;
  country_code: string;
  contact_email: string;
  contact_name: string;
  verification_level: VerificationLevel;
  verification_token: string | null;
  verified_at: string | null;
  api_key_id: string | null;
  categories: string[];
  languages: string[];
  article_count: number;
  total_views: number;
  avg_quality_score: number;
  is_active: boolean;
  is_suspended: boolean;
  suspension_reason: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export type VerificationLevel = 'unverified' | 'basic' | 'verified' | 'premium';

export interface PublisherArticleSubmission {
  title: string;
  content: string;
  description?: string;
  url: string;
  image_url?: string;
  author: string;
  published_at: string;
  category?: string;
  keywords?: string[];
  language?: string;
}

export interface PublisherAnalytics {
  period: string;
  articles_published: number;
  total_views: number;
  total_engagement: number;
  avg_quality_score: number;
  top_articles: Array<{
    id: string;
    title: string;
    views: number;
    engagement: number;
  }>;
  geographic_distribution: Array<{
    country_code: string;
    views: number;
  }>;
  category_breakdown: Array<{
    category: string;
    articles: number;
    views: number;
  }>;
}

export class PublisherService {
  constructor(private db: D1Database) {}

  /**
   * Register a new publisher
   */
  async register(params: {
    name: string;
    domain: string;
    description: string;
    country_code: string;
    contact_email: string;
    contact_name: string;
    logo_url?: string;
    categories?: string[];
    languages?: string[];
  }): Promise<Publisher> {
    // Check for duplicate domain
    const existing = await this.db.prepare(
      'SELECT id FROM publishers WHERE domain = ?'
    ).bind(params.domain).first();

    if (existing) {
      throw new PublisherError('Publisher with this domain already exists', 'DUPLICATE_DOMAIN');
    }

    const id = crypto.randomUUID();
    const verificationToken = await this.generateVerificationToken();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO publishers
        (id, name, domain, description, logo_url, country_code,
         contact_email, contact_name, verification_level, verification_token,
         categories, languages, article_count, total_views, avg_quality_score,
         is_active, is_suspended, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unverified', ?, ?, ?, 0, 0, 0, 1, 0, ?, ?, '{}')
    `).bind(
      id, params.name, params.domain, params.description,
      params.logo_url ?? null, params.country_code,
      params.contact_email, params.contact_name,
      verificationToken,
      JSON.stringify(params.categories ?? []),
      JSON.stringify(params.languages ?? ['en']),
      now, now
    ).run();

    return (await this.getPublisher(id))!;
  }

  /**
   * Get a publisher by ID
   */
  async getPublisher(id: string): Promise<Publisher | null> {
    const result = await this.db.prepare(
      'SELECT * FROM publishers WHERE id = ?'
    ).bind(id).first();

    if (!result) return null;
    return this.rowToPublisher(result);
  }

  /**
   * Get a publisher by domain
   */
  async getPublisherByDomain(domain: string): Promise<Publisher | null> {
    const result = await this.db.prepare(
      'SELECT * FROM publishers WHERE domain = ?'
    ).bind(domain).first();

    if (!result) return null;
    return this.rowToPublisher(result);
  }

  /**
   * Verify domain ownership via DNS TXT record
   * Publisher must add TXT record: mukoko-verify=<verification_token>
   */
  async verifyDomain(publisherId: string): Promise<{
    verified: boolean;
    message: string;
  }> {
    const publisher = await this.getPublisher(publisherId);
    if (!publisher) {
      return { verified: false, message: 'Publisher not found' };
    }

    if (!publisher.verification_token) {
      return { verified: false, message: 'No verification token set' };
    }

    try {
      // Check DNS TXT records via Cloudflare DNS API
      const response = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${publisher.domain}&type=TXT`,
        { headers: { 'Accept': 'application/dns-json' } }
      );

      const dnsResult = await response.json() as {
        Answer?: Array<{ data: string }>;
      };

      const expectedRecord = `mukoko-verify=${publisher.verification_token}`;
      const found = dnsResult.Answer?.some(
        record => record.data.replace(/"/g, '').trim() === expectedRecord
      );

      if (found) {
        await this.db.prepare(`
          UPDATE publishers
          SET verification_level = 'basic', verified_at = ?, updated_at = ?
          WHERE id = ?
        `).bind(new Date().toISOString(), new Date().toISOString(), publisherId).run();

        return { verified: true, message: 'Domain verified successfully' };
      }

      return {
        verified: false,
        message: `DNS TXT record not found. Add: ${expectedRecord}`,
      };
    } catch (error) {
      return { verified: false, message: `DNS lookup failed: ${error}` };
    }
  }

  /**
   * Admin: Manually verify a publisher
   */
  async adminVerify(
    publisherId: string,
    level: VerificationLevel
  ): Promise<Publisher | null> {
    await this.db.prepare(`
      UPDATE publishers
      SET verification_level = ?, verified_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(level, new Date().toISOString(), new Date().toISOString(), publisherId).run();

    return this.getPublisher(publisherId);
  }

  /**
   * Submit an article from a verified publisher
   */
  async submitArticle(
    publisherId: string,
    submission: PublisherArticleSubmission
  ): Promise<{
    articleId: string;
    status: 'accepted' | 'pending_review' | 'rejected';
    message: string;
  }> {
    const publisher = await this.getPublisher(publisherId);

    if (!publisher) {
      throw new PublisherError('Publisher not found', 'NOT_FOUND');
    }

    if (!publisher.is_active || publisher.is_suspended) {
      throw new PublisherError('Publisher account is suspended', 'SUSPENDED');
    }

    if (publisher.verification_level === 'unverified') {
      throw new PublisherError('Publisher must be verified to submit articles', 'UNVERIFIED');
    }

    const articleId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Auto-approve verified and premium publishers
    const autoApprove = publisher.verification_level === 'verified' ||
                        publisher.verification_level === 'premium';

    await this.db.prepare(`
      INSERT INTO articles
        (id, title, description, content, url, image_url, author,
         published_at, source_id, country_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      articleId,
      submission.title,
      submission.description ?? '',
      submission.content,
      submission.url,
      submission.image_url ?? null,
      submission.author,
      submission.published_at,
      publisherId,
      publisher.country_code,
      autoApprove ? 'published' : 'pending',
      now
    ).run();

    // Update publisher stats
    await this.db.prepare(`
      UPDATE publishers
      SET article_count = article_count + 1, updated_at = ?
      WHERE id = ?
    `).bind(now, publisherId).run();

    return {
      articleId,
      status: autoApprove ? 'accepted' : 'pending_review',
      message: autoApprove
        ? 'Article published successfully'
        : 'Article submitted for review',
    };
  }

  /**
   * Get publisher analytics
   */
  async getAnalytics(
    publisherId: string,
    days: number = 30
  ): Promise<PublisherAnalytics> {
    const publisher = await this.getPublisher(publisherId);
    if (!publisher) {
      throw new PublisherError('Publisher not found', 'NOT_FOUND');
    }

    // Get articles from this publisher
    const articles = await this.db.prepare(`
      SELECT id, title, views, likes + saves + shares as engagement
      FROM articles
      WHERE source_id = ?
        AND published_at >= datetime('now', '-' || ? || ' days')
      ORDER BY views DESC
      LIMIT 10
    `).bind(publisherId, days).all();

    const stats = await this.db.prepare(`
      SELECT
        COUNT(*) as articles_published,
        COALESCE(SUM(views), 0) as total_views,
        COALESCE(SUM(likes + saves + shares), 0) as total_engagement,
        COALESCE(AVG(quality_score), 0) as avg_quality_score
      FROM articles
      WHERE source_id = ?
        AND published_at >= datetime('now', '-' || ? || ' days')
    `).bind(publisherId, days).first();

    return {
      period: `${days} days`,
      articles_published: (stats?.articles_published as number) ?? 0,
      total_views: (stats?.total_views as number) ?? 0,
      total_engagement: (stats?.total_engagement as number) ?? 0,
      avg_quality_score: Math.round((stats?.avg_quality_score as number) ?? 0),
      top_articles: (articles.results ?? []).map((a: Record<string, unknown>) => ({
        id: a.id as string,
        title: a.title as string,
        views: (a.views as number) ?? 0,
        engagement: (a.engagement as number) ?? 0,
      })),
      geographic_distribution: [],
      category_breakdown: [],
    };
  }

  /**
   * List all publishers
   */
  async listPublishers(options: {
    country?: string;
    verification_level?: VerificationLevel;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ publishers: Publisher[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.country) {
      conditions.push('country_code = ?');
      params.push(options.country);
    }

    if (options.verification_level) {
      conditions.push('verification_level = ?');
      params.push(options.verification_level);
    }

    if (options.search) {
      conditions.push('(name LIKE ? OR domain LIKE ?)');
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const countResult = await this.db.prepare(
      `SELECT COUNT(*) as total FROM publishers ${whereClause}`
    ).bind(...params).first<{ total: number }>();

    const result = await this.db.prepare(`
      SELECT * FROM publishers ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return {
      publishers: (result.results ?? []).map(row => this.rowToPublisher(row as Record<string, unknown>)),
      total: countResult?.total ?? 0,
    };
  }

  /**
   * Suspend a publisher
   */
  async suspend(publisherId: string, reason: string): Promise<void> {
    await this.db.prepare(`
      UPDATE publishers
      SET is_suspended = 1, suspension_reason = ?, updated_at = ?
      WHERE id = ?
    `).bind(reason, new Date().toISOString(), publisherId).run();
  }

  /**
   * Unsuspend a publisher
   */
  async unsuspend(publisherId: string): Promise<void> {
    await this.db.prepare(`
      UPDATE publishers
      SET is_suspended = 0, suspension_reason = NULL, updated_at = ?
      WHERE id = ?
    `).bind(new Date().toISOString(), publisherId).run();
  }

  // --- Private ---

  private async generateVerificationToken(): Promise<string> {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private rowToPublisher(row: Record<string, unknown>): Publisher {
    return {
      id: row.id as string,
      name: row.name as string,
      domain: row.domain as string,
      description: row.description as string,
      logo_url: row.logo_url as string | null,
      country_code: row.country_code as string,
      contact_email: row.contact_email as string,
      contact_name: row.contact_name as string,
      verification_level: row.verification_level as VerificationLevel,
      verification_token: row.verification_token as string | null,
      verified_at: row.verified_at as string | null,
      api_key_id: row.api_key_id as string | null,
      categories: JSON.parse((row.categories as string) || '[]'),
      languages: JSON.parse((row.languages as string) || '[]'),
      article_count: (row.article_count as number) ?? 0,
      total_views: (row.total_views as number) ?? 0,
      avg_quality_score: (row.avg_quality_score as number) ?? 0,
      is_active: Boolean(row.is_active),
      is_suspended: Boolean(row.is_suspended),
      suspension_reason: row.suspension_reason as string | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      metadata: JSON.parse((row.metadata as string) || '{}'),
    };
  }
}

export class PublisherError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'PublisherError';
  }
}
