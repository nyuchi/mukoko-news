/**
 * NewsSourceManager - Dynamic News Source Management System
 *
 * Features:
 * - Dynamic source discovery and validation
 * - Source quality scoring and monitoring
 * - Automatic RSS feed detection
 * - Source performance tracking
 * - Bulk source import/management
 * - Source health monitoring
 */

import { CategoryManager } from './CategoryManager.js';
import {
  validateNewsSourceRow,
  validateNewsSourceRows,
  validateSourceMetrics,
  parseCountResult,
  type NewsSourceRow,
} from '../utils/validation.js';

export interface NewsSource {
  id: string;
  name: string;
  url: string;
  rss_url?: string;
  base_domain: string;
  article_section_id: string;
  area_served: string;
  language: string;
  enabled: boolean;
  priority: number;
  quality_score: number;
  reliability_score: number;
  freshness_score: number;
  last_validated_at?: string;
  validation_status: 'pending' | 'valid' | 'invalid' | 'needs_review';
  error_count: number;
  success_count: number;
  last_error?: string;
  last_successful_fetch?: string;
  created_at: string;
  updated_at: string;
}

export interface SourceValidationResult {
  is_valid: boolean;
  rss_url?: string;
  detected_feeds: string[];
  feed_quality: number;
  estimated_update_frequency: string;
  language_detected?: string;
  content_sample?: string;
  error_message?: string;
  validation_details: {
    has_rss: boolean;
    rss_accessible: boolean;
    articles_count: number;
    recent_articles: boolean;
    feed_structure_valid: boolean;
    encoding_issues: boolean;
  };
}

export class NewsSourceManager {
  constructor(private db: D1Database) {}

  /**
   * Get a single source by ID
   */
  async getSourceById(sourceId: string): Promise<NewsSource | null> {
    try {
      const result = await this.db
        .prepare('SELECT * FROM organizations WHERE id = ?')
        .bind(sourceId)
        .first();

      // Use runtime validation instead of type assertion
      const validated = validateNewsSourceRow(result);
      if (!validated) return null;

      // Convert validated row to NewsSource
      return this.rowToNewsSource(validated);
    } catch (error) {
      console.error(`[NewsSourceManager] Error fetching source ${sourceId}:`, error);
      return null;
    }
  }

  /**
   * Get all news sources from the database
   */
  async getAllSources(options?: { enabledOnly?: boolean }): Promise<NewsSource[]> {
    try {
      const query = options?.enabledOnly
        ? 'SELECT * FROM organizations WHERE enabled = 1 ORDER BY priority DESC, name ASC'
        : 'SELECT * FROM organizations ORDER BY priority DESC, name ASC';

      const result = await this.db.prepare(query).all();
      const validated = validateNewsSourceRows(result.results);

      return validated.map((row) => this.rowToNewsSource(row));
    } catch (error) {
      console.error('[NewsSourceManager] Error fetching all sources:', error);
      return [];
    }
  }

