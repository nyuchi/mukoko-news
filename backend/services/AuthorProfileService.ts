/**
 * Author Profile Service
 * Handles author profiles, social features, cross-outlet deduplication, and journalism recognition
 */

import { D1Service } from "../../database/D1Service.js";

export interface AuthorProfile {
  id: number;
  name: string;
  slug: string;
  normalizedName: string;
  title?: string;
  profileDescription?: string;
  specialization?: string;
  yearsExperience: number;
  education?: string;
  awards?: string[];
  contactEmail?: string;
  websiteUrl?: string;
  twitterHandle?: string;
  linkedinUrl?: string;
  instagramHandle?: string;
  facebookUrl?: string;
  youtubeUrl?: string;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  totalEngagement: number;
  profileViews: number;
  isFeatured: boolean;
  featuredUntil?: string;
  lastActive?: string;
  status: 'active' | 'inactive' | 'retired';
  outlets: AuthorOutlet[];
  expertise: AuthorExpertise[];
  credibility: AuthorCredibility;
  recentArticles: AuthorArticle[];
  stats: AuthorStats;
}

export interface AuthorOutlet {
  id: string;
  name: string;
  role: string;
  isPrimary: boolean;
  articlesCount: number;
  startDate?: string;
  endDate?: string;
}

export interface AuthorExpertise {
  articleSectionId: string;
  categoryName: string;
  expertiseLevel: string;
  articlesWritten: number;
  avgQualityScore: number;
  readerRating: number;
  lastArticleDate?: string;
}

export interface AuthorCredibility {
  factCheckScore: number;
  sourceReliability: number;
  peerRecognition: number;
  readerTrust: number;
  correctionRate: number;
  overallCredibility: number;
  lastCalculated: string;
}

export interface AuthorArticle {
  id: number;
  headline: string;
  datePublished: string;
  category: string;
  outlet: string;
  qualityScore: number;
  engagementCount: number;
}

export interface AuthorStats {
  totalArticles: number;
  articlesThisMonth: number;
  avgQualityScore: number;
  totalViews: number;
  totalLikes: number;
  totalShares: number;
  topCategories: string[];
  collaborators: string[];
}

export interface FollowResult {
  success: boolean;
  isFollowing: boolean;
  newFollowerCount: number;
  message: string;
}

// Database row types for D1 queries
interface AuthorRow {
  id: number;
  name: string;
  slug: string;
  normalized_name: string;
  title?: string;
  profile_description?: string;
  specialization?: string;
  years_experience?: number;
  education?: string;
  awards?: string;
  contact_email?: string;
  website_url?: string;
  twitter_handle?: string;
  linkedin_url?: string;
  instagram_handle?: string;
  facebook_url?: string;
  youtube_url?: string;
  is_verified?: number;
  follower_count?: number;
  following_count?: number;
  total_engagement?: number;
  profile_views?: number;
  is_featured?: number;
  featured_until?: string;
  last_active?: string;
  status?: string;
  articles_count?: number;
}

interface OutletRow {
  id: string;
  name: string;
  role: string;
  is_primary: number;
  articles_count: number;
  start_date?: string;
  end_date?: string;
}

interface ExpertiseRow {
  article_section_id: string;
  category_name: string;
  expertise_level: string;
  articles_written: number;
  avg_quality_score: number;
  reader_rating: number;
  last_article_date?: string;
}

interface CredibilityRow {
  fact_check_score: number;
  source_reliability: number;
  peer_recognition: number;
  reader_trust: number;
  correction_rate: number;
  overall_credibility: number;
  last_calculated: string;
}

interface ArticleRow {
  id: number;
  headline: string;
  date_published: string;
  category: string;
  outlet: string;
  quality_score: number;
  engagement_count: number;
}

interface StatsRow {
  total_articles: number;
  articles_this_month: number;
  avg_quality_score: number;
  total_views: number;
  total_likes: number;
  total_shares: number;
  top_categories?: string;
}

export class AuthorProfileService {
  private d1Service: D1Service;

  constructor(d1Service: D1Service) {
    this.d1Service = d1Service;
  }

  /**
   * Get comprehensive author profile by slug
   */
  async getAuthorProfile(slug: string): Promise<AuthorProfile | null> {
    try {
      // Get basic author information
      const author = await this.d1Service.db.prepare(`
        SELECT * FROM persons WHERE slug = ?
      `).bind(slug).first<AuthorRow>();

      if (!author) {
        return null;
      }

      // Get author outlets
      const outlets = await this.getAuthorOutlets(author.id);

      // Get author expertise by category
      const expertise = await this.getAuthorExpertise(author.id);

      // Get credibility scores
      const credibility = await this.getAuthorCredibility(author.id);

      // Get recent articles
      const recentArticles = await this.getAuthorRecentArticles(author.id, 10);

      // Get comprehensive stats
      const stats = await this.getAuthorStats(author.id);

      return {
        id: author.id,
        name: author.name,
        slug: author.slug,
        normalizedName: author.normalized_name,
        title: author.title,
        profileDescription: author.profile_description,
        specialization: author.specialization,
        yearsExperience: author.years_experience || 0,
        education: author.education,
        awards: author.awards ? JSON.parse(author.awards) : [],
        contactEmail: author.contact_email,
        websiteUrl: author.website_url,
        twitterHandle: author.twitter_handle,
        linkedinUrl: author.linkedin_url,
        instagramHandle: author.instagram_handle,
        facebookUrl: author.facebook_url,
        youtubeUrl: author.youtube_url,
        isVerified: Boolean(author.is_verified),
        followerCount: author.follower_count || 0,
        followingCount: author.following_count || 0,
        totalEngagement: author.total_engagement || 0,
        profileViews: author.profile_views || 0,
        isFeatured: Boolean(author.is_featured),
        featuredUntil: author.featured_until,
        lastActive: author.last_active,
        status: (author.status as 'active' | 'inactive' | 'retired') || 'active',
        outlets,
        expertise,
        credibility,
        recentArticles,
        stats
      };
    } catch (error) {
      console.error('Error fetching author profile:', error);
      return null;
    }
  }

  /**
   * Find or create author with cross-outlet deduplication
   */
  async findOrCreateAuthor(authorData: {
    name: string;
    title?: string;
    outlet: string;
    confidence: number;
  }): Promise<AuthorProfile> {
    const normalizedName = this.normalizeAuthorName(authorData.name);
    
    // First, try exact name match across all outlets
    let author = await this.d1Service.db.prepare(`
      SELECT * FROM persons WHERE normalized_name = ?
    `).bind(normalizedName).first<AuthorRow>();

    if (author) {
      // Author exists, ensure outlet relationship
      await this.ensureAuthorOutletRelationship(author.id, authorData.outlet, authorData.title);
      return this.getAuthorProfile(author.slug) as Promise<AuthorProfile>;
    }

    // Try fuzzy matching for similar names (handle typos, variations)
    const similarAuthors = await this.findSimilarAuthors(authorData.name);
    
    if (similarAuthors.length > 0) {
      // Found potential duplicate, use the first match
      author = similarAuthors[0];
      await this.ensureAuthorOutletRelationship(author.id, authorData.outlet, authorData.title);
      
      // Merge any new information
      await this.mergeAuthorData(author.id, authorData);
      
      return this.getAuthorProfile(author.slug);
    }

    // Create new author
    const slug = await this.generateUniqueSlug(normalizedName);
    
    const result = await this.d1Service.db.prepare(`
      INSERT INTO persons (
        name, normalized_name, slug, title, works_for, verification_status,
        years_experience, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      RETURNING *
    `).bind(
      authorData.name,
      normalizedName,
      slug,
      authorData.title,
      authorData.outlet,
      'unverified',
      this.estimateExperience(authorData.title),
      'active'
    ).first<AuthorRow>();

    // Create outlet relationship
    await this.ensureAuthorOutletRelationship(result!.id, authorData.outlet, authorData.title, true);

    // Initialize credibility scores
    await this.initializeAuthorCredibility(result!.id);

    return this.getAuthorProfile(slug) as Promise<AuthorProfile>;
  }

