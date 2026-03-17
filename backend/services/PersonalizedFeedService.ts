/**
 * PersonalizedFeedService
 *
 * Generates personalized article feeds based on user preferences,
 * reading history, follows, and engagement patterns.
 */

import { PythonRankedArticle } from './ProcessingClient.js';

interface UserPreferences {
  followedSources: string[];
  followedAuthors: string[];
  followedCategories: string[];
  preferredCountries: string[];  // Pan-African support: user's country preferences
  primaryCountry: string | null; // User's primary/home country
  categoryInterests: Map<string, number>; // category -> interest score
  recentlyRead: Set<number>; // article IDs read recently
}

interface ScoredArticle {
  id: number;
  headline: string;
  slug: string;
  description: string;
  content_snippet: string;
  author_name: string;
  source: string;
  publisher_id: string;
  date_published: string;
  image: string;
  main_entity_of_page: string;
  article_section_id: string;
  about_country_id: string;  // Pan-African support
  view_count: number;
  like_count: number;
  bookmark_count: number;
  score: number;
  scoreBreakdown?: {
    followedSource: number;
    followedAuthor: number;
    followedCategory: number;
    categoryInterest: number;
    primaryCountry: number;  // Pan-African support
    recency: number;
    engagement: number;
    diversity: number;
    sourceQuality: number;  // Python Worker signal; 0 when TS scorer is used
  };
}

interface PersonalizedFeedOptions {
  limit?: number;
  offset?: number;
  excludeRead?: boolean;
  diversityFactor?: number; // 0-1, higher = more diverse categories
  recencyWeight?: number; // How much to weight recent articles
  countries?: string[] | null; // Pan-African support: override user's country preferences
}

// Minimal interface for the Python Worker ranking call (subset of ProcessingClient).
// Uses PythonRankedArticle (defined in ProcessingClient.ts) so the return type is
// structurally verified — no as-unknown-as cast needed in the mapping below.
interface RankFeedClient {
  rankFeed(
    articles: Array<Record<string, unknown>>,
    preferences: {
      followedSources?: string[];
      followedAuthors?: string[];
      followedCategories?: string[];
      preferredCountries?: string[];
      primaryCountry?: string | null;
      categoryInterests?: Record<string, number>;
    }
  ): Promise<{ articles: PythonRankedArticle[] }>;
}

// Scoring weights
const WEIGHTS = {
  FOLLOWED_SOURCE: 50,      // Strong boost for followed sources
  FOLLOWED_AUTHOR: 40,      // Strong boost for followed authors
  FOLLOWED_CATEGORY: 30,    // Medium boost for followed categories
  PRIMARY_COUNTRY: 35,      // Pan-African: boost for user's primary country
  CATEGORY_INTEREST: 20,    // Based on reading history
  RECENCY: 25,              // Recent articles get boost
  ENGAGEMENT: 15,           // Popular articles get boost
  DIVERSITY_PENALTY: -10,   // Penalty for too many from same category
};

// Time decay constants
const RECENCY_HALF_LIFE_HOURS = 24; // Articles lose half their recency score per day

