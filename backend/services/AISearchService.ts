/**
 * AI-Powered Search Service for Mukoko News
 * Uses Cloudflare Workers AI and Vectorize for semantic search
 */

export interface SearchResult {
  id: number;
  slug: string;
  headline: string;
  description: string;
  publisher_name: string;
  article_section_id: string;
  date_published: string;
  score: number;
  highlights?: string[];
}

export interface AIInsight {
  type: 'trending' | 'related' | 'recommendation' | 'summary';
  content: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
  category?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  includeInsights?: boolean;
}

export class AISearchService {
  private ai: Ai;
  private vectorize: VectorizeIndex;
  private db: D1Database;
  private analyticsDataset?: AnalyticsEngineDataset;

  constructor(
    ai: Ai,
    vectorize: VectorizeIndex,
    db: D1Database,
    analyticsDataset?: AnalyticsEngineDataset
  ) {
    this.ai = ai;
    this.vectorize = vectorize;
    this.db = db;
    this.analyticsDataset = analyticsDataset;
  }

  /**
   * Perform semantic search using AI embeddings
   */
  async semanticSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 20, category, source, dateFrom, dateTo } = options;

    try {
      // Generate embedding for the search query
      const embedding = await this.generateEmbedding(query);

      // Search Vectorize index
      const vectorResults = await this.vectorize.query(embedding, {
        topK: limit * 2, // Get more results for filtering
        returnMetadata: true,
      });

      if (!vectorResults.matches || vectorResults.matches.length === 0) {
        // Fallback to keyword search if no vector results
        return this.keywordSearch(query, options);
      }

      // Get article IDs from vector results
      const articleIds = vectorResults.matches.map(m => m.id);

      // Fetch full article data from D1
      const placeholders = articleIds.map(() => '?').join(',');
      let sql = `
        SELECT id, slug, headline, description, publisher_name, article_section_id, date_published
        FROM articles
        WHERE id IN (${placeholders})
      `;
      const params: (string | number)[] = [...articleIds];

      // Apply filters
      if (category) {
        sql += ' AND article_section_id = ?';
        params.push(category);
      }
      if (source) {
        sql += ' AND publisher_name = ?';
        params.push(source);
      }
      if (dateFrom) {
        sql += ' AND date_published >= ?';
        params.push(dateFrom);
      }
      if (dateTo) {
        sql += ' AND date_published <= ?';
        params.push(dateTo);
      }

      sql += ' ORDER BY date_published DESC LIMIT ?';
      params.push(limit);

      const articles = await this.db.prepare(sql).bind(...params).all();

      // Combine with vector scores
      const results: SearchResult[] = (articles.results || []).map((article: any) => {
        const vectorMatch = vectorResults.matches.find(m => m.id === String(article.id));
        return {
          id: article.id,
          slug: article.slug,
          headline: article.headline,
          description: article.description,
          publisher_name: article.publisher_name,
          article_section_id: article.article_section_id,
          date_published: article.date_published,
          score: vectorMatch?.score || 0,
        };
      });

      // Sort by score
      results.sort((a, b) => b.score - a.score);

      // Track search analytics
      this.trackSearch(query, results.length);

      return results.slice(0, limit);
    } catch (error) {
      console.error('[AISearch] Semantic search error:', error);
      // Fallback to keyword search on error
      return this.keywordSearch(query, options);
    }
  }

  /**
   * Fallback keyword search using D1 FTS
   */
  async keywordSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 20, category, source, dateFrom, dateTo } = options;

    let sql = `
      SELECT id, slug, headline, description, publisher_name, article_section_id, date_published,
             1.0 as score
      FROM articles
      WHERE (headline LIKE ? OR description LIKE ? OR content_search LIKE ?)
    `;
    const searchPattern = `%${query}%`;
    const params: (string | number)[] = [searchPattern, searchPattern, searchPattern];

    if (category) {
      sql += ' AND article_section_id = ?';
      params.push(category);
    }
    if (source) {
      sql += ' AND publisher_name = ?';
      params.push(source);
    }
    if (dateFrom) {
      sql += ' AND date_published >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ' AND date_published <= ?';
      params.push(dateTo);
    }

    sql += ' ORDER BY date_published DESC LIMIT ?';
    params.push(limit);

    const articles = await this.db.prepare(sql).bind(...params).all();

    return (articles.results || []).map((article: any) => ({
      id: article.id,
      slug: article.slug,
      headline: article.headline,
      description: article.description,
      publisher_name: article.publisher_name,
      article_section_id: article.article_section_id,
      date_published: article.date_published,
      score: article.score,
    }));
  }

  /**
   * Generate AI insights for search results or articles
   */
  async generateInsights(context: string, type: AIInsight['type'] = 'summary'): Promise<AIInsight> {
    try {
      const prompts: Record<AIInsight['type'], string> = {
        trending: `Analyze these Zimbabwe news headlines and identify the main trending topic in 1-2 sentences: ${context}`,
        related: `Based on this article, suggest 3 related topics that readers might be interested in: ${context}`,
        recommendation: `Based on this user's reading history, recommend what type of articles they might enjoy: ${context}`,
        summary: `Summarize the key points from these Zimbabwe news articles in 2-3 sentences: ${context}`,
      };

      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        prompt: prompts[type],
        max_tokens: 200,
      });

      return {
        type,
        content: (response as any).response || 'Unable to generate insight',
        confidence: 0.85,
      };
    } catch (error) {
      console.error('[AISearch] Insight generation error:', error);
      return {
        type,
        content: 'Insight generation temporarily unavailable',
        confidence: 0,
      };
    }
  }

  /**
   * Get trending topics using AI analysis
   */
  async getTrendingTopics(limit: number = 5): Promise<string[]> {
    try {
      // Get recent article titles
      const recentArticles = await this.db.prepare(`
        SELECT headline FROM articles
        WHERE date_published >= datetime('now', '-24 hours')
        ORDER BY date_published DESC
        LIMIT 50
      `).all();

      const titles = (recentArticles.results || []).map((a: any) => a.headline).join('\n');

      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        prompt: `Extract the ${limit} most important trending topics from these Zimbabwe news headlines. Return only the topic names, one per line:\n${titles}`,
        max_tokens: 100,
      });

      const topics = ((response as any).response || '')
        .split('\n')
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0)
        .slice(0, limit);

      return topics;
    } catch (error) {
      console.error('[AISearch] Trending topics error:', error);
      return [];
    }
  }

  /**
   * Index an article in Vectorize for semantic search
   */
  async indexArticle(article: {
    id: number;
    headline: string;
    description: string;
    article_body?: string;
    article_section_id: string;
    publisher_name: string;
  }): Promise<boolean> {
    try {
      const textToEmbed = `${article.headline}. ${article.description}. ${article.article_body || ''}`.slice(0, 2000);
      const embedding = await this.generateEmbedding(textToEmbed);

      await this.vectorize.upsert([
        {
          id: String(article.id),
          values: embedding,
          metadata: {
            article_section_id: article.article_section_id,
            publisher_name: article.publisher_name,
          },
        },
      ]);

      return true;
    } catch (error) {
      console.error('[AISearch] Article indexing error:', error);
      return false;
    }
  }

  /**
   * Batch index multiple articles
   */
  async batchIndexArticles(articles: Array<{
    id: number;
    headline: string;
    description: string;
    article_body?: string;
    article_section_id: string;
    publisher_name: string;
  }>): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    // Process in batches of 10
    for (let i = 0; i < articles.length; i += 10) {
      const batch = articles.slice(i, i + 10);
      const results = await Promise.all(
        batch.map(article => this.indexArticle(article))
      );
      success += results.filter(r => r).length;
      failed += results.filter(r => !r).length;
    }

    return { success, failed };
  }

  /**
   * Generate embedding for text using Workers AI
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.ai.run('@cf/baai/bge-base-en-v1.5', {
      text: [text],
    });
    return (response as any).data[0];
  }

  /**
   * Track search query for analytics
   */
  private trackSearch(query: string, resultCount: number): void {
    if (this.analyticsDataset) {
      this.analyticsDataset.writeDataPoint({
        blobs: [query],
        doubles: [resultCount],
        indexes: ['search_query'],
      });
    }
  }
}