  /**
   * Follow/unfollow an author
   */
  async toggleAuthorFollow(userId: string | number, authorId: number): Promise<FollowResult> {
    try {
      // Check if already following
      const existingFollow = await this.d1Service.db.prepare(`
        SELECT id FROM user_author_follows 
        WHERE user_id = ? AND author_id = ?
      `).bind(userId, authorId).first();

      if (existingFollow) {
        // Unfollow
        await this.d1Service.db.prepare(`
          DELETE FROM user_author_follows 
          WHERE user_id = ? AND author_id = ?
        `).bind(userId, authorId).run();

        const newCount = await this.getAuthorFollowerCount(authorId);
        
        return {
          success: true,
          isFollowing: false,
          newFollowerCount: newCount,
          message: 'Successfully unfollowed author'
        };
      } else {
        // Follow
        await this.d1Service.db.prepare(`
          INSERT INTO user_author_follows (user_id, author_id, followed_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `).bind(userId, authorId).run();

        const newCount = await this.getAuthorFollowerCount(authorId);

        return {
          success: true,
          isFollowing: true,
          newFollowerCount: newCount,
          message: 'Successfully followed author'
        };
      }
    } catch (error) {
      console.error('Error toggling author follow:', error);
      return {
        success: false,
        isFollowing: false,
        newFollowerCount: 0,
        message: 'Failed to update follow status'
      };
    }
  }

  /**
   * Follow/unfollow a news source
   */
  async toggleSourceFollow(userId: string | number, sourceId: string): Promise<FollowResult> {
    try {
      const existingFollow = await this.d1Service.db.prepare(`
        SELECT id FROM user_source_follows 
        WHERE user_id = ? AND source_id = ?
      `).bind(userId, sourceId).first();

      if (existingFollow) {
        // Unfollow
        await this.d1Service.db.prepare(`
          DELETE FROM user_source_follows 
          WHERE user_id = ? AND source_id = ?
        `).bind(userId, sourceId).run();

        const newCount = await this.getSourceFollowerCount(sourceId);
        
        return {
          success: true,
          isFollowing: false,
          newFollowerCount: newCount,
          message: 'Successfully unfollowed news source'
        };
      } else {
        // Follow
        await this.d1Service.db.prepare(`
          INSERT INTO user_source_follows (user_id, source_id, followed_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `).bind(userId, sourceId).run();

        const newCount = await this.getSourceFollowerCount(sourceId);

        return {
          success: true,
          isFollowing: true,
          newFollowerCount: newCount,
          message: 'Successfully followed news source'
        };
      }
    } catch (error) {
      console.error('Error toggling source follow:', error);
      return {
        success: false,
        isFollowing: false,
        newFollowerCount: 0,
        message: 'Failed to update follow status'
      };
    }
  }

