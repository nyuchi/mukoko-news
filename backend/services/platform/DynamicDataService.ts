/**
 * DynamicDataService - Database-driven categories, keywords, sources, tags
 *
 * Nothing is hardcoded. All categories, keywords/tags, and sources live in
 * the database and grow organically as new ones are identified through:
 * - AI keyword extraction from articles
 * - RSS feed discovery
 * - Publisher submissions
 * - Trending topic detection
 * - Admin manual additions
 *
 * This replaces any static/hardcoded data with living database records.
 */

export interface DynamicCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  emoji: string;
  color: string;
  parent_id: string | null;
  article_count: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DynamicKeyword {
  id: string;
  term: string;
  slug: string;
  normalized: string; // lowercase, trimmed
  category_id: string | null;
  usage_count: number;
  trending_score: number;
  aliases: string[]; // Alternative forms
  language: string;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
  auto_discovered: boolean; // true = found by AI, false = manually added
}

export interface DynamicSource {
  id: string;
  name: string;
  url: string;
  feed_url: string;
  country_code: string;
  description: string;
  logo_url: string | null;
  language: string;
  categories: string[]; // Category slugs this source covers
  is_active: boolean;
  is_verified: boolean;
  health_status: 'healthy' | 'degraded' | 'failing' | 'critical' | 'unknown';
  article_count: number;
  last_fetched_at: string | null;
  added_by: 'system' | 'admin' | 'publisher' | 'discovery';
  created_at: string;
  updated_at: string;
}

export interface DynamicTag {
  id: string;
  name: string;
  slug: string;
  type: 'topic' | 'entity' | 'location' | 'event' | 'person' | 'organization';
  usage_count: number;
  trending_score: number;
  related_tags: string[]; // Related tag IDs
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
}

export interface DynamicCountry {
  id: string;
  code: string;      // ISO 3166-1 alpha-2
  name: string;
  flag_emoji: string;
  region: string;     // East Africa, West Africa, Southern Africa, etc.
  languages: string[];
  currency_code: string;
  timezone: string;
  is_active: boolean;
  source_count: number;
  article_count: number;
  sort_order: number;
  created_at: string;
}

export class DynamicDataService {
  constructor(private db: D1Database) {}

  // --- Categories ---

  /**
   * Get all active categories from the database
   */
  async getCategories(options: {
    includeInactive?: boolean;
    parentId?: string | null;
    withArticleCount?: boolean;
  } = {}): Promise<DynamicCategory[]> {
    let query = `SELECT c.*, COALESCE(ac.count, 0) as article_count FROM categories c`;

    if (options.withArticleCount !== false) {
      query += ` LEFT JOIN (
        SELECT category_id, COUNT(*) as count
        FROM article_sections
        GROUP BY category_id
      ) ac ON c.id = ac.category_id`;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!options.includeInactive) {
      conditions.push('c.is_active = 1');
    }

    if (options.parentId !== undefined) {
      if (options.parentId === null) {
        conditions.push('c.parent_id IS NULL');
      } else {
        conditions.push('c.parent_id = ?');
        params.push(options.parentId);
      }
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY c.sort_order ASC, c.name ASC';

    const result = await this.db.prepare(query).bind(...params).all();
    return (result.results ?? []) as unknown as DynamicCategory[];
  }

  /**
   * Create a new category
   */
  async createCategory(category: {
    name: string;
    slug: string;
    description?: string;
    emoji?: string;
    color?: string;
    parent_id?: string;
    sort_order?: number;
  }): Promise<DynamicCategory> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO categories (id, name, slug, description, emoji, color, parent_id, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(
      id, category.name, category.slug,
      category.description ?? '', category.emoji ?? '📰',
      category.color ?? '#4B0082', category.parent_id ?? null,
      category.sort_order ?? 999, now, now
    ).run();

    return (await this.db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first()) as unknown as DynamicCategory;
  }

  /**
   * Update a category
   */
  async updateCategory(id: string, updates: Partial<{
    name: string;
    slug: string;
    description: string;
    emoji: string;
    color: string;
    parent_id: string | null;
    sort_order: number;
    is_active: boolean;
  }>): Promise<DynamicCategory | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }

    setClauses.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    await this.db.prepare(`
      UPDATE categories SET ${setClauses.join(', ')} WHERE id = ?
    `).bind(...params).run();

    return (await this.db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first()) as unknown as DynamicCategory;
  }

  /**
   * Delete a category (soft delete)
   */
  async deleteCategory(id: string): Promise<void> {
    await this.db.prepare(`
      UPDATE categories SET is_active = 0, updated_at = ? WHERE id = ?
    `).bind(new Date().toISOString(), id).run();
  }

  // --- Keywords/Tags ---

  /**
   * Get keywords with optional filtering
   */
  async getKeywords(options: {
    limit?: number;
    offset?: number;
    category?: string;
    trending?: boolean;
    search?: string;
    minUsageCount?: number;
    sortBy?: 'usage_count' | 'trending_score' | 'last_seen_at' | 'term';
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ keywords: DynamicKeyword[]; total: number }> {
    const conditions: string[] = ['is_active = 1'];
    const params: unknown[] = [];

    if (options.category) {
      conditions.push('category_id = ?');
      params.push(options.category);
    }

    if (options.trending) {
      conditions.push('trending_score > 0');
    }

    if (options.search) {
      conditions.push('(term LIKE ? OR normalized LIKE ?)');
      params.push(`%${options.search}%`, `%${options.search.toLowerCase()}%`);
    }

    if (options.minUsageCount) {
      conditions.push('usage_count >= ?');
      params.push(options.minUsageCount);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortBy = options.sortBy ?? 'trending_score';
    const sortOrder = options.sortOrder ?? 'desc';

    // Count total
    const countResult = await this.db.prepare(
      `SELECT COUNT(*) as total FROM keywords ${whereClause}`
    ).bind(...params).first<{ total: number }>();

    // Get keywords
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const result = await this.db.prepare(`
      SELECT * FROM keywords ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    const keywords = (result.results ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      aliases: JSON.parse((row.aliases as string) || '[]'),
    })) as unknown as DynamicKeyword[];

    return { keywords, total: countResult?.total ?? 0 };
  }

  /**
   * Discover and add a new keyword (called by AI processing)
   */
  async discoverKeyword(keyword: {
    term: string;
    category_id?: string;
    language?: string;
    source_article_id?: string;
  }): Promise<DynamicKeyword> {
    const normalized = keyword.term.toLowerCase().trim();
    const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Check if keyword already exists
    const existing = await this.db.prepare(
      'SELECT * FROM keywords WHERE normalized = ? OR slug = ?'
    ).bind(normalized, slug).first();

    if (existing) {
      // Update usage count and last_seen
      await this.db.prepare(`
        UPDATE keywords
        SET usage_count = usage_count + 1,
            last_seen_at = ?,
            trending_score = trending_score + 1
        WHERE id = ?
      `).bind(new Date().toISOString(), existing.id).run();

      return existing as unknown as DynamicKeyword;
    }

    // Create new keyword
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO keywords
        (id, term, slug, normalized, category_id, usage_count, trending_score,
         aliases, language, first_seen_at, last_seen_at, is_active, auto_discovered)
      VALUES (?, ?, ?, ?, ?, 1, 1, '[]', ?, ?, ?, 1, 1)
    `).bind(
      id, keyword.term, slug, normalized,
      keyword.category_id ?? null,
      keyword.language ?? 'en',
      now, now
    ).run();

    return (await this.db.prepare('SELECT * FROM keywords WHERE id = ?').bind(id).first()) as unknown as DynamicKeyword;
  }

  /**
   * Batch discover keywords (from AI extraction)
   */
  async discoverKeywordBatch(keywords: Array<{
    term: string;
    category_id?: string;
    language?: string;
  }>): Promise<{ discovered: number; updated: number }> {
    let discovered = 0;
    let updated = 0;

    for (const keyword of keywords) {
      const normalized = keyword.term.toLowerCase().trim();
      if (normalized.length < 2 || normalized.length > 100) continue;

      const existing = await this.db.prepare(
        'SELECT id FROM keywords WHERE normalized = ?'
      ).bind(normalized).first();

      if (existing) {
        await this.db.prepare(`
          UPDATE keywords
          SET usage_count = usage_count + 1, last_seen_at = ?, trending_score = trending_score + 0.5
          WHERE id = ?
        `).bind(new Date().toISOString(), existing.id).run();
        updated++;
      } else {
        await this.discoverKeyword(keyword);
        discovered++;
      }
    }

    return { discovered, updated };
  }

  /**
   * Merge duplicate keywords
   */
  async mergeKeywords(primaryId: string, duplicateIds: string[]): Promise<void> {
    // Move usage counts to primary
    for (const dupId of duplicateIds) {
      const dup = await this.db.prepare('SELECT * FROM keywords WHERE id = ?').bind(dupId).first();
      if (!dup) continue;

      // Add aliases
      const primary = await this.db.prepare('SELECT * FROM keywords WHERE id = ?').bind(primaryId).first();
      if (!primary) continue;

      const aliases = JSON.parse((primary.aliases as string) || '[]');
      aliases.push(dup.term);

      await this.db.prepare(`
        UPDATE keywords
        SET usage_count = usage_count + ?,
            aliases = ?,
            updated_at = ?
        WHERE id = ?
      `).bind(
        dup.usage_count,
        JSON.stringify(aliases),
        new Date().toISOString(),
        primaryId
      ).run();

      // Deactivate duplicate
      await this.db.prepare('UPDATE keywords SET is_active = 0 WHERE id = ?').bind(dupId).run();
    }
  }

  /**
   * Decay trending scores (run periodically)
   */
  async decayTrendingScores(decayFactor: number = 0.9): Promise<number> {
    const result = await this.db.prepare(`
      UPDATE keywords
      SET trending_score = ROUND(trending_score * ?, 2)
      WHERE trending_score > 0.1
    `).bind(decayFactor).run();

    // Deactivate keywords with zero trending and very low usage
    await this.db.prepare(`
      UPDATE keywords
      SET trending_score = 0
      WHERE trending_score < 0.1
    `).run();

    return result.meta?.changes ?? 0;
  }

  // --- Sources ---

  /**
   * Get all sources with dynamic data
   */
  async getSources(options: {
    country?: string;
    category?: string;
    status?: string;
    search?: string;
    verified?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: 'name' | 'article_count' | 'created_at' | 'last_fetched_at';
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ sources: DynamicSource[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.country) {
      conditions.push('country_code = ?');
      params.push(options.country);
    }

    if (options.status) {
      conditions.push('health_status = ?');
      params.push(options.status);
    }

    if (options.search) {
      conditions.push('(name LIKE ? OR url LIKE ? OR description LIKE ?)');
      params.push(`%${options.search}%`, `%${options.search}%`, `%${options.search}%`);
    }

    if (options.verified !== undefined) {
      conditions.push('is_verified = ?');
      params.push(options.verified ? 1 : 0);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortBy = options.sortBy ?? 'name';
    const sortOrder = options.sortOrder ?? 'asc';
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const countResult = await this.db.prepare(
      `SELECT COUNT(*) as total FROM dynamic_sources ${whereClause}`
    ).bind(...params).first<{ total: number }>();

    const result = await this.db.prepare(`
      SELECT * FROM dynamic_sources ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    const sources = (result.results ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      categories: JSON.parse((row.categories as string) || '[]'),
    })) as unknown as DynamicSource[];

    return { sources, total: countResult?.total ?? 0 };
  }

  /**
   * Add a new source
   */
  async addSource(source: {
    name: string;
    url: string;
    feed_url: string;
    country_code: string;
    description?: string;
    logo_url?: string;
    language?: string;
    categories?: string[];
    added_by?: DynamicSource['added_by'];
  }): Promise<DynamicSource> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO dynamic_sources
        (id, name, url, feed_url, country_code, description, logo_url, language,
         categories, is_active, is_verified, health_status, article_count,
         added_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'unknown', 0, ?, ?, ?)
    `).bind(
      id, source.name, source.url, source.feed_url, source.country_code,
      source.description ?? '', source.logo_url ?? null,
      source.language ?? 'en',
      JSON.stringify(source.categories ?? []),
      source.added_by ?? 'admin',
      now, now
    ).run();

    return (await this.db.prepare('SELECT * FROM dynamic_sources WHERE id = ?').bind(id).first()) as unknown as DynamicSource;
  }

  /**
   * Remove a source (soft delete)
   */
  async removeSource(id: string): Promise<void> {
    await this.db.prepare(`
      UPDATE dynamic_sources SET is_active = 0, updated_at = ? WHERE id = ?
    `).bind(new Date().toISOString(), id).run();
  }

  /**
   * Verify a source
   */
  async verifySource(id: string): Promise<void> {
    await this.db.prepare(`
      UPDATE dynamic_sources SET is_verified = 1, updated_at = ? WHERE id = ?
    `).bind(new Date().toISOString(), id).run();
  }

  // --- Countries ---

  /**
   * Get all countries from database
   */
  async getCountries(options: {
    activeOnly?: boolean;
    withCounts?: boolean;
  } = {}): Promise<DynamicCountry[]> {
    let query = 'SELECT * FROM dynamic_countries';

    if (options.activeOnly !== false) {
      query += ' WHERE is_active = 1';
    }

    query += ' ORDER BY sort_order ASC, name ASC';

    const result = await this.db.prepare(query).all();
    return (result.results ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      languages: JSON.parse((row.languages as string) || '[]'),
    })) as unknown as DynamicCountry[];
  }

  /**
   * Add a new country
   */
  async addCountry(country: {
    code: string;
    name: string;
    flag_emoji: string;
    region: string;
    languages?: string[];
    currency_code?: string;
    timezone?: string;
    sort_order?: number;
  }): Promise<DynamicCountry> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO dynamic_countries
        (id, code, name, flag_emoji, region, languages, currency_code, timezone,
         is_active, source_count, article_count, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)
    `).bind(
      id, country.code, country.name, country.flag_emoji, country.region,
      JSON.stringify(country.languages ?? []),
      country.currency_code ?? '',
      country.timezone ?? 'UTC',
      country.sort_order ?? 999,
      now
    ).run();

    return (await this.db.prepare('SELECT * FROM dynamic_countries WHERE id = ?').bind(id).first()) as unknown as DynamicCountry;
  }

  // --- Tags ---

  /**
   * Get tags with filtering
   */
  async getTags(options: {
    type?: DynamicTag['type'];
    trending?: boolean;
    limit?: number;
    search?: string;
  } = {}): Promise<DynamicTag[]> {
    const conditions: string[] = ['is_active = 1'];
    const params: unknown[] = [];

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.trending) {
      conditions.push('trending_score > 0');
    }

    if (options.search) {
      conditions.push('name LIKE ?');
      params.push(`%${options.search}%`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = options.limit ?? 50;

    const result = await this.db.prepare(`
      SELECT * FROM tags ${whereClause}
      ORDER BY trending_score DESC, usage_count DESC
      LIMIT ?
    `).bind(...params, limit).all();

    return (result.results ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      related_tags: JSON.parse((row.related_tags as string) || '[]'),
    })) as unknown as DynamicTag[];
  }

  /**
   * Discover a tag (from article processing)
   */
  async discoverTag(tag: {
    name: string;
    type: DynamicTag['type'];
  }): Promise<DynamicTag> {
    const slug = tag.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const existing = await this.db.prepare(
      'SELECT * FROM tags WHERE slug = ?'
    ).bind(slug).first();

    if (existing) {
      await this.db.prepare(`
        UPDATE tags SET usage_count = usage_count + 1, last_seen_at = ?,
                       trending_score = trending_score + 1
        WHERE id = ?
      `).bind(new Date().toISOString(), existing.id).run();
      return existing as unknown as DynamicTag;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO tags (id, name, slug, type, usage_count, trending_score,
                       related_tags, first_seen_at, last_seen_at, is_active)
      VALUES (?, ?, ?, ?, 1, 1, '[]', ?, ?, 1)
    `).bind(id, tag.name, slug, tag.type, now, now).run();

    return (await this.db.prepare('SELECT * FROM tags WHERE id = ?').bind(id).first()) as unknown as DynamicTag;
  }
}
