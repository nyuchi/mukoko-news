/**
 * PersonalizedFeedService
 *
 * Generates personalized article feeds based on user preferences,
 * reading history, follows, and engagement patterns.
 */

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
  title: string;
  slug: string;
  description: string;
  content_snippet: string;
  author: string;
  source: string;
  source_id: string;
  published_at: string;
  image_url: string;
  original_url: string;
  category_id: string;
  country_id: string;  // Pan-African support
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

// Shape of each article returned by the Python Worker's /feed/rank endpoint.
// Fields mirror the Python feed_ranker.py output (snake_case).
interface PythonRankedArticle {
  id: number;
  title: string;
  slug: string;
  description: string;
  content_snippet: string;
  author: string;
  source: string;
  source_id: string;
  published_at: string;
  image_url: string;
  original_url: string;
  category_id: string;
  country_id: string;
  view_count: number;
  like_count: number;
  bookmark_count: number;
  score: number;
  score_breakdown: {
    followed_source: number;
    followed_author: number;
    followed_category: number;
    category_interest: number;
    primary_country: number;
    recency: number;
    engagement: number;
    source_quality: number;
    diversity: number;
  };
}

// Minimal interface for the Python Worker ranking call (subset of ProcessingClient)
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
  ): Promise<{ articles: Array<Record<string, unknown> & { score: number; score_breakdown: Record<string, number> }> }>;
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
        // Explicitly map PythonRankedArticle (snake_case) → ScoredArticle (camelCase).
        // Single assertion to PythonRankedArticle gives us typed field access;
        // the explicit mapping below replaces the previous `as unknown as ScoredArticle[]` cast.
        scoredArticles = rankResult.articles.map((a): ScoredArticle => {
          const p = a as unknown as PythonRankedArticle;
          return {
          id: p.id,
          title: p.title,
          slug: p.slug,
          description: p.description,
          content_snippet: p.content_snippet,
          author: p.author,
          source: p.source,
          source_id: p.source_id,
          published_at: p.published_at,
          image_url: p.image_url,
          original_url: p.original_url,
          category_id: p.category_id,
          country_id: p.country_id,
          view_count: p.view_count,
          like_count: p.like_count,
          bookmark_count: p.bookmark_count,
          score: p.score,
          scoreBreakdown: {
            followedSource: p.score_breakdown.followed_source,
            followedAuthor: p.score_breakdown.followed_author,
            followedCategory: p.score_breakdown.followed_category,
            categoryInterest: p.score_breakdown.category_interest,
            primaryCountry: p.score_breakdown.primary_country,
            recency: p.score_breakdown.recency,
            engagement: p.score_breakdown.engagement,
            diversity: p.score_breakdown.diversity,
          },
        };
        });
      } catch (err) {
        console.error('[PersonalizedFeedService] Python ranking failed, using TS fallback:', err);
        scoredArticles = this.scoreArticles(candidates, preferences, recencyWeight, diversityFactor);
      }
    } else {
      scoredArticles = this.scoreArticles(candidates, preferences, recencyWeight, diversityFactor);
    }

    // Apply pagination
    const paginatedArticles = scoredArticles.slice(offset, offset + limit);

    // Get total count (filtered by countries if applicable)
    let countQuery = 'SELECT COUNT(*) as total FROM articles WHERE status = \'published\'';
    const countParams: string[] = [];
    if (effectiveCountries.length > 0) {
      const placeholders = effectiveCountries.map(() => '?').join(',');
      countQuery += ` AND country_id IN (${placeholders})`;
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
      SELECT a.category_id, COUNT(*) as read_count,
             SUM(h.reading_time) as total_time,
             AVG(h.scroll_depth) as avg_depth
      FROM user_reading_history h
      JOIN articles a ON h.article_id = a.id
      WHERE h.user_id = ?
        AND h.started_at > datetime('now', '-30 days')
      GROUP BY a.category_id
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
      categoryInterests.set(r.category_id, readScore + timeScore + depthScore);
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
      SELECT id, title, slug, description, content_snippet, author, source, source_id,
             published_at, image_url, original_url, category_id, country_id, view_count,
             like_count, bookmark_count
      FROM articles
      WHERE status = 'published'
        AND published_at > datetime('now', '-14 days')
    `;
    const params: (string | number)[] = [];

    // Pan-African: filter by countries if provided
    if (countries && countries.length > 0) {
      const placeholders = countries.map(() => '?').join(',');
      query += ` AND country_id IN (${placeholders})`;
      params.push(...countries);
    }

    query += ` ORDER BY published_at DESC LIMIT ?`;
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
      };

      // Followed source boost
      if (preferences.followedSources.includes(article.source_id)) {
        breakdown.followedSource = WEIGHTS.FOLLOWED_SOURCE;
        score += breakdown.followedSource;
      }

      // Followed author boost
      if (article.author && preferences.followedAuthors.includes(article.author)) {
        breakdown.followedAuthor = WEIGHTS.FOLLOWED_AUTHOR;
        score += breakdown.followedAuthor;
      }

      // Followed category boost
      if (preferences.followedCategories.includes(article.category_id)) {
        breakdown.followedCategory = WEIGHTS.FOLLOWED_CATEGORY;
        score += breakdown.followedCategory;
      }

      // Pan-African: Primary country boost
      if (preferences.primaryCountry && article.country_id === preferences.primaryCountry) {
        breakdown.primaryCountry = WEIGHTS.PRIMARY_COUNTRY;
        score += breakdown.primaryCountry;
      }

      // Category interest from reading history
      const categoryInterest = preferences.categoryInterests.get(article.category_id) || 0;
      breakdown.categoryInterest = categoryInterest * WEIGHTS.CATEGORY_INTEREST;
      score += breakdown.categoryInterest;

      // Recency score (exponential decay)
      const articleTime = new Date(article.published_at).getTime();
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
        const count = categoryCount.get(article.category_id) || 0;
        if (count > 0) {
          // Apply increasing penalty for repeated categories
          const penalty = count * WEIGHTS.DIVERSITY_PENALTY * diversityFactor;
          article.score += penalty;
          if (article.scoreBreakdown) {
            article.scoreBreakdown.diversity = penalty;
          }
        }
        categoryCount.set(article.category_id, count + 1);
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
      SELECT id, title, slug, description, content_snippet, author, source, source_id,
             published_at, image_url, original_url, category_id, country_id, view_count,
             like_count, bookmark_count
      FROM articles
      WHERE status = 'published'
        AND published_at > datetime('now', '-7 days')
    `;
    const params: (string | number)[] = [];

    // Pan-African: filter by countries if provided
    if (countries && countries.length > 0) {
      const placeholders = countries.map(() => '?').join(',');
      query += ` AND country_id IN (${placeholders})`;
      params.push(...countries);
    }

    query += ` ORDER BY (view_count + like_count * 3 + bookmark_count * 2) DESC, published_at DESC
      LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await this.db.prepare(query).bind(...params).all();

    // Build count query with same country filter
    let countQuery = `SELECT COUNT(*) as total FROM articles
      WHERE status = 'published' AND published_at > datetime('now', '-7 days')`;
    const countParams: string[] = [];

    if (countries && countries.length > 0) {
      const placeholders = countries.map(() => '?').join(',');
      countQuery += ` AND country_id IN (${placeholders})`;
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
        SELECT name FROM rss_sources WHERE id IN (${preferences.followedSources.map(() => '?').join(',')})
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
        SELECT name FROM categories WHERE id IN (${topInterestIds.map(() => '?').join(',')})
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