  /**
   * Track author profile interaction
   */
  async trackProfileInteraction(
    authorId: number, 
    interactionType: string, 
    userId?: number, 
    metadata?: any
  ): Promise<void> {
    try {
      await this.d1Service.db.prepare(`
        INSERT INTO author_profile_interactions (
          author_id, user_id, interaction_type, ip_address, user_agent, 
          referrer, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        authorId,
        userId || null,
        interactionType,
        metadata?.ipAddress || null,
        metadata?.userAgent || null,
        metadata?.referrer || null
      ).run();
    } catch (error) {
      console.error('Error tracking profile interaction:', error);
    }
  }

  /**
   * Get featured authors
   */
  async getFeaturedAuthors(limit: number = 10): Promise<AuthorProfile[]> {
    const authors = await this.d1Service.db.prepare(`
      SELECT slug FROM persons
      WHERE is_featured = true 
      AND (featured_until IS NULL OR featured_until > CURRENT_TIMESTAMP)
      AND status = 'active'
      ORDER BY follower_count DESC, total_engagement DESC
      LIMIT ?
    `).bind(limit).all();

    const profiles: AuthorProfile[] = [];
    for (const author of authors.results as Array<{ slug: string }>) {
      const profile = await this.getAuthorProfile(author.slug);
      if (profile) {
        profiles.push(profile);
      }
    }

    return profiles;
  }

  /**
   * Get trending authors based on recent engagement
   */
  async getTrendingAuthors(days: number = 7, limit: number = 10): Promise<AuthorProfile[]> {
    const authors = await this.d1Service.db.prepare(`
      SELECT 
        a.slug,
        COUNT(DISTINCT aa.article_id) as recent_articles,
        SUM(COALESCE(ar.view_count, 0)) as recent_views,
        COUNT(DISTINCT api.id) as recent_interactions
      FROM persons a
      LEFT JOIN article_authors aa ON a.id = aa.author_id
      LEFT JOIN articles ar ON aa.article_id = ar.id 
        AND datetime(ar.date_published) > datetime('now', '-${days} days')
      LEFT JOIN author_profile_interactions api ON a.id = api.author_id
        AND datetime(api.created_at) > datetime('now', '-${days} days')
      WHERE a.status = 'active'
      GROUP BY a.id, a.slug
      HAVING recent_articles > 0 OR recent_interactions > 0
      ORDER BY (recent_articles * 2 + recent_views * 0.1 + recent_interactions) DESC
      LIMIT ?
    `).bind(limit).all();

    const profiles: AuthorProfile[] = [];
    for (const author of authors.results as Array<{ slug: string }>) {
      const profile = await this.getAuthorProfile(author.slug);
      if (profile) {
        profiles.push(profile);
      }
    }

    return profiles;
  }

  /**
   * Search authors by name, outlet, or specialization
   */
  async searchAuthors(query: string, limit: number = 20): Promise<AuthorProfile[]> {
    const searchTerm = `%${query.toLowerCase()}%`;
    
    const authors = await this.d1Service.db.prepare(`
      SELECT DISTINCT a.slug,
        CASE 
          WHEN LOWER(a.name) LIKE ? THEN 1
          WHEN LOWER(a.specialization) LIKE ? THEN 2
          WHEN LOWER(a.title) LIKE ? THEN 3
          ELSE 4
        END as relevance_score
      FROM persons a
      LEFT JOIN author_outlets ao ON a.id = ao.author_id
      LEFT JOIN organizations ns ON ao.outlet_id = ns.id
      WHERE (
        LOWER(a.name) LIKE ? OR
        LOWER(a.specialization) LIKE ? OR
        LOWER(a.title) LIKE ? OR
        LOWER(ns.name) LIKE ?
      ) AND a.status = 'active'
      ORDER BY relevance_score, a.follower_count DESC
      LIMIT ?
    `).bind(
      searchTerm, searchTerm, searchTerm,
      searchTerm, searchTerm, searchTerm, searchTerm,
      limit
    ).all();

    const profiles: AuthorProfile[] = [];
    for (const author of authors.results as Array<{ slug: string }>) {
      const profile = await this.getAuthorProfile(author.slug);
      if (profile) {
        profiles.push(profile);
      }
    }

    return profiles;
  }

  /**
   * Get all authors with optional filtering
   */
  async getAuthors(options: { limit?: number; outlet?: string } = {}): Promise<AuthorProfile[]> {
    const { limit = 20, outlet } = options;

    let query = `
      SELECT DISTINCT a.slug
      FROM persons a
      LEFT JOIN author_outlets ao ON a.id = ao.author_id
      LEFT JOIN organizations ns ON ao.outlet_id = ns.id
      WHERE a.status = 'active'
    `;

    const params: (string | number)[] = [];

    if (outlet) {
      query += ` AND LOWER(ns.name) LIKE ?`;
      params.push(`%${outlet.toLowerCase()}%`);
    }

    query += ` ORDER BY a.articles_count DESC LIMIT ?`;
    params.push(limit);

    const authors = await this.d1Service.db.prepare(query).bind(...params).all();

    const profiles: AuthorProfile[] = [];
    for (const author of authors.results as Array<{ slug: string }>) {
      const profile = await this.getAuthorProfile(author.slug);
      if (profile) {
        profiles.push(profile);
      }
    }

    return profiles;
  }

  // Private helper methods

  private async getAuthorOutlets(authorId: number): Promise<AuthorOutlet[]> {
    const outlets = await this.d1Service.db.prepare(`
      SELECT 
        ao.outlet_id as id,
        ns.name,
        ao.role,
        ao.is_primary,
        ao.articles_count,
        ao.start_date,
        ao.end_date
      FROM author_outlets ao
      JOIN organizations ns ON ao.outlet_id = ns.id
      WHERE ao.author_id = ?
      ORDER BY ao.is_primary DESC, ao.articles_count DESC
    `).bind(authorId).all();

    return outlets.results.map((outlet: any) => ({
      id: outlet.id,
      name: outlet.name,
      role: outlet.role,
      isPrimary: Boolean(outlet.is_primary),
      articlesCount: outlet.articles_count || 0,
      startDate: outlet.start_date,
      endDate: outlet.end_date
    }));
  }

  private async getAuthorExpertise(authorId: number): Promise<AuthorExpertise[]> {
    const expertise = await this.d1Service.db.prepare(`
      SELECT 
        ace.article_section_id,
        c.name as category_name,
        ace.expertise_level,
        ace.articles_written,
        ace.avg_quality_score,
        ace.reader_rating,
        ace.last_article_date
      FROM author_category_expertise ace
      JOIN article_sections c ON ace.article_section_id = c.id
      WHERE ace.author_id = ?
      ORDER BY ace.articles_written DESC, ace.avg_quality_score DESC
    `).bind(authorId).all();

    return expertise.results.map((exp: any) => ({
      articleSectionId: exp.article_section_id,
      categoryName: exp.category_name,
      expertiseLevel: exp.expertise_level,
      articlesWritten: exp.articles_written || 0,
      avgQualityScore: exp.avg_quality_score || 0,
      readerRating: exp.reader_rating || 0,
      lastArticleDate: exp.last_article_date
    }));
  }

  private async getAuthorCredibility(authorId: number): Promise<AuthorCredibility> {
    const credibility = await this.d1Service.db.prepare(`
      SELECT * FROM author_credibility WHERE author_id = ?
    `).bind(authorId).first<CredibilityRow>();

    if (!credibility) {
      // Initialize default credibility scores
      await this.initializeAuthorCredibility(authorId);
      return {
        factCheckScore: 0.5,
        sourceReliability: 0.5,
        peerRecognition: 0.5,
        readerTrust: 0.5,
        correctionRate: 0.0,
        overallCredibility: 0.5,
        lastCalculated: new Date().toISOString()
      };
    }

    return {
      factCheckScore: credibility.fact_check_score,
      sourceReliability: credibility.source_reliability,
      peerRecognition: credibility.peer_recognition,
      readerTrust: credibility.reader_trust,
      correctionRate: credibility.correction_rate,
      overallCredibility: credibility.overall_credibility,
      lastCalculated: credibility.last_calculated
    };
  }

  private async getAuthorRecentArticles(authorId: number, limit: number): Promise<AuthorArticle[]> {
    const articles = await this.d1Service.db.prepare(`
      SELECT 
        a.id,
        a.headline,
        a.date_published,
        a.category,
        a.source as outlet,
        a.quality_score,
        (COALESCE(a.view_count, 0) + 
         COALESCE((SELECT COUNT(*) FROM user_likes WHERE article_id = a.id), 0) +
         COALESCE(a.social_shares, 0)) as engagement_count
      FROM articles a
      JOIN article_authors aa ON a.id = aa.article_id
      WHERE aa.author_id = ?
      ORDER BY a.date_published DESC
      LIMIT ?
    `).bind(authorId, limit).all();

    return articles.results.map((article: any) => ({
      id: article.id,
      headline: article.headline,
      datePublished: article.date_published,
      category: article.article_section_id,
      outlet: article.outlet,
      qualityScore: article.quality_score || 0,
      engagementCount: article.engagement_count || 0
    }));
  }

  private async getAuthorStats(authorId: number): Promise<AuthorStats> {
    // Get total articles
    const totalArticlesResult = await this.d1Service.db.prepare(`
      SELECT COUNT(*) as count FROM article_authors WHERE author_id = ?
    `).bind(authorId).first<{ count: number }>();

    // Get articles this month
    const thisMonthResult = await this.d1Service.db.prepare(`
      SELECT COUNT(*) as count
      FROM article_authors aa
      JOIN articles a ON aa.article_id = a.id
      WHERE aa.author_id = ?
      AND datetime(a.date_published) > datetime('now', 'start of month')
    `).bind(authorId).first<{ count: number }>();

    // Get average quality score
    const qualityResult = await this.d1Service.db.prepare(`
      SELECT AVG(a.quality_score) as avg_score
      FROM article_authors aa
      JOIN articles a ON aa.article_id = a.id
      WHERE aa.author_id = ? AND a.quality_score IS NOT NULL
    `).bind(authorId).first<{ avg_score: number }>();

    // Get engagement totals
    const engagementResult = await this.d1Service.db.prepare(`
      SELECT
        SUM(COALESCE(a.view_count, 0)) as total_views,
        COUNT(DISTINCT l.id) as total_likes,
        SUM(COALESCE(a.social_shares, 0)) as total_shares
      FROM article_authors aa
      JOIN articles a ON aa.article_id = a.id
      LEFT JOIN user_likes l ON a.id = l.article_id
      WHERE aa.author_id = ?
    `).bind(authorId).first<{ total_views: number; total_likes: number; total_shares: number }>();

    // Get top categories
    const categoriesResult = await this.d1Service.db.prepare(`
      SELECT a.category, COUNT(*) as count
      FROM article_authors aa
      JOIN articles a ON aa.article_id = a.id
      WHERE aa.author_id = ?
      GROUP BY a.category
      ORDER BY count DESC
      LIMIT 3
    `).bind(authorId).all();

    return {
      totalArticles: totalArticlesResult?.count || 0,
      articlesThisMonth: thisMonthResult?.count || 0,
      avgQualityScore: qualityResult?.avg_score || 0,
      totalViews: engagementResult?.total_views || 0,
      totalLikes: engagementResult?.total_likes || 0,
      totalShares: engagementResult?.total_shares || 0,
      topCategories: categoriesResult.results.map((cat: any) => cat.category),
      collaborators: [] // TODO: Implement collaborator detection
    };
  }

  private async ensureAuthorOutletRelationship(
    authorId: number, 
    outletId: string, 
    title?: string,
    isPrimary: boolean = false
  ): Promise<void> {
    const existing = await this.d1Service.db.prepare(`
      SELECT id FROM author_outlets 
      WHERE author_id = ? AND outlet_id = ?
    `).bind(authorId, outletId).first();

    if (!existing) {
      const role = this.inferRoleFromTitle(title);
      
      await this.d1Service.db.prepare(`
        INSERT INTO author_outlets (
          author_id, outlet_id, role, is_primary, start_date, created_at
        ) VALUES (?, ?, ?, ?, CURRENT_DATE, CURRENT_TIMESTAMP)
      `).bind(authorId, outletId, role, isPrimary).run();
    }
  }

  private async findSimilarAuthors(name: string): Promise<any[]> {
    const variations = this.generateNameVariations(name);
    const placeholders = variations.map(() => '?').join(',');
    
    const similar = await this.d1Service.db.prepare(`
      SELECT * FROM persons
      WHERE normalized_name IN (${placeholders})
      OR name LIKE ? 
      ORDER BY verification_status DESC, article_count DESC
      LIMIT 3
    `).bind(...variations, `%${name}%`).all();

    return similar.results;
  }

  private generateNameVariations(name: string): string[] {
    const normalized = this.normalizeAuthorName(name);
    const variations = [normalized];
    
    // Common variations
    const parts = name.split(' ');
    if (parts.length > 1) {
      // First name + last name
      variations.push(this.normalizeAuthorName(`${parts[0]} ${parts[parts.length - 1]}`));
      // Last name + first name
      variations.push(this.normalizeAuthorName(`${parts[parts.length - 1]} ${parts[0]}`));
    }
    
    return variations;
  }

  private normalizeAuthorName(name: string): string {
    return name.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  private async generateUniqueSlug(baseName: string): Promise<string> {
    let slug = baseName.replace(/_/g, '-');
    let counter = 1;
    
    while (true) {
      const existing = await this.d1Service.db.prepare(`
        SELECT id FROM persons WHERE slug = ?
      `).bind(slug).first();
      
      if (!existing) {
        return slug;
      }
      
      slug = `${baseName.replace(/_/g, '-')}-${counter}`;
      counter++;
    }
  }

  private estimateExperience(title?: string): number {
    if (!title) return 3;
    
    const titleLower = title.toLowerCase();
    if (titleLower.includes('senior') || titleLower.includes('chief')) return 10;
    if (titleLower.includes('editor')) return 15;
    if (titleLower.includes('correspondent')) return 8;
    if (titleLower.includes('reporter')) return 5;
    
    return 3;
  }

  private inferRoleFromTitle(title?: string): string {
    if (!title) return 'contributor';
    
    const titleLower = title.toLowerCase();
    if (titleLower.includes('editor')) return 'editor';
    if (titleLower.includes('chief')) return 'staff';
    if (titleLower.includes('senior')) return 'staff';
    if (titleLower.includes('correspondent')) return 'correspondent';
    if (titleLower.includes('reporter')) return 'staff';
    
    return 'contributor';
  }

  private async mergeAuthorData(authorId: number, newData: any): Promise<void> {
    // Update any missing information
    if (newData.title) {
      await this.d1Service.db.prepare(`
        UPDATE persons SET title = ?, date_modified = CURRENT_TIMESTAMP
        WHERE id = ? AND (title IS NULL OR title = '')
      `).bind(newData.title, authorId).run();
    }
  }

  private async initializeAuthorCredibility(authorId: number): Promise<void> {
    await this.d1Service.db.prepare(`
      INSERT OR IGNORE INTO author_credibility (
        author_id, fact_check_score, source_reliability, peer_recognition,
        reader_trust, correction_rate, overall_credibility, last_calculated
      ) VALUES (?, 0.5, 0.5, 0.5, 0.5, 0.0, 0.5, CURRENT_TIMESTAMP)
    `).bind(authorId).run();
  }

  private async getAuthorFollowerCount(authorId: number): Promise<number> {
    const result = await this.d1Service.db.prepare(`
      SELECT follower_count FROM persons WHERE id = ?
    `).bind(authorId).first<{ follower_count: number }>();

    return result?.follower_count || 0;
  }

  private async getSourceFollowerCount(sourceId: string): Promise<number> {
    const result = await this.d1Service.db.prepare(`
      SELECT follower_count FROM organizations WHERE id = ?
    `).bind(sourceId).first<{ follower_count: number }>();

    return result?.follower_count || 0;
  }
}