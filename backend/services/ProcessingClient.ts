/**
 * ProcessingClient — thin wrapper for calling the Python News API Worker
 * (mukoko-news-api) via Service Binding.
 *
 * Production: https://news-api.mukoko.com
 *
 * The Python Worker handles: RSS parsing, content cleaning, AI processing,
 * clustering, search, and feed ranking using proper Python libraries
 * (feedparser, beautifulsoup4, numpy, textstat) + Anthropic Claude via AI Gateway.
 * Primary data store: MongoDB Atlas (via mongo-proxy Service Binding in the Python Worker).
 *
 * Usage:
 *   const client = new ProcessingClient(env.DATA_PROCESSOR);
 *   const result = await client.processArticle({ id: 1, title: "...", content: "..." });
 *
 * All methods return the parsed JSON response from the Python Worker.
 * On failure, they throw with the error message from the Worker.
 */

type ServiceBinding = { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };

export class ProcessingClient {
  private binding: ServiceBinding;

  constructor(dataProcessor: ServiceBinding) {
    this.binding = dataProcessor;
  }

  // ---------------------------------------------------------------------------
  // RSS parsing — replaces SimpleRSSService XML parsing + image extraction
  // ---------------------------------------------------------------------------

  async parseRSS(feedXml: string, source: { id?: number; name: string; category?: string; country_id?: string }) {
    return this._post<{
      articles: Array<{
        title: string;
        description: string | null;
        content: string | null;
        author: string | null;
        source: string;
        source_id: number | undefined;
        category_id: string | undefined;
        country_id: string | undefined;
        published_at: string;
        image_url: string | null;
        original_url: string;
        rss_guid: string;
        slug: string;
      }>;
      feed_title: string;
      item_count: number;
      error?: string;
    }>('/rss/parse', { xml: feedXml, source });
  }

  // ---------------------------------------------------------------------------
  // Content cleaning — replaces ArticleAIService.cleanContent()
  // ---------------------------------------------------------------------------

  async cleanContent(html: string, options?: {
    removeImages?: boolean;
    extractImageUrls?: boolean;
    minContentLength?: number;
  }) {
    return this._post<{
      cleaned_content: string;
      extracted_images: string[];
      removed_char_count: number;
    }>('/content/clean', { html, options });
  }

  // ---------------------------------------------------------------------------
  // Full article AI pipeline — replaces ArticleAIService.processArticle()
  // ---------------------------------------------------------------------------

  async processArticle(article: {
    id: number;
    title: string;
    content: string;
    description?: string;
    category?: string;
  }) {
    return this._post<{
      cleaned_content: string;
      extracted_images: string[];
      keywords: Array<{ keyword: string; confidence: number; category: string }>;
      quality_score: number;
      content_hash: string;
      embedding_id: string | null;
      processing_time_ms: number;
      quality_details: {
        quality_score: number;
        word_count: number;
        reading_ease: number | null;
        grade_level: number | null;
      };
    }>('/content/process', article);
  }

  // ---------------------------------------------------------------------------
  // Keyword extraction — replaces ArticleAIService.extractKeywords()
  // ---------------------------------------------------------------------------

  async extractKeywords(title: string, content: string, category?: string) {
    return this._post<{
      keywords: Array<{ keyword: string; confidence: number; category: string }>;
    }>('/keywords/extract', { title, content, category });
  }

  // ---------------------------------------------------------------------------
  // Quality scoring — replaces ArticleAIService.calculateQualityScore()
  // ---------------------------------------------------------------------------

  async scoreQuality(title: string, content: string) {
    return this._post<{
      quality_score: number;
      word_count: number;
      reading_ease: number | null;
      grade_level: number | null;
      breakdown: {
        length_score: number;
        readability_score: number;
        title_score: number;
        structure_score: number;
      };
    }>('/quality/score', { title, content });
  }

  // ---------------------------------------------------------------------------
  // Clustering — replaces StoryClusteringService.clusterArticles()
  // ---------------------------------------------------------------------------

  async clusterArticles(
    articles: Array<{ id: string; title: string; source: string; [key: string]: unknown }>,
    config?: {
      similarityThreshold?: number;
      maxRelatedPerCluster?: number;
      maxClusters?: number;
    }
  ) {
    return this._post<{
      clusters: Array<{
        id: string;
        primary_article: Record<string, unknown>;
        related_articles: Array<Record<string, unknown>>;
        article_count: number;
      }>;
      method: 'semantic' | 'jaccard' | 'none';
    }>('/clustering/cluster', { articles, config });
  }

  // ---------------------------------------------------------------------------
  // Search — replaces AISearchService.semanticSearch()
  // ---------------------------------------------------------------------------

  async search(query: string, options?: {
    limit?: number;
    category?: string;
    source?: string;
    dateFrom?: string;
    dateTo?: string;
    includeInsights?: boolean;
  }) {
    return this._post<{
      results: Array<{
        id: number;
        slug: string;
        title: string;
        description: string;
        source: string;
        category: string;
        published_at: string;
        score: number;
      }>;
      insights: Array<{ type: string; content: string; confidence: number }> | null;
      method: 'semantic' | 'keyword' | 'none';
    }>('/search/query', { query, options });
  }

  // ---------------------------------------------------------------------------
  // Trending topics — replaces AISearchService.getTrendingTopics()
  // ---------------------------------------------------------------------------

  async getTrendingTopics() {
    return this._get<{
      topics: string[];
    }>('/search/trending');
  }

  // ---------------------------------------------------------------------------
  // Feed ranking — replaces PersonalizedFeedService scoring
  // ---------------------------------------------------------------------------

  async rankFeed(
    articles: Array<Record<string, unknown>>,
    preferences: {
      followedSources?: string[];
      followedAuthors?: string[];
      followedCategories?: string[];
      preferredCountries?: string[];
      primaryCountry?: string | null;
      categoryInterests?: Record<string, number>;
    }
  ) {
    return this._post<{
      articles: Array<Record<string, unknown> & { score: number; score_breakdown: Record<string, number> }>;
    }>('/feed/rank', { articles, preferences });
  }

  // ---------------------------------------------------------------------------
  // Content scraping — replaces ArticleService web scraping
  // ---------------------------------------------------------------------------

  async scrapeContent(url: string) {
    return this._post<{
      title: string;
      description: string;
      content: string;
      image_url: string | null;
      author: string | null;
      word_count: number;
      reading_time_minutes: number;
      error?: string;
    }>('/content/scrape', { url });
  }

  // ---------------------------------------------------------------------------
  // Feed collection — triggers batch RSS collection in Python Worker
  // ---------------------------------------------------------------------------

  async collectFeeds(options?: { batch?: number; batchSize?: number }) {
    return this._post<{
      success: boolean;
      newArticles: number;
      errors: number;
      batch: number;
      totalBatches: number;
      totalSources: number;
      details: string[];
      sourceResults?: Array<{ source_id: number; success: boolean; error?: string }>;
    }>('/feed/collect', options || {});
  }

  // ---------------------------------------------------------------------------
  // Source health — MongoDB-backed health monitoring
  // ---------------------------------------------------------------------------

  async getSourceHealth() {
    return this._get<{
      sources: Array<{
        source_id: number;
        name: string;
        status: string;
        consecutive_failures: number;
        last_successful_fetch: string | null;
        quality_score: number;
      }>;
      summary: {
        healthy: number;
        degraded: number;
        failing: number;
        critical: number;
      };
    }>('/sources/health');
  }

  // ---------------------------------------------------------------------------
  // Trending — MongoDB aggregation-based trending topics
  // ---------------------------------------------------------------------------

  async getTrending(countryId?: string) {
    if (countryId && !/^[A-Z]{2}$/.test(countryId)) {
      throw new Error(`Invalid country ID: ${countryId}`);
    }
    const path = countryId ? `/trending/${encodeURIComponent(countryId)}` : '/trending';
    return this._get<{
      topics: Array<{
        keyword: string;
        count: number;
        velocity: number;
        country_id?: string;
      }>;
      cached: boolean;
    }>(path);
  }

  // ---------------------------------------------------------------------------
  // Analytics & insights — MongoDB aggregation-powered
  // ---------------------------------------------------------------------------

  async getEnhancedStats() {
    return this._get<{
      database: {
        total_articles: number;
        active_sources: number;
        categories: number;
        today_articles: number;
        week_articles: number;
      };
      source: string;
      timestamp: string;
    }>('/analytics/stats');
  }

  async getTrendingCategories(limit = 8) {
    return this._get<{
      success: boolean;
      trending: Array<{
        id: string;
        name: string;
        slug: string;
        article_count: number;
        growth_rate: number;
        engagement: number;
      }>;
      source: string;
      timestamp: string;
    }>('/analytics/trending-categories');
  }

  async getContentInsights(countryId?: string) {
    if (countryId && !/^[A-Z]{2}$/.test(countryId)) {
      throw new Error(`Invalid country ID: ${countryId}`);
    }
    return this._post<{
      top_articles: Array<{
        title: string;
        source: string;
        category_id: string;
        country_id: string;
        engagement_score: number;
        view_count: number;
        like_count: number;
        published_at: string;
      }>;
      source_productivity: Array<{
        _id: string;
        article_count: number;
        avg_engagement: number;
      }>;
      country_id: string | null;
      source: string;
      timestamp: string;
    }>('/analytics/insights', { country_id: countryId || null });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  async _healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await this.binding.fetch('http://news-api/health', {
          method: 'GET',
          signal: controller.signal,
        });
        return res.ok;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  private async _post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await this.binding.fetch(`http://news-api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text();
        console.error(`[ProcessingClient] POST ${path} failed (${res.status}):`, errorBody.slice(0, 200));
        throw new Error(`Processing service error (${res.status}) at POST ${path}`);
      }

      return res.json() as Promise<T>;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Processing service timeout (15s) at POST ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async _get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await this.binding.fetch(`http://news-api${path}`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text();
        console.error(`[ProcessingClient] GET ${path} failed (${res.status}):`, errorBody.slice(0, 200));
        throw new Error(`Processing service error (${res.status}) at GET ${path}`);
      }

      return res.json() as Promise<T>;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Processing service timeout (15s) at GET ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
