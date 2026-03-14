/**
 * CountryService
 *
 * Manages countries and user country preferences for the Pan-African news platform.
 * Handles country CRUD, user country preferences, and country-specific operations.
 */

export interface Country {
  id: string;           // ISO 3166-1 alpha-2 code
  name: string;
  code: string;
  flag_emoji: string;
  in_language: string;
  timezone: string;
  enabled: boolean;
  priority: number;
  keywords: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCountryPreference {
  id: number;
  user_id: string;
  country_id: string;
  is_primary: boolean;
  priority: number;
  notify_breaking: boolean;
  created_at: string;
  updated_at: string;
}

export interface CountryWithStats extends Country {
  source_count: number;
  article_count: number;
}

export class CountryService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Get all enabled countries
   */
  async getCountries(options: {
    enabledOnly?: boolean;
    withStats?: boolean;
  } = {}): Promise<Country[] | CountryWithStats[]> {
    const { enabledOnly = true, withStats = false } = options;

    if (withStats) {
      const result = await this.db.prepare(`
        SELECT
          c.*,
          COALESCE(s.source_count, 0) as source_count,
          COALESCE(a.article_count, 0) as article_count
        FROM countries c
        LEFT JOIN (
          SELECT area_served, COUNT(*) as source_count
          FROM organizations WHERE enabled = 1
          GROUP BY area_served
        ) s ON c.id = s.area_served
        LEFT JOIN (
          SELECT about_country_id, COUNT(*) as article_count
          FROM articles WHERE status = 'published'
          GROUP BY about_country_id
        ) a ON c.id = a.about_country_id
        ${enabledOnly ? 'WHERE c.enabled = 1' : ''}
        ORDER BY c.priority DESC, c.name ASC
      `).all();

      return (result.results || []) as unknown as CountryWithStats[];
    }

    const result = await this.db.prepare(`
      SELECT * FROM countries
      ${enabledOnly ? 'WHERE enabled = 1' : ''}
      ORDER BY priority DESC, name ASC
    `).all();

    return (result.results || []) as unknown as Country[];
  }

  /**
   * Get a single country by ID
   */
  async getCountryById(countryId: string): Promise<Country | null> {
    const result = await this.db.prepare(`
      SELECT * FROM countries WHERE id = ?
    `).bind(countryId).first();

    return result as unknown as Country | null;
  }

  /**
   * Get country with detailed statistics
   */
  async getCountryWithDetails(countryId: string): Promise<{
    country: Country | null;
    sources: { id: string; name: string; article_count: number }[];
    categories: { id: string; name: string; article_count: number }[];
    recentArticleCount: number;
  }> {
    const country = await this.getCountryById(countryId);

    if (!country) {
      return { country: null, sources: [], categories: [], recentArticleCount: 0 };
    }

    // Get sources for this country
    const sourcesResult = await this.db.prepare(`
      SELECT ns.id, ns.name, COUNT(a.id) as article_count
      FROM organizations ns
      LEFT JOIN articles a ON ns.id = a.publisher_id
      WHERE ns.area_served = ? AND ns.enabled = 1
      GROUP BY ns.id, ns.name
      ORDER BY article_count DESC
    `).bind(country.name).all();

    // Get category distribution for this country
    const categoriesResult = await this.db.prepare(`
      SELECT c.id, c.name, COUNT(a.id) as article_count
      FROM article_sections c
      LEFT JOIN articles a ON c.id = a.article_section_id AND a.about_country_id = ?
      WHERE c.enabled = 1
      GROUP BY c.id, c.name
      HAVING article_count > 0
      ORDER BY article_count DESC
    `).bind(countryId).all();

    // Get recent article count (last 24 hours)
    const recentResult = await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM articles
      WHERE about_country_id = ?
        AND status = 'published'
        AND date_published > datetime('now', '-24 hours')
    `).bind(countryId).first();

    return {
      country,
      sources: (sourcesResult.results || []) as { id: string; name: string; article_count: number }[],
      categories: (categoriesResult.results || []) as { id: string; name: string; article_count: number }[],
      recentArticleCount: (recentResult?.count as number) || 0,
    };
  }

  /**
   * Get user's country preferences
   */
  async getUserCountryPreferences(userId: string): Promise<{
    countries: (Country & { is_primary: boolean; priority: number; notify_breaking: boolean })[];
    primaryCountry: Country | null;
  }> {
    const result = await this.db.prepare(`
      SELECT c.*, ucp.is_primary, ucp.priority, ucp.notify_breaking
      FROM user_country_preferences ucp
      JOIN countries c ON ucp.country_id = c.id
      WHERE ucp.user_id = ?
      ORDER BY ucp.is_primary DESC, ucp.priority DESC
    `).bind(userId).all();

    const countries = (result.results || []) as unknown as (Country & {
      is_primary: boolean;
      priority: number;
      notify_breaking: boolean;
    })[];

    const primaryCountry = countries.find(c => c.is_primary) || null;

    return { countries, primaryCountry };
  }

  /**
   * Get just the country IDs for a user (for efficient filtering)
   */
  async getUserCountryIds(userId: string): Promise<string[]> {
    const result = await this.db.prepare(`
      SELECT country_id FROM user_country_preferences
      WHERE user_id = ?
      ORDER BY is_primary DESC, priority DESC
    `).bind(userId).all();

    return (result.results || []).map((r: any) => r.country_id);
  }

  /**
   * Set user's country preferences (replaces existing)
   */
  async setUserCountryPreferences(
    userId: string,
    countries: { countryId: string; isPrimary?: boolean; priority?: number; notifyBreaking?: boolean }[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate countries exist
      const countryIds = countries.map(c => c.countryId);
      const existingResult = await this.db.prepare(`
        SELECT id FROM countries WHERE id IN (${countryIds.map(() => '?').join(',')}) AND enabled = 1
      `).bind(...countryIds).all();

      const existingIds = new Set((existingResult.results || []).map((r: any) => r.id));
      const invalidIds = countryIds.filter(id => !existingIds.has(id));

      if (invalidIds.length > 0) {
        return { success: false, error: `Invalid country IDs: ${invalidIds.join(', ')}` };
      }

      // Ensure only one primary country
      const primaryCount = countries.filter(c => c.isPrimary).length;
      if (primaryCount > 1) {
        return { success: false, error: 'Only one country can be set as primary' };
      }

      // Delete existing preferences
      await this.db.prepare(`
        DELETE FROM user_country_preferences WHERE user_id = ?
      `).bind(userId).run();

      // Insert new preferences
      for (let i = 0; i < countries.length; i++) {
        const country = countries[i];
        await this.db.prepare(`
          INSERT INTO user_country_preferences (user_id, country_id, is_primary, priority, notify_breaking)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          userId,
          country.countryId,
          country.isPrimary ? 1 : 0,
          country.priority ?? (countries.length - i), // Default priority based on order
          country.notifyBreaking !== false ? 1 : 0
        ).run();
      }

      return { success: true };
    } catch (error) {
      console.error('[CountryService] Error setting user country preferences:', error);
      return { success: false, error: 'Failed to save country preferences' };
    }
  }

  /**
   * Add a single country to user's preferences
   */
  async addUserCountry(
    userId: string,
    countryId: string,
    options: { isPrimary?: boolean; notifyBreaking?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Verify country exists and is enabled
      const country = await this.getCountryById(countryId);
      if (!country || !country.enabled) {
        return { success: false, error: 'Country not found or disabled' };
      }

      // If setting as primary, unset other primary countries
      if (options.isPrimary) {
        await this.db.prepare(`
          UPDATE user_country_preferences SET is_primary = 0 WHERE user_id = ?
        `).bind(userId).run();
      }

      // Get current max priority
      const maxPriorityResult = await this.db.prepare(`
        SELECT MAX(priority) as max_priority FROM user_country_preferences WHERE user_id = ?
      `).bind(userId).first();
      const nextPriority = ((maxPriorityResult?.max_priority as number) || 0) + 1;

      // Insert or update
      await this.db.prepare(`
        INSERT INTO user_country_preferences (user_id, country_id, is_primary, priority, notify_breaking)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, country_id) DO UPDATE SET
          is_primary = excluded.is_primary,
          notify_breaking = excluded.notify_breaking,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        userId,
        countryId,
        options.isPrimary ? 1 : 0,
        nextPriority,
        options.notifyBreaking !== false ? 1 : 0
      ).run();

      return { success: true };
    } catch (error) {
      console.error('[CountryService] Error adding user country:', error);
      return { success: false, error: 'Failed to add country' };
    }
  }

  /**
   * Remove a country from user's preferences
   */
  async removeUserCountry(userId: string, countryId: string): Promise<{ success: boolean }> {
    try {
      await this.db.prepare(`
        DELETE FROM user_country_preferences WHERE user_id = ? AND country_id = ?
      `).bind(userId, countryId).run();

      return { success: true };
    } catch (error) {
      console.error('[CountryService] Error removing user country:', error);
      return { success: false };
    }
  }

  /**
   * Set user's primary country
   */
  async setUserPrimaryCountry(userId: string, countryId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Verify country is in user's preferences
      const existing = await this.db.prepare(`
        SELECT id FROM user_country_preferences WHERE user_id = ? AND country_id = ?
      `).bind(userId, countryId).first();

      if (!existing) {
        // Add the country first
        const addResult = await this.addUserCountry(userId, countryId, { isPrimary: true });
        return addResult;
      }

      // Unset all primary
      await this.db.prepare(`
        UPDATE user_country_preferences SET is_primary = 0 WHERE user_id = ?
      `).bind(userId).run();

      // Set new primary
      await this.db.prepare(`
        UPDATE user_country_preferences SET is_primary = 1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND country_id = ?
      `).bind(userId, countryId).run();

      return { success: true };
    } catch (error) {
      console.error('[CountryService] Error setting primary country:', error);
      return { success: false, error: 'Failed to set primary country' };
    }
  }

  /**
   * Get article counts by country (for stats/dashboard)
   */
  async getArticleCountsByCountry(options: {
    since?: string;
  } = {}): Promise<{ country_id: string; country_name: string; flag_emoji: string; count: number }[]> {
    const { since } = options;

    let query = `
      SELECT c.id as country_id, c.name as country_name, c.flag_emoji, COUNT(a.id) as count
      FROM countries c
      LEFT JOIN articles a ON c.id = a.about_country_id AND a.status = 'published'
    `;

    if (since) {
      query += ` AND a.date_published >= ?`;
    }

    query += `
      WHERE c.enabled = 1
      GROUP BY c.id, c.name, c.flag_emoji
      ORDER BY count DESC
    `;

    const result = since
      ? await this.db.prepare(query).bind(since).all()
      : await this.db.prepare(query).all();

    return (result.results || []) as { country_id: string; country_name: string; flag_emoji: string; count: number }[];
  }

  /**
   * Get sources for a specific country
   */
  async getSourcesByCountry(countryId: string): Promise<{
    id: string;
    name: string;
    rss_feed_url: string;
    logo_url: string | null;
    enabled: boolean;
  }[]> {
    const result = await this.db.prepare(`
      SELECT id, name, rss_feed_url, logo_url, enabled
      FROM organizations
      WHERE area_served = ?
      ORDER BY name ASC
    `).bind(countryId).all();

    return (result.results || []) as {
      id: string;
      name: string;
      rss_feed_url: string;
      logo_url: string | null;
      enabled: boolean;
    }[];
  }
}

export default CountryService;