export class PersonalizedFeedService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Get personalized feed for a user.
   * When processingClient is provided, ranking is delegated to the Python Worker
   * (numpy-vectorised scoring with source-quality signal). Falls back to the
   * built-in TS scorer if the Python call fails.
   */
  async getPersonalizedFeed(
    userId: string | null,
    options: PersonalizedFeedOptions = {},
    processingClient?: RankFeedClient
  ): Promise<{
    articles: ScoredArticle[];
    total: number;
    isPersonalized: boolean;
    countries?: string[];  // Pan-African: which countries were used for filtering
  }> {
    const {
      limit = 30,
      offset = 0,
      excludeRead = true,
      diversityFactor = 0.3,
      recencyWeight = 1.0,
      countries = null,  // Pan-African: optional country filter override
    } = options;

    // If no user, return trending feed (optionally filtered by countries)
    if (!userId) {
      return this.getTrendingFeed(limit, offset, countries);
    }

    // Get user preferences
    const preferences = await this.getUserPreferences(userId);

    // Determine which countries to use: override > user preferences > all
    const effectiveCountries = countries || preferences.preferredCountries;

    // Check if user has any preferences/history
    const hasPreferences =
      preferences.followedSources.length > 0 ||
      preferences.followedAuthors.length > 0 ||
      preferences.followedCategories.length > 0 ||
      preferences.categoryInterests.size > 0 ||
      preferences.preferredCountries.length > 0;  // Pan-African: include country preferences

    if (!hasPreferences) {
      // New user with no preferences, return trending (filtered by countries if provided)
      return this.getTrendingFeed(limit, offset, effectiveCountries.length > 0 ? effectiveCountries : null);
    }

    // Get candidate articles (more than we need for scoring)
    const candidateLimit = Math.min(limit * 5, 200);
    const candidates = await this.getCandidateArticles(
      candidateLimit,
      excludeRead ? preferences.recentlyRead : new Set(),
      effectiveCountries.length > 0 ? effectiveCountries : null  // Pan-African: pass countries
    );

    // Score and rank articles — try Python Worker first, fall back to TS scorer
    let scoredArticles: ScoredArticle[];
    if (processingClient) {
      try {
        const rankResult = await processingClient.rankFeed(
          candidates as unknown as Array<Record<string, unknown>>,
          {
            followedSources: preferences.followedSources,
            followedAuthors: preferences.followedAuthors,
            followedCategories: preferences.followedCategories,
            preferredCountries: preferences.preferredCountries,
            primaryCountry: preferences.primaryCountry,
            categoryInterests: Object.fromEntries(preferences.categoryInterests),
          }
        );
        // Map PythonRankedArticle (snake_case) → ScoredArticle (camelCase).
        // RankFeedClient now returns PythonRankedArticle[] so no cast is needed here.
        // sourceQuality is populated from the Python Worker; the TS scorer sets it to 0.
        // This ensures scoreBreakdown values always sum to score regardless of which
        // path produced the ranking.
        scoredArticles = rankResult.articles.map((a): ScoredArticle => ({
          id: a.id,
          title: a.title,
          slug: a.slug,
          description: a.description,
          content_snippet: a.content_snippet,
          author: a.author,
          source: a.source,
          source_id: a.source_id,
          published_at: a.published_at,
          image_url: a.image_url,
          original_url: a.original_url,
          category_id: a.category_id,
          country_id: a.country_id,
          view_count: a.view_count,
          like_count: a.like_count,
          bookmark_count: a.bookmark_count,
          score: a.score,
          scoreBreakdown: {
            followedSource: a.score_breakdown.followed_source,
            followedAuthor: a.score_breakdown.followed_author,
            followedCategory: a.score_breakdown.followed_category,
            categoryInterest: a.score_breakdown.category_interest,
            primaryCountry: a.score_breakdown.primary_country,
            recency: a.score_breakdown.recency,
            engagement: a.score_breakdown.engagement,
            diversity: a.score_breakdown.diversity,
            sourceQuality: a.score_breakdown.source_quality,
          },
        }));
      } catch (err) {
        console.error('[PersonalizedFeedService] Python ranking failed, using TS fallback:', err);
        scoredArticles = this.scoreArticles(candidates, preferences, recencyWeight, diversityFactor);
      }
    } else {
      scoredArticles = this.scoreArticles(candidates, preferences, recencyWeight, diversityFactor);
    }

    // Apply pagination
    const paginatedArticles = scoredArticles.slice(offset, offset + limit);

    // Get total count from D1 (filtered by countries if applicable).
    // NOTE: total reflects published articles in D1, not the number of Python-ranked
    // candidates. When Python ranking is active it scores a candidateLimit-sized sample
    // (up to 200), so total may exceed the actual rankable set. This is a known limitation
    // of the in-memory scoring pattern shared by both the TS and Python paths.
    let countQuery = 'SELECT COUNT(*) as total FROM articles WHERE status = \'published\'';
    const countParams: string[] = [];
    if (effectiveCountries.length > 0) {
      const placeholders = effectiveCountries.map(() => '?').join(',');
      countQuery += ` AND about_country_id IN (${placeholders})`;
      countParams.push(...effectiveCountries);
    }
    const totalResult = countParams.length > 0
      ? await this.db.prepare(countQuery).bind(...countParams).first()
      : await this.db.prepare(countQuery).first();

    return {
      articles: paginatedArticles,
      total: totalResult?.total as number || 0,
      isPersonalized: true,
      countries: effectiveCountries.length > 0 ? effectiveCountries : undefined,
    };
  }

  /**
   * Get user's preferences, follows, and reading history
   */
  private async getUserPreferences(userId: string): Promise<UserPreferences> {
    // Get followed sources
    const sourcesResult = await this.db.prepare(`
      SELECT follow_id FROM user_follows
      WHERE user_id = ? AND follow_type = 'source'
    `).bind(userId).all();
    const followedSources = (sourcesResult.results || []).map((r: any) => r.follow_id);

    // Get followed authors
    const authorsResult = await this.db.prepare(`
      SELECT follow_id FROM user_follows
      WHERE user_id = ? AND follow_type = 'author'
    `).bind(userId).all();
    const followedAuthors = (authorsResult.results || []).map((r: any) => r.follow_id);

    // Get followed categories
    const categoriesResult = await this.db.prepare(`
      SELECT follow_id FROM user_follows
      WHERE user_id = ? AND follow_type = 'category'
    `).bind(userId).all();
    const followedCategories = (categoriesResult.results || []).map((r: any) => r.follow_id);

    // Pan-African: Get user's country preferences
    const countriesResult = await this.db.prepare(`
      SELECT country_id, is_primary FROM user_country_preferences
      WHERE user_id = ?
      ORDER BY is_primary DESC, priority DESC
    `).bind(userId).all();
    const preferredCountries = (countriesResult.results || []).map((r: any) => r.country_id);
    const primaryCountryRow = (countriesResult.results || []).find((r: any) => r.is_primary);
    const primaryCountry = primaryCountryRow ? (primaryCountryRow as any).country_id : null;

    // Get category interests from reading history (last 30 days)
    const historyResult = await this.db.prepare(`
      SELECT a.article_section_id, COUNT(*) as read_count,
             SUM(h.reading_time) as total_time,
             AVG(h.scroll_depth) as avg_depth
      FROM user_reading_history h
      JOIN articles a ON h.article_id = a.id
      WHERE h.user_id = ?
        AND h.started_at > datetime('now', '-30 days')
      GROUP BY a.article_section_id
      ORDER BY read_count DESC
    `).bind(userId).all();

    const categoryInterests = new Map<string, number>();
    const historyRows = historyResult.results || [];
    const maxReadCount = Math.max(...historyRows.map((r: any) => r.read_count), 1);

    for (const row of historyRows) {
      const r = row as any;
      // Score based on read count, time spent, and scroll depth
      const readScore = (r.read_count / maxReadCount) * 0.5;
      const timeScore = Math.min(r.total_time / 3600, 1) * 0.3; // Cap at 1 hour
      const depthScore = (r.avg_depth / 100) * 0.2;
      categoryInterests.set(r.article_section_id, readScore + timeScore + depthScore);
    }

    // Get recently read article IDs (last 7 days)
    const recentResult = await this.db.prepare(`
      SELECT article_id FROM user_reading_history
      WHERE user_id = ? AND started_at > datetime('now', '-7 days')
    `).bind(userId).all();
    const recentlyRead = new Set((recentResult.results || []).map((r: any) => r.article_id));

    return {
      followedSources,
      followedAuthors,
      followedCategories,
      preferredCountries,
      primaryCountry,
      categoryInterests,
      recentlyRead,
    };
  }

  /**
   * Get candidate articles for personalization
   */
  private async getCandidateArticles(
    limit: number,
    excludeIds: Set<number>,
    countries: string[] | null = null  // Pan-African: filter by countries
  ): Promise<ScoredArticle[]> {
    // Build query with optional country filter
    let query = `
      SELECT id, headline, slug, description, content_snippet, author_name, source, publisher_id,
             date_published, image, main_entity_of_page, article_section_id, about_country_id, view_count,
             like_count, bookmark_count
      FROM articles
      WHERE status = 'published'
        AND date_published > datetime('now', '-14 days')
    `;
    const params: (string | number)[] = [];

    // Pan-African: filter by countries if provided
    if (countries && countries.length > 0) {
      const placeholders = countries.map(() => '?').join(',');
      query += ` AND about_country_id IN (${placeholders})`;
      params.push(...countries);
    }

    query += ` ORDER BY date_published DESC LIMIT ?`;
    params.push(limit);

    const result = await this.db.prepare(query).bind(...params).all();

    const articles = (result.results || []) as unknown as ScoredArticle[];

    // Filter out already read articles if needed
    if (excludeIds.size > 0) {
      return articles.filter(a => !excludeIds.has(a.id));
    }

    return articles;
  }

  /**
   * Score articles based on user preferences
   */
  private scoreArticles(
    articles: ScoredArticle[],
    preferences: UserPreferences,
    recencyWeight: number,
    diversityFactor: number
  ): ScoredArticle[] {
    const now = Date.now();
    const categoryCount = new Map<string, number>();

    // First pass: calculate base scores
    const scoredArticles = articles.map(article => {
      let score = 0;
      const breakdown = {
        followedSource: 0,
        followedAuthor: 0,
        followedCategory: 0,
        categoryInterest: 0,
        primaryCountry: 0,  // Pan-African
        recency: 0,
        engagement: 0,
        diversity: 0,
        sourceQuality: 0,   // Python Worker only; TS scorer does not compute this
      };

      // Followed source boost
      if (preferences.followedSources.includes(article.publisher_id)) {
        breakdown.followedSource = WEIGHTS.FOLLOWED_SOURCE;
        score += breakdown.followedSource;
      }

      // Followed author boost
      if (article.author_name && preferences.followedAuthors.includes(article.author_name)) {
        breakdown.followedAuthor = WEIGHTS.FOLLOWED_AUTHOR;
        score += breakdown.followedAuthor;
      }

      // Followed category boost
      if (preferences.followedCategories.includes(article.article_section_id)) {
        breakdown.followedCategory = WEIGHTS.FOLLOWED_CATEGORY;
        score += breakdown.followedCategory;
      }

      // Pan-African: Primary country boost
      if (preferences.primaryCountry && article.about_country_id === preferences.primaryCountry) {
        breakdown.primaryCountry = WEIGHTS.PRIMARY_COUNTRY;
        score += breakdown.primaryCountry;
      }

      // Category interest from reading history
      const categoryInterest = preferences.categoryInterests.get(article.article_section_id) || 0;
      breakdown.categoryInterest = categoryInterest * WEIGHTS.CATEGORY_INTEREST;
      score += breakdown.categoryInterest;

      // Recency score (exponential decay)
      const articleTime = new Date(article.date_published).getTime();
      const hoursOld = (now - articleTime) / (1000 * 60 * 60);
      const recencyScore = Math.pow(0.5, hoursOld / RECENCY_HALF_LIFE_HOURS);
      breakdown.recency = recencyScore * WEIGHTS.RECENCY * recencyWeight;
      score += breakdown.recency;

      // Engagement score (logarithmic to prevent viral articles from dominating)
      const engagementRaw = article.view_count + article.like_count * 3 + article.bookmark_count * 2;
      const engagementScore = Math.log10(Math.max(engagementRaw, 1) + 1) / 3; // Normalize to ~0-1
      breakdown.engagement = engagementScore * WEIGHTS.ENGAGEMENT;
      score += breakdown.engagement;

      return {
        ...article,
        score,
        scoreBreakdown: breakdown,
      };
    });

    // Sort by score
    scoredArticles.sort((a, b) => b.score - a.score);

    // Second pass: apply diversity penalty (in order)
    if (diversityFactor > 0) {
      for (const article of scoredArticles) {
        const count = categoryCount.get(article.article_section_id) || 0;
        if (count > 0) {
          // Apply increasing penalty for repeated categories
          const penalty = count * WEIGHTS.DIVERSITY_PENALTY * diversityFactor;
          article.score += penalty;
          if (article.scoreBreakdown) {
            article.scoreBreakdown.diversity = penalty;
          }
        }
        categoryCount.set(article.article_section_id, count + 1);
      }

      // Re-sort after diversity adjustment
      scoredArticles.sort((a, b) => b.score - a.score);
    }

    return scoredArticles;
  }

  /**
   * Get trending feed for anonymous users or users without preferences
   */
  private async getTrendingFeed(
    limit: number,
    offset: number,
    countries: string[] | null = null  // Pan-African: optional country filter
  ): Promise<{
    articles: ScoredArticle[];
    total: number;
    isPersonalized: boolean;
    countries?: string[];
  }> {
    // Build query with optional country filter
    let query = `
      SELECT id, headline, slug, description, content_snippet, author_name, source, publisher_id,
             date_published, image, main_entity_of_page, article_section_id, about_country_id, view_count,
             like_count, bookmark_count
      FROM articles
      WHERE status = 'published'
        AND date_published > datetime('now', '-7 days')
    `;
    const params: (string | number)[] = [];

    // Pan-African: filter by countries if provided
    if (countries && countries.length > 0) {
      const placeholders = countries.map(() => '?').join(',');
      query += ` AND about_country_id IN (${placeholders})`;
      params.push(...countries);
    }

    query += ` ORDER BY (view_count + like_count * 3 + bookmark_count * 2) DESC, date_published DESC
      LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await this.db.prepare(query).bind(...params).all();

    // Build count query with same country filter
    let countQuery = `SELECT COUNT(*) as total FROM articles
      WHERE status = 'published' AND date_published > datetime('now', '-7 days')`;
    const countParams: string[] = [];

    if (countries && countries.length > 0) {
      const placeholders = countries.map(() => '?').join(',');
      countQuery += ` AND about_country_id IN (${placeholders})`;
      countParams.push(...countries);
    }

    const totalResult = countParams.length > 0
      ? await this.db.prepare(countQuery).bind(...countParams).first()
      : await this.db.prepare(countQuery).first();

    return {
      articles: (result.results || []).map(a => ({ ...a, score: 0 } as ScoredArticle)),
      total: totalResult?.total as number || 0,
      isPersonalized: false,
      countries: countries && countries.length > 0 ? countries : undefined,
    };
  }

  /**
   * Get "For You" summary - explains why articles were recommended
   */
  async getFeedExplanation(userId: string): Promise<{
    sources: string[];
    authors: string[];
    categories: string[];
    topInterests: string[];
  }> {
    const preferences = await this.getUserPreferences(userId);

    // Get names for followed sources
    const sourceNames: string[] = [];
    if (preferences.followedSources.length > 0) {
      const sourcesResult = await this.db.prepare(`
        SELECT name FROM organizations WHERE id IN (${preferences.followedSources.map(() => '?').join(',')})
      `).bind(...preferences.followedSources).all();
      sourceNames.push(...(sourcesResult.results || []).map((r: any) => r.name));
    }

    // Get category names for top interests
    const topInterestIds = Array.from(preferences.categoryInterests.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    const categoryNames: string[] = [];
    if (topInterestIds.length > 0) {
      const categoriesResult = await this.db.prepare(`
        SELECT name FROM article_sections WHERE id IN (${topInterestIds.map(() => '?').join(',')})
      `).bind(...topInterestIds).all();
      categoryNames.push(...(categoriesResult.results || []).map((r: any) => r.name));
    }

    return {
      sources: sourceNames,
      authors: preferences.followedAuthors,
      categories: preferences.followedCategories,
      topInterests: categoryNames,
    };
  }
}