  /**
   * Convert a validated row to NewsSource with proper defaults
   */
  private rowToNewsSource(row: NewsSourceRow): NewsSource {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      rss_url: row.rss_url,
      base_domain: row.base_domain || new URL(row.url).hostname,
      article_section_id: row.article_section_id,
      area_served: row.area_served || 'ZW',
      language: row.language || 'en',
      enabled: row.enabled,
      priority: row.priority,
      quality_score: row.quality_score ?? 50,
      reliability_score: row.reliability_score ?? 50,
      freshness_score: row.freshness_score ?? 50,
      last_validated_at: row.last_validated_at,
      validation_status: (row.validation_status as NewsSource['validation_status']) || 'pending',
      error_count: row.error_count ?? 0,
      success_count: row.success_count ?? 0,
      last_error: row.last_error,
      last_successful_fetch: row.last_successful_fetch,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
    };
  }

  // ===============================================================
  // SOURCE DISCOVERY AND VALIDATION
  // ===============================================================

  /**
   * Discover RSS feeds from a website URL
   */
  async discoverRSSFeeds(websiteUrl: string): Promise<string[]> {
    try {
      console.log(`[NewsSourceManager] Discovering RSS feeds for: ${websiteUrl}`);
      
      // Common RSS feed patterns for Zimbabwe news sites
      const commonPaths = [
        '/feed/',
        '/rss/',
        '/feed.xml',
        '/rss.xml',
        '/feeds/all.rss.xml',
        '/index.xml',
        '/?feed=rss2',
        '/wp-rss2.php',
        '/news/feed/',
        '/articles/feed/'
      ];

      const baseUrl = websiteUrl.replace(/\/$/, '');
      const discoveredFeeds: string[] = [];

      // Try each common path
      for (const path of commonPaths) {
        const feedUrl = `${baseUrl}${path}`;
        
        try {
          const response = await fetch(feedUrl, {
            method: 'HEAD',
            headers: {
              'User-Agent': 'Harare Metro News Aggregator 2.0 (Feed Discovery)'
            }
          });

          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('xml') || contentType.includes('rss')) {
              discoveredFeeds.push(feedUrl);
              console.log(`[NewsSourceManager] Found RSS feed: ${feedUrl}`);
            }
          }
        } catch (error) {
          // Continue to next path
        }
      }

      // Try to fetch main page and look for RSS links
      // Security: Limit HTML content to prevent DoS
      const MAX_HTML_SIZE = 500000; // 500KB max
      try {
        const mainPageResponse = await fetch(websiteUrl, {
          headers: {
            'User-Agent': 'Harare Metro News Aggregator 2.0 (Feed Discovery)'
          }
        });

        if (mainPageResponse.ok) {
          const contentLength = mainPageResponse.headers.get('content-length');
          // Skip parsing if content is too large
          if (contentLength && parseInt(contentLength) > MAX_HTML_SIZE) {
            console.warn(`[NewsSourceManager] Skipping HTML parsing - content too large: ${contentLength} bytes`);
          } else {
            const html = await mainPageResponse.text();

            // Limit HTML size after fetch as well
            const safeHtml = html.slice(0, MAX_HTML_SIZE);

            // Use simpler, non-backtracking regex approach
            // Extract all link tags first, then filter
            const linkTags = safeHtml.match(/<link[^>]*>/gi) || [];

            for (const linkTag of linkTags) {
              // Check if it's an RSS or Atom feed link
              const isRss = /type\s*=\s*["']application\/rss\+xml["']/i.test(linkTag);
              const isAtom = /type\s*=\s*["']application\/atom\+xml["']/i.test(linkTag);

              if (isRss || isAtom) {
                // Extract href using simple pattern
                const hrefMatch = linkTag.match(/href\s*=\s*["']([^"']+)["']/i);
                if (hrefMatch && hrefMatch[1]) {
                  const feedUrl = hrefMatch[1].startsWith('http') ? hrefMatch[1] : `${baseUrl}${hrefMatch[1]}`;
                  if (!discoveredFeeds.includes(feedUrl)) {
                    discoveredFeeds.push(feedUrl);
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        console.warn(`[NewsSourceManager] Could not fetch main page for ${websiteUrl}:`, error);
      }

      console.log(`[NewsSourceManager] Discovered ${discoveredFeeds.length} feeds for ${websiteUrl}`);
      return discoveredFeeds;
    } catch (error) {
      console.error(`[NewsSourceManager] Error discovering feeds for ${websiteUrl}:`, error);
      return [];
    }
  }

  /**
   * Validate an RSS feed and assess its quality
   */
  async validateRSSFeed(feedUrl: string): Promise<SourceValidationResult> {
    try {
      console.log(`[NewsSourceManager] Validating RSS feed: ${feedUrl}`);
      
      const result: SourceValidationResult = {
        is_valid: false,
        detected_feeds: [feedUrl],
        feed_quality: 0,
        estimated_update_frequency: 'unknown',
        validation_details: {
          has_rss: true,
          rss_accessible: false,
          articles_count: 0,
          recent_articles: false,
          feed_structure_valid: false,
          encoding_issues: false
        }
      };

      // Try to fetch the RSS feed
      const response = await fetch(feedUrl, {
        headers: {
          'User-Agent': 'Harare Metro News Aggregator 2.0 (Validation)',
          'Accept': 'application/rss+xml, application/xml, text/xml'
        }
      });

      if (!response.ok) {
        result.error_message = `HTTP ${response.status}: ${response.statusText}`;
        return result;
      }

      result.validation_details.rss_accessible = true;

      // Parse the feed content
      const xmlContent = await response.text();
      
      // Basic XML validation
      if (!xmlContent.includes('<rss') && !xmlContent.includes('<feed')) {
        result.error_message = 'Not a valid RSS or Atom feed';
        return result;
      }

      result.validation_details.feed_structure_valid = true;

      // Extract articles for quality assessment
      try {
        // Dynamic import for better performance - only load parser when needed
        const { XMLParser } = await import('fast-xml-parser');
        const parser = new XMLParser({
          ignoreAttributes: false,
          parseAttributeValue: true,
          trimValues: true
        });

        const feedData = parser.parse(xmlContent);
        const channel = feedData.rss?.channel || feedData.feed;
        const items = channel?.item || channel?.entry || [];

        if (Array.isArray(items) && items.length > 0) {
          result.validation_details.articles_count = items.length;
          result.feed_quality = Math.min(items.length * 10, 100); // Max 100

          // Check for recent articles (within last 7 days)
          const recentArticles = items.filter(item => {
            const pubDate = item.pubDate || item.published || item.updated;
            if (pubDate) {
              const articleDate = new Date(pubDate);
              const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
              return articleDate > weekAgo;
            }
            return false;
          });

          result.validation_details.recent_articles = recentArticles.length > 0;
          if (recentArticles.length > 0) {
            result.feed_quality += 20; // Bonus for recent content
          }

          // Estimate update frequency
          if (recentArticles.length >= 5) {
            result.estimated_update_frequency = 'daily';
          } else if (recentArticles.length >= 2) {
            result.estimated_update_frequency = 'weekly';  
          } else {
            result.estimated_update_frequency = 'monthly';
          }

          // Sample content for language detection
          if (items[0]) {
            const title = items[0].title || '';
            const description = items[0].description || '';
            result.content_sample = `${title} ${description}`.substring(0, 200);
            
            // Simple language detection for Zimbabwe content
            const zimbabweKeywords = ['zimbabwe', 'harare', 'bulawayo', 'zim', 'zw', 'rtgs', 'bond'];
            const hasZimbabweContent = zimbabweKeywords.some(keyword => 
              result.content_sample.toLowerCase().includes(keyword)
            );
            
            if (hasZimbabweContent) {
              result.language_detected = 'en-zw'; // English (Zimbabwe)
              result.feed_quality += 30; // Bonus for Zimbabwe relevance
            } else {
              result.language_detected = 'en';
            }
          }

          result.is_valid = true;
          result.rss_url = feedUrl;

        } else {
          result.error_message = 'Feed contains no articles';
        }

      } catch (parseError) {
        result.error_message = `Feed parsing error: ${parseError.message}`;
        result.validation_details.encoding_issues = true;
      }

      console.log(`[NewsSourceManager] Validation complete for ${feedUrl}: quality=${result.feed_quality}, valid=${result.is_valid}`);
      return result;

    } catch (error) {
      console.error(`[NewsSourceManager] Error validating ${feedUrl}:`, error);
      return {
        is_valid: false,
        detected_feeds: [],
        feed_quality: 0,
        estimated_update_frequency: 'unknown',
        error_message: error.message,
        validation_details: {
          has_rss: false,
          rss_accessible: false,
          articles_count: 0,
          recent_articles: false,
          feed_structure_valid: false,
          encoding_issues: false
        }
      };
    }
  }

  /**
   * Add a new news source with automatic validation
   */
  async addNewsSource(
    websiteUrl: string,
    sourceName: string,
    category: string = 'general',
    priority: number = 3
  ): Promise<{ success: boolean; source?: NewsSource; message: string }> {
    try {
      console.log(`[NewsSourceManager] Adding new source: ${sourceName} (${websiteUrl})`);

      // Extract base domain
      const baseDomain = new URL(websiteUrl).hostname;

      // Check if source already exists by URL or name
      const existingSource = await this.db
        .prepare('SELECT id FROM organizations WHERE url = ? OR name = ?')
        .bind(websiteUrl, sourceName)
        .first();

      if (existingSource) {
        return {
          success: false,
          message: `Source ${sourceName} already exists`
        };
      }

      // Discover RSS feeds
      const discoveredFeeds = await this.discoverRSSFeeds(websiteUrl);

      if (discoveredFeeds.length === 0) {
        return {
          success: false,
          message: 'No RSS feeds found on this website'
        };
      }

      // Validate the best feed
      let bestFeed = discoveredFeeds[0];
      let bestValidation: SourceValidationResult | null = null;

      for (const feedUrl of discoveredFeeds.slice(0, 3)) { // Check top 3 feeds
        const validation = await this.validateRSSFeed(feedUrl);
        if (validation.is_valid && (!bestValidation || validation.feed_quality > bestValidation.feed_quality)) {
          bestFeed = feedUrl;
          bestValidation = validation;
        }
      }

      if (!bestValidation || !bestValidation.is_valid) {
        return {
          success: false,
          message: 'No valid RSS feeds found on this website'
        };
      }

      // Generate source ID
      const sourceId = sourceName.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);

      // Create source record
      const source: NewsSource = {
        id: sourceId,
        name: sourceName,
        url: websiteUrl,
        rss_url: bestFeed,
        base_domain: baseDomain,
        article_section_id: category,
        area_served: 'ZW', // Zimbabwe
        language: bestValidation.language_detected || 'en',
        enabled: true,
        priority: priority,
        quality_score: bestValidation.feed_quality,
        reliability_score: 50, // Start with neutral score
        freshness_score: bestValidation.validation_details.recent_articles ? 80 : 30,
        validation_status: 'valid',
        error_count: 0,
        success_count: 1,
        last_validated_at: new Date().toISOString(),
        last_successful_fetch: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Insert into database
      await this.db
        .prepare(`
          INSERT INTO organizations (
            id, name, rss_feed_url, article_section_id, enabled, priority, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          source.id, source.name, source.rss_url, source.article_section_id, source.enabled ? 1 : 0,
          source.priority, JSON.stringify({
            base_domain: source.base_domain,
            area_served: source.area_served,
            language: source.language,
            quality_score: source.quality_score,
            validation_status: source.validation_status,
            original_url: source.url
          })
        )
        .run();

      console.log(`[NewsSourceManager] Successfully added source: ${sourceName}`);
      return {
        success: true,
        source,
        message: `Successfully added ${sourceName} with ${bestValidation.feed_quality} quality score`
      };

    } catch (error) {
      console.error(`[NewsSourceManager] Error adding source ${sourceName}:`, error);
      return {
        success: false,
        message: `Error adding source: ${error.message}`
      };
    }
  }

  // ===============================================================
  // SOURCE QUALITY MONITORING
  // ===============================================================

  /**
   * Update source performance metrics after RSS fetch
   */
  async updateSourcePerformance(
    sourceId: string,
    success: boolean,
    articlesCount: number = 0,
    errorMessage?: string
  ): Promise<void> {
    try {
      if (success) {
        // Calculate freshness score based on articles count
        const freshnessScore = Math.min(articlesCount * 10 + 50, 100);
        
        await this.db
          .prepare(`
            UPDATE organizations 
            SET success_count = success_count + 1,
                reliability_score = CASE 
                  WHEN reliability_score < 90 THEN reliability_score + 2
                  ELSE reliability_score 
                END,
                freshness_score = ?,
                last_successful_fetch = datetime('now'),
                last_error = NULL,
                updated_at = datetime('now')
            WHERE id = ?
          `)
          .bind(freshnessScore, sourceId)
          .run();
      } else {
        await this.db
          .prepare(`
            UPDATE organizations 
            SET error_count = error_count + 1,
                reliability_score = CASE 
                  WHEN reliability_score > 10 THEN reliability_score - 5
                  ELSE reliability_score 
                END,
                last_error = ?,
                updated_at = datetime('now')
            WHERE id = ?
          `)
          .bind(errorMessage, sourceId)
          .run();
      }

      // Calculate overall quality score
      await this.calculateQualityScore(sourceId);
      
    } catch (error) {
      console.error(`[NewsSourceManager] Error updating performance for ${sourceId}:`, error);
    }
  }

  /**
   * Calculate overall quality score for a source
   */
  private async calculateQualityScore(sourceId: string): Promise<void> {
    try {
      const result = await this.db
        .prepare(`
          SELECT reliability_score, freshness_score, success_count, error_count,
                 last_successful_fetch
          FROM organizations WHERE id = ?
        `)
        .bind(sourceId)
        .first();

      // Use runtime validation instead of type assertion
      const metrics = validateSourceMetrics(result);
      if (!metrics) return;

      // Calculate quality score based on multiple factors
      let qualityScore = 0;

      // Reliability factor (40% weight)
      qualityScore += metrics.reliability_score * 0.4;

      // Freshness factor (30% weight)
      qualityScore += metrics.freshness_score * 0.3;

      // Success ratio factor (20% weight)
      const totalAttempts = metrics.success_count + metrics.error_count;
      if (totalAttempts > 0) {
        const successRatio = metrics.success_count / totalAttempts;
        qualityScore += successRatio * 100 * 0.2;
      }

      // Recency factor (10% weight)
      if (metrics.last_successful_fetch) {
        const lastFetch = new Date(metrics.last_successful_fetch);
        const daysSinceLastFetch = (Date.now() - lastFetch.getTime()) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.max(0, 100 - daysSinceLastFetch * 10);
        qualityScore += recencyScore * 0.1;
      }

      // Update quality score
      await this.db
        .prepare('UPDATE organizations SET quality_score = ? WHERE id = ?')
        .bind(Math.round(qualityScore), sourceId)
        .run();

    } catch (error) {
      console.error(`[NewsSourceManager] Error calculating quality score for ${sourceId}:`, error);
    }
  }

  // ===============================================================
  // BULK OPERATIONS
  // ===============================================================

  /**
   * Add multiple Zimbabwe news sources including education, travel, and specialized sources
   */
  async addZimbabweNewsSources(): Promise<{ added: number; failed: number; details: string[] }> {
    const zimbabweSources = [
      // Major Media Houses (Essential)
      { name: "The Herald", url: "https://www.herald.co.zw", category: "general", priority: 5 },
      { name: "NewsDay", url: "https://www.newsday.co.zw", category: "general", priority: 5 },
      { name: "The Chronicle", url: "https://www.chronicle.co.zw", category: "general", priority: 5 },
      
      // Key Online Publications
      { name: "ZimLive", url: "https://www.zimlive.com", category: "general", priority: 4 },
      { name: "The Standard", url: "https://www.thestandard.co.zw", category: "general", priority: 4 },
      { name: "263Chat", url: "https://263chat.com", category: "general", priority: 4 },
      
      // Regional & Alternative Media
      { name: "The Zimbabwean", url: "https://www.thezimbabwean.co", category: "general", priority: 4 },
      { name: "ZimEye", url: "https://www.zimeye.net", category: "general", priority: 4 },
      { name: "MyZimbabwe", url: "https://www.myzimbabwe.co.zw", category: "general", priority: 3 },
      { name: "NewZimbabwe", url: "https://www.newzimbabwe.com", category: "general", priority: 4 },
      { name: "ZimFact", url: "https://zimfact.org", category: "general", priority: 3 },
      
      // Business & Finance
      { name: "Financial Gazette", url: "https://fingaz.co.zw", category: "finance_investing", priority: 4 },
      { name: "Zimbabwe Independent", url: "https://www.theindependent.co.zw", category: "finance_investing", priority: 4 },
      { name: "Business Weekly", url: "https://www.businessweekly.co.zw", category: "finance_investing", priority: 3 },
      { name: "The Source", url: "https://www.thesource.co.zw", category: "finance_investing", priority: 3 },
      
      // Technology & Innovation
      { name: "Techzim", url: "https://www.techzim.co.zw", category: "tech_gadgets", priority: 4 },
      { name: "TechnoMag", url: "https://technomag.co.zw", category: "tech_gadgets", priority: 3 },
      
      // Broadcasting & Media
      { name: "ZBC News Online", url: "https://www.zbc.co.zw", category: "general", priority: 4 },
      { name: "Star FM", url: "https://www.starfm.co.zw", category: "general", priority: 3 },
      { name: "ZiFM Stereo", url: "https://www.zifmstereo.co.zw", category: "general", priority: 3 },
      
      // Sports
      { name: "The Sports Hub", url: "https://www.thesportshub.co.zw", category: "sports", priority: 4 },
      { name: "Soccer24", url: "https://www.soccer24.co.zw", category: "sports", priority: 3 },
      { name: "Zimbabwe Cricket", url: "https://www.zimcricket.org", category: "sports", priority: 3 },
      
      // Education & Academic
      { name: "University of Zimbabwe", url: "https://www.uz.ac.zw", category: "languages_learning", priority: 3 },
      { name: "Zimbabwe Trust Schools", url: "https://zimbabwetrust.edu.zw", category: "languages_learning", priority: 4 },
      { name: "UNICEF Zimbabwe", url: "https://www.unicef.org/zimbabwe", category: "languages_learning", priority: 3 },
      
      // Tourism & Travel
      { name: "Zimbabwe Tourism Authority", url: "https://www.zimbabwetourism.net", category: "travel_tourism", priority: 4 },
      { name: "Victoria Falls Guide", url: "https://victoriafallsguide.net", category: "travel_tourism", priority: 4 },
      { name: "Travel News Zimbabwe", url: "https://www.travelnewszimbabwe.com", category: "travel_tourism", priority: 3 },
      
      // Health & Lifestyle
      { name: "Ministry of Health Zimbabwe", url: "https://www.mohcc.gov.zw", category: "wellness", priority: 3 },
      { name: "ZimHealth", url: "https://zimhealth.co.zw", category: "wellness", priority: 3 }
    ];

    let added = 0;
    let failed = 0;
    const details: string[] = [];

    for (const source of zimbabweSources) {
      try {
        const result = await this.addNewsSource(
          source.url,
          source.name,
          source.category,
          source.priority
        );

        if (result.success) {
          added++;
          details.push(`✅ ${source.name}: ${result.message}`);
        } else {
          failed++;
          details.push(`❌ ${source.name}: ${result.message}`);
        }

        // Small delay to avoid overwhelming servers
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        failed++;
        details.push(`❌ ${source.name}: ${error.message}`);
      }
    }

    return { added, failed, details };
  }

  /**
   * Get source performance report
   */
  async getSourcePerformanceReport(): Promise<{
    total_sources: number;
    active_sources: number;
    high_quality_sources: number;
    sources_needing_attention: NewsSource[];
    top_performers: NewsSource[];
    recent_additions: NewsSource[];
  }> {
    try {
      // Use parseCountResult for all count queries
      const totalSourcesResult = await this.db
        .prepare('SELECT COUNT(*) as count FROM organizations')
        .first();

      const activeSourcesResult = await this.db
        .prepare('SELECT COUNT(*) as count FROM organizations WHERE enabled = 1')
        .first();

      const highQualitySourcesResult = await this.db
        .prepare('SELECT COUNT(*) as count FROM organizations WHERE quality_score >= 70')
        .first();

      const sourcesNeedingAttention = await this.db
        .prepare(`
          SELECT * FROM organizations
          WHERE quality_score < 50 OR error_count > success_count
          ORDER BY quality_score ASC
          LIMIT 10
        `)
        .all();

      const topPerformers = await this.db
        .prepare(`
          SELECT * FROM organizations
          WHERE enabled = 1
          ORDER BY quality_score DESC, reliability_score DESC
          LIMIT 10
        `)
        .all();

      const recentAdditions = await this.db
        .prepare(`
          SELECT * FROM organizations
          ORDER BY created_at DESC
          LIMIT 5
        `)
        .all();

      // Use runtime validation for all results
      const validatedNeedingAttention = validateNewsSourceRows(sourcesNeedingAttention.results);
      const validatedTopPerformers = validateNewsSourceRows(topPerformers.results);
      const validatedRecentAdditions = validateNewsSourceRows(recentAdditions.results);

      return {
        total_sources: parseCountResult(totalSourcesResult),
        active_sources: parseCountResult(activeSourcesResult),
        high_quality_sources: parseCountResult(highQualitySourcesResult),
        sources_needing_attention: validatedNeedingAttention.map(row => this.rowToNewsSource(row)),
        top_performers: validatedTopPerformers.map(row => this.rowToNewsSource(row)),
        recent_additions: validatedRecentAdditions.map(row => this.rowToNewsSource(row)),
      };
    } catch (error) {
      console.error('[NewsSourceManager] Error generating performance report:', error);
      return {
        total_sources: 0,
        active_sources: 0,
        high_quality_sources: 0,
        sources_needing_attention: [],
        top_performers: [],
        recent_additions: [],
      };
    }
  }

  /**
   * Add RSS sources for all African countries
   * Adds curated news sources for each of the 15 supported countries
   */
  async addPanAfricanNewsSources(): Promise<{ added: number; failed: number; details: string[] }> {
    const panAfricanSources = [
      // South Africa (ZA)
      { name: "News24", url: "https://www.news24.com/feeds/rss/news24/topstories", country_id: "ZA", category: "general", priority: 5 },
      { name: "Daily Maverick", url: "https://www.dailymaverick.co.za/dmrss/", country_id: "ZA", category: "general", priority: 5 },
      { name: "Times LIVE", url: "https://www.timeslive.co.za/rss/", country_id: "ZA", category: "general", priority: 4 },
      { name: "IOL", url: "https://www.iol.co.za/rss", country_id: "ZA", category: "general", priority: 4 },
      { name: "BusinessTech", url: "https://businesstech.co.za/news/feed/", country_id: "ZA", category: "finance_investing", priority: 4 },

      // Kenya (KE)
      { name: "Nation Africa Kenya", url: "https://nation.africa/kenya/rss", country_id: "KE", category: "general", priority: 5 },
      { name: "The Standard Kenya", url: "https://www.standardmedia.co.ke/rss/headlines.php", country_id: "KE", category: "general", priority: 5 },
      { name: "Capital FM Kenya", url: "https://www.capitalfm.co.ke/news/feed/", country_id: "KE", category: "general", priority: 4 },
      { name: "Business Daily Africa", url: "https://www.businessdailyafrica.com/bd/rss", country_id: "KE", category: "finance_investing", priority: 4 },
      { name: "KTN News", url: "https://www.standardmedia.co.ke/ktnnews/rss/top-stories.php", country_id: "KE", category: "general", priority: 4 },

      // Nigeria (NG)
      { name: "Premium Times", url: "https://www.premiumtimesng.com/feed", country_id: "NG", category: "general", priority: 5 },
      { name: "The Guardian Nigeria", url: "https://guardian.ng/feed/", country_id: "NG", category: "general", priority: 5 },
      { name: "Punch Nigeria", url: "https://punchng.com/feed/", country_id: "NG", category: "general", priority: 5 },
      { name: "Vanguard Nigeria", url: "https://www.vanguardngr.com/feed/", country_id: "NG", category: "general", priority: 4 },
      { name: "ThisDay", url: "https://www.thisdaylive.com/index.php/feed/", country_id: "NG", category: "general", priority: 4 },
      { name: "Nairametrics", url: "https://nairametrics.com/feed/", country_id: "NG", category: "finance_investing", priority: 4 },

      // Ghana (GH)
      { name: "GhanaWeb", url: "https://www.ghanaweb.com/GhanaHomePage/rss/news.xml", country_id: "GH", category: "general", priority: 5 },
      { name: "Graphic Online", url: "https://www.graphic.com.gh/feeds/news.xml", country_id: "GH", category: "general", priority: 5 },
      { name: "Joy News", url: "https://www.myjoyonline.com/feed/", country_id: "GH", category: "general", priority: 4 },
      { name: "Citinewsroom", url: "https://citinewsroom.com/feed/", country_id: "GH", category: "general", priority: 4 },
      { name: "Business Ghana", url: "https://www.businessghana.com/site/feed", country_id: "GH", category: "finance_investing", priority: 3 },

      // Tanzania (TZ)
      { name: "The Citizen Tanzania", url: "https://www.thecitizen.co.tz/tanzania/news/rss", country_id: "TZ", category: "general", priority: 5 },
      { name: "Daily News Tanzania", url: "https://dailynews.co.tz/feed/", country_id: "TZ", category: "general", priority: 4 },
      { name: "Mwananchi", url: "https://www.mwananchi.co.tz/mw/rss", country_id: "TZ", category: "general", priority: 4 },
      { name: "IPP Media", url: "https://ippmedia.com/en/rss.xml", country_id: "TZ", category: "general", priority: 3 },

      // Uganda (UG)
      { name: "Daily Monitor", url: "https://www.monitor.co.ug/uganda/rss", country_id: "UG", category: "general", priority: 5 },
      { name: "New Vision", url: "https://www.newvision.co.ug/rss.xml", country_id: "UG", category: "general", priority: 5 },
      { name: "The Observer Uganda", url: "https://www.observer.ug/feed", country_id: "UG", category: "general", priority: 4 },
      { name: "ChimpReports", url: "https://chimpreports.com/feed/", country_id: "UG", category: "general", priority: 3 },

      // Rwanda (RW)
      { name: "The New Times Rwanda", url: "https://www.newtimes.co.rw/rss", country_id: "RW", category: "general", priority: 5 },
      { name: "KT Press", url: "https://www.ktpress.rw/feed/", country_id: "RW", category: "general", priority: 4 },
      { name: "Rwanda Today", url: "https://rwandatoday.africa/feed/", country_id: "RW", category: "general", priority: 3 },

      // Zambia (ZM)
      { name: "Lusaka Times", url: "https://www.lusakatimes.com/feed/", country_id: "ZM", category: "general", priority: 5 },
      { name: "Zambia Daily Mail", url: "https://www.daily-mail.co.zm/feed/", country_id: "ZM", category: "general", priority: 4 },
      { name: "Mwebantu", url: "https://www.mwebantu.com/feed/", country_id: "ZM", category: "general", priority: 4 },

      // Botswana (BW)
      { name: "Mmegi Online", url: "https://www.mmegi.bw/rss.xml", country_id: "BW", category: "general", priority: 5 },
      { name: "The Voice Botswana", url: "https://www.thevoicebw.com/feed/", country_id: "BW", category: "general", priority: 4 },
      { name: "Sunday Standard Botswana", url: "https://www.sundaystandard.info/feed/", country_id: "BW", category: "general", priority: 3 },

      // Malawi (MW)
      { name: "Nyasa Times", url: "https://www.nyasatimes.com/feed/", country_id: "MW", category: "general", priority: 5 },
      { name: "The Nation Malawi", url: "https://mwnation.com/feed/", country_id: "MW", category: "general", priority: 4 },
      { name: "Malawi24", url: "https://malawi24.com/feed/", country_id: "MW", category: "general", priority: 4 },

      // Mozambique (MZ)
      { name: "Club of Mozambique", url: "https://clubofmozambique.com/feed/", country_id: "MZ", category: "general", priority: 5 },
      { name: "AllAfrica Mozambique", url: "https://allafrica.com/mozambique/rss.xml", country_id: "MZ", category: "general", priority: 4 },

      // Namibia (NA)
      { name: "The Namibian", url: "https://www.namibian.com.na/rss/index.rss", country_id: "NA", category: "general", priority: 5 },
      { name: "New Era Namibia", url: "https://neweralive.na/feed", country_id: "NA", category: "general", priority: 4 },
      { name: "Informante", url: "https://informante.web.na/feed/", country_id: "NA", category: "general", priority: 3 },

      // Ethiopia (ET)
      { name: "Ethiopian News Agency", url: "https://www.ena.et/en/feed/", country_id: "ET", category: "general", priority: 5 },
      { name: "Addis Standard", url: "https://addisstandard.com/feed/", country_id: "ET", category: "general", priority: 5 },
      { name: "Ethiopian Monitor", url: "https://ethiopianmonitor.com/feed/", country_id: "ET", category: "general", priority: 4 },

      // Egypt (EG)
      { name: "Ahram Online", url: "https://english.ahram.org.eg/rss.aspx", country_id: "EG", category: "general", priority: 5 },
      { name: "Egypt Independent", url: "https://www.egyptindependent.com/feed/", country_id: "EG", category: "general", priority: 5 },
      { name: "Daily News Egypt", url: "https://dailynewssegypt.com/feed/", country_id: "EG", category: "general", priority: 4 },
      { name: "Egypt Today", url: "https://www.egypttoday.com/RSS", country_id: "EG", category: "general", priority: 4 },

      // Morocco (MA)
      { name: "Morocco World News", url: "https://www.moroccoworldnews.com/feed/", country_id: "MA", category: "general", priority: 5 },
      { name: "The North Africa Post", url: "https://northafricapost.com/feed/", country_id: "MA", category: "general", priority: 4 },
      { name: "Hespress English", url: "https://en.hespress.com/feed", country_id: "MA", category: "general", priority: 4 }
    ];

    let added = 0;
    let failed = 0;
    const details: string[] = [];

    for (const source of panAfricanSources) {
      try {
        // Generate a unique ID
        const sourceId = source.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        // Check if source already exists
        const existing = await this.db.prepare(
          'SELECT id FROM organizations WHERE id = ? OR url = ?'
        ).bind(sourceId, source.url).first();

        if (existing) {
          details.push(`⏩ Skipped ${source.name} (${source.country_id}): Already exists`);
          continue;
        }

        // Insert the RSS source directly
        await this.db.prepare(`
          INSERT INTO organizations (id, name, rss_feed_url, article_section_id, enabled, priority, area_served, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).bind(
          sourceId,
          source.name,
          source.url,
          source.category,
          source.priority,
          source.country_id
        ).run();

        added++;
        details.push(`✅ Added ${source.name} (${source.country_id})`);
      } catch (error: any) {
        failed++;
        details.push(`❌ Failed ${source.name} (${source.country_id}): ${error.message}`);
      }
    }

    return { added, failed, details };
  }
}

export default NewsSourceManager;