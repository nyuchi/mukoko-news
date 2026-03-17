/**
 * Tests for AISearchService
 * Tests semantic search, keyword search, AI insights, and article indexing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AISearchService } from '../AISearchService';

// Mock AI binding
const createMockAI = () => ({
  run: vi.fn(),
});

// Mock Vectorize binding
const createMockVectorize = () => ({
  query: vi.fn(),
  upsert: vi.fn(),
});

// Mock D1Database
const createMockD1 = () => {
  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
  };

  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    _statement: mockStatement,
  };
};

// Mock Analytics Dataset
const createMockAnalytics = () => ({
  writeDataPoint: vi.fn(),
});

describe('AISearchService', () => {
  let service: AISearchService;
  let mockAI: ReturnType<typeof createMockAI>;
  let mockVectorize: ReturnType<typeof createMockVectorize>;
  let mockDb: ReturnType<typeof createMockD1>;
  let mockAnalytics: ReturnType<typeof createMockAnalytics>;

  // Sample articles for testing
  const sampleArticles = [
    {
      id: 1,
      slug: 'article-1',
      headline: 'Zimbabwe Elections Update',
      description: 'Latest news on elections',
      publisher_name: 'The Herald',
      article_section_id: 'politics',
      date_published: '2024-01-15T10:00:00Z',
    },
    {
      id: 2,
      slug: 'article-2',
      headline: 'Economic Growth Report',
      description: 'Zimbabwe economy shows growth',
      publisher_name: 'Daily News',
      article_section_id: 'economy',
      date_published: '2024-01-14T10:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAI = createMockAI();
    mockVectorize = createMockVectorize();
    mockDb = createMockD1();
    mockAnalytics = createMockAnalytics();

    service = new AISearchService(
      mockAI as unknown as Ai,
      mockVectorize as unknown as VectorizeIndex,
      mockDb as unknown as D1Database,
      mockAnalytics as unknown as AnalyticsEngineDataset
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('semanticSearch', () => {
    it('should perform semantic search with embeddings', async () => {
      // Mock embedding generation
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });

      // Mock vector search results
      mockVectorize.query.mockResolvedValue({
        matches: [
          { id: '1', score: 0.95 },
          { id: '2', score: 0.85 },
        ],
      });

      // Mock database results
      mockDb._statement.all.mockResolvedValue({ results: sampleArticles });

      const results = await service.semanticSearch('Zimbabwe elections');

      expect(mockAI.run).toHaveBeenCalledWith(
        '@cf/baai/bge-m3',
        expect.objectContaining({ text: ['Zimbabwe elections'] })
      );
      expect(mockVectorize.query).toHaveBeenCalled();
      expect(results.length).toBeGreaterThan(0);
    });

    it('should sort results by score', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({
        matches: [
          { id: '2', score: 0.95 }, // Higher score
          { id: '1', score: 0.75 }, // Lower score
        ],
      });
      mockDb._statement.all.mockResolvedValue({ results: sampleArticles });

      const results = await service.semanticSearch('economy');

      // Results should be sorted by score (highest first)
      if (results.length >= 2) {
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      }
    });

    it('should fallback to keyword search when no vector results', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({ matches: [] });
      mockDb._statement.all.mockResolvedValue({ results: sampleArticles });

      const results = await service.semanticSearch('zimbabwe');

      // Should have called keyword search (check for LIKE pattern in SQL)
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('LIKE')
      );
    });

    it('should fallback to keyword search on error', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error'));
      mockDb._statement.all.mockResolvedValue({ results: sampleArticles });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const results = await service.semanticSearch('test query');

      expect(results).toBeDefined();
      consoleSpy.mockRestore();
    });

    it('should apply category filter', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({
        matches: [{ id: '1', score: 0.9 }],
      });
      mockDb._statement.all.mockResolvedValue({
        results: sampleArticles.filter(a => a.article_section_id === 'politics')
      });

      await service.semanticSearch('elections', { category: 'politics' });

      expect(mockDb._statement.bind).toHaveBeenCalled();
    });

    it('should apply date filters', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({
        matches: [{ id: '1', score: 0.9 }],
      });
      mockDb._statement.all.mockResolvedValue({ results: sampleArticles });

      await service.semanticSearch('news', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
      });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('date_published')
      );
    });

    it('should respect limit option', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({
        matches: [
          { id: '1', score: 0.9 },
          { id: '2', score: 0.8 },
        ],
      });
      mockDb._statement.all.mockResolvedValue({ results: sampleArticles });

      const results = await service.semanticSearch('test', { limit: 1 });

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should track search analytics', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({
        matches: [{ id: '1', score: 0.9 }],
      });
      mockDb._statement.all.mockResolvedValue({ results: sampleArticles });

      await service.semanticSearch('zimbabwe news');

      expect(mockAnalytics.writeDataPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          blobs: ['zimbabwe news'],
          indexes: ['search_query'],
        })
      );
    });
  });

  describe('keywordSearch', () => {
    it('should search using LIKE patterns', async () => {
      mockDb._statement.all.mockResolvedValue({ results: sampleArticles });

      const results = await service.keywordSearch('Zimbabwe');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('LIKE')
      );
      expect(results).toBeDefined();
    });

    it('should apply filters', async () => {
      mockDb._statement.all.mockResolvedValue({
        results: sampleArticles.filter(a => a.publisher_name === 'The Herald')
      });

      await service.keywordSearch('news', { source: 'The Herald' });

      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should return results with score 1.0', async () => {
      // Mock database to return articles with score
      mockDb._statement.all.mockResolvedValue({
        results: sampleArticles.map(a => ({ ...a, score: 1.0 }))
      });

      const results = await service.keywordSearch('test');

      results.forEach(result => {
        expect(result.score).toBe(1);
      });
    });
  });

  describe('generateInsights', () => {
    it('should generate summary insights', async () => {
      mockAI.run.mockResolvedValue({
        response: 'Zimbabwe sees positive economic growth according to recent reports.',
      });

      const insight = await service.generateInsights(
        'Economic growth in Zimbabwe',
        'summary'
      );

      expect(insight.type).toBe('summary');
      expect(insight.content).toContain('economic');
      expect(insight.confidence).toBe(0.85);
    });

    it('should generate trending insights', async () => {
      mockAI.run.mockResolvedValue({
        response: 'The main trending topic is the upcoming elections.',
      });

      const insight = await service.generateInsights(
        'Elections, Politics, Government',
        'trending'
      );

      expect(insight.type).toBe('trending');
      expect(insight.content).toBeDefined();
    });

    it('should generate related topic insights', async () => {
      mockAI.run.mockResolvedValue({
        response: '1. Economic policy 2. Trade relations 3. Investment',
      });

      const insight = await service.generateInsights(
        'Zimbabwe economy article',
        'related'
      );

      expect(insight.type).toBe('related');
    });

    it('should generate recommendation insights', async () => {
      mockAI.run.mockResolvedValue({
        response: 'Based on reading history, recommend political analysis articles.',
      });

      const insight = await service.generateInsights(
        'User read: politics, elections',
        'recommendation'
      );

      expect(insight.type).toBe('recommendation');
    });

    it('should handle AI errors gracefully', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const insight = await service.generateInsights('test', 'summary');

      expect(insight.confidence).toBe(0);
      expect(insight.content).toContain('unavailable');

      consoleSpy.mockRestore();
    });
  });

  describe('getTrendingTopics', () => {
    it('should return trending topics', async () => {
      mockDb._statement.all.mockResolvedValue({
        results: [
          { headline: 'Zimbabwe Elections Update' },
          { headline: 'Economic Growth Report' },
        ],
      });

      mockAI.run.mockResolvedValue({
        response: 'Elections\nEconomy\nPolitics',
      });

      const topics = await service.getTrendingTopics(5);

      expect(topics.length).toBeGreaterThan(0);
      expect(topics).toContain('Elections');
    });

    it('should limit topics to requested count', async () => {
      mockDb._statement.all.mockResolvedValue({
        results: [{ headline: 'Test' }],
      });

      mockAI.run.mockResolvedValue({
        response: 'Topic1\nTopic2\nTopic3\nTopic4\nTopic5\nTopic6',
      });

      const topics = await service.getTrendingTopics(3);

      expect(topics.length).toBeLessThanOrEqual(3);
    });

    it('should handle AI errors', async () => {
      mockDb._statement.all.mockResolvedValue({ results: [] });
      mockAI.run.mockRejectedValue(new Error('AI error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const topics = await service.getTrendingTopics();

      expect(topics).toEqual([]);

      consoleSpy.mockRestore();
    });

    it('should filter empty topics', async () => {
      mockDb._statement.all.mockResolvedValue({
        results: [{ headline: 'Test' }],
      });

      mockAI.run.mockResolvedValue({
        response: 'Topic1\n\n\nTopic2\n   \nTopic3',
      });

      const topics = await service.getTrendingTopics(5);

      topics.forEach(topic => {
        expect(topic.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe('indexArticle', () => {
    it('should index article in Vectorize', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.upsert.mockResolvedValue(undefined);

      const result = await service.indexArticle({
        id: 1,
        headline: 'Test Article',
        description: 'Test description',
        article_body: 'Full article content',
        article_section_id: 'politics',
        publisher_name: 'The Herald',
      });

      expect(result).toBe(true);
      expect(mockVectorize.upsert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: '1',
          metadata: {
            article_section_id: 'politics',
            publisher_name: 'The Herald',
          },
        }),
      ]);
    });

    it('should handle missing content', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.upsert.mockResolvedValue(undefined);

      const result = await service.indexArticle({
        id: 1,
        headline: 'Test Article',
        description: 'Test description',
        article_section_id: 'politics',
        publisher_name: 'The Herald',
      });

      expect(result).toBe(true);
    });

    it('should handle indexing errors', async () => {
      mockAI.run.mockRejectedValue(new Error('Embedding error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.indexArticle({
        id: 1,
        headline: 'Test',
        description: 'Test',
        article_section_id: 'test',
        publisher_name: 'test',
      });

      expect(result).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe('batchIndexArticles', () => {
    it('should index multiple articles', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.upsert.mockResolvedValue(undefined);

      const articles = [
        { id: 1, headline: 'Article 1', description: 'Desc 1', article_section_id: 'politics', publisher_name: 'Source 1' },
        { id: 2, headline: 'Article 2', description: 'Desc 2', article_section_id: 'economy', publisher_name: 'Source 2' },
      ];

      const result = await service.batchIndexArticles(articles);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('should handle partial failures', async () => {
      mockAI.run
        .mockResolvedValueOnce({ data: [[0.1, 0.2, 0.3]] })
        .mockRejectedValueOnce(new Error('AI error'));

      mockVectorize.upsert.mockResolvedValue(undefined);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const articles = [
        { id: 1, headline: 'Article 1', description: 'Desc 1', article_section_id: 'politics', publisher_name: 'Source 1' },
        { id: 2, headline: 'Article 2', description: 'Desc 2', article_section_id: 'economy', publisher_name: 'Source 2' },
      ];

      const result = await service.batchIndexArticles(articles);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);

      consoleSpy.mockRestore();
    });

    it('should process in batches of 10', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.upsert.mockResolvedValue(undefined);

      // Create 25 articles
      const articles = Array(25).fill(null).map((_, i) => ({
        id: i + 1,
        headline: `Article ${i + 1}`,
        description: `Desc ${i + 1}`,
        article_section_id: 'test',
        publisher_name: 'test',
      }));

      await service.batchIndexArticles(articles);

      // Should have processed 25 articles
      expect(mockVectorize.upsert).toHaveBeenCalledTimes(25);
    });

    it('should handle empty array', async () => {
      const result = await service.batchIndexArticles([]);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('service without analytics', () => {
    it('should work without analytics dataset', async () => {
      const serviceWithoutAnalytics = new AISearchService(
        mockAI as unknown as Ai,
        mockVectorize as unknown as VectorizeIndex,
        mockDb as unknown as D1Database
        // No analytics dataset
      );

      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({
        matches: [{ id: '1', score: 0.9 }],
      });
      mockDb._statement.all.mockResolvedValue({ results: sampleArticles });

      // Should not throw
      const results = await serviceWithoutAnalytics.semanticSearch('test');

      expect(results).toBeDefined();
    });
  });

  // ─── Security: SQL injection prevention ─────────────────────────────────
  describe('SQL injection prevention', () => {
    it('should use parameterized queries for search input', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error')); // Force keyword fallback
      mockDb._statement.all.mockResolvedValue({ results: [] });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // SQL injection attempt
      const maliciousQuery = "'; DROP TABLE articles; --";
      await service.semanticSearch(maliciousQuery);

      // Verify bind was called (parameterized query)
      expect(mockDb._statement.bind).toHaveBeenCalled();

      // Verify the malicious string is passed to bind, not concatenated into SQL
      const bindCalls = mockDb._statement.bind.mock.calls;
      const boundValues = bindCalls.flat();
      expect(boundValues.some((arg: unknown) => String(arg).includes(maliciousQuery))).toBe(true);

      // CRITICAL: Verify SQL string doesn't contain the malicious input directly
      const prepareCalls = mockDb.prepare.mock.calls;
      prepareCalls.forEach((call: unknown[]) => {
        const sql = call[0] as string;
        expect(sql).not.toContain("DROP TABLE");
        expect(sql).not.toContain("'; --");
        // SQL should use placeholders
        expect(sql).toMatch(/LIKE\s+\?|=\s*\?/);
      });

      consoleSpy.mockRestore();
    });

    it('should safely handle UNION-based SQL injection in category filter', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({ matches: [] });
      mockDb._statement.all.mockResolvedValue({ results: [] });

      // UNION injection attempt
      const maliciousCategory = "' UNION SELECT * FROM users --";
      await service.semanticSearch('test', { category: maliciousCategory });

      // Verify query uses parameterization
      expect(mockDb._statement.bind).toHaveBeenCalled();

      // Verify SQL string doesn't contain the injection
      const prepareCalls = mockDb.prepare.mock.calls;
      prepareCalls.forEach((call: unknown[]) => {
        expect(call[0]).not.toContain("UNION SELECT");
      });
    });

    it('should safely handle nested SQL in source filter', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({ matches: [] });
      mockDb._statement.all.mockResolvedValue({ results: [] });

      const maliciousSource = "source'; DELETE FROM articles WHERE '1'='1";
      await service.semanticSearch('test', { source: maliciousSource });

      expect(mockDb._statement.bind).toHaveBeenCalled();

      // Verify SQL doesn't contain the injection
      const prepareCalls = mockDb.prepare.mock.calls;
      prepareCalls.forEach((call: unknown[]) => {
        expect(call[0]).not.toContain("DELETE FROM");
      });
    });

    it('should handle boolean-based blind injection attempts', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({ matches: [] });
      mockDb._statement.all.mockResolvedValue({ results: [] });

      // Boolean blind injection
      const maliciousQuery = "test' AND 1=1 --";
      await service.semanticSearch(maliciousQuery);

      // Query should complete without error (parameterized)
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should handle time-based blind injection attempts', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({ matches: [] });
      mockDb._statement.all.mockResolvedValue({ results: [] });

      // Time-based blind injection (SQLite uses LIKE for delay simulation)
      const maliciousQuery = "test'; SELECT CASE WHEN (1=1) THEN sqlite_version() ELSE '' END--";
      await service.semanticSearch(maliciousQuery);

      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  // ─── Security: Prototype pollution prevention ───────────────────────────
  describe('prototype pollution prevention', () => {
    it('should safely handle __proto__ in search options', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({ matches: [] });
      mockDb._statement.all.mockResolvedValue({ results: [] });

      const maliciousOptions = JSON.parse('{"category": "test", "__proto__": {"polluted": true}}');
      await service.semanticSearch('test', maliciousOptions);

      // Verify Object prototype wasn't polluted
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('should safely handle constructor pollution attempts', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.query.mockResolvedValue({ matches: [] });
      mockDb._statement.all.mockResolvedValue({ results: [] });

      const maliciousOptions = {
        category: 'test',
        constructor: { prototype: { polluted: true } },
      };

      await service.semanticSearch('test', maliciousOptions as Parameters<typeof service.semanticSearch>[1]);

      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });
});
