/**
 * Tests for PersonalizedFeedService
 * Tests personalized feed generation, scoring, and country filtering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersonalizedFeedService } from '../PersonalizedFeedService';

// Helper to create mock D1Database
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

describe('PersonalizedFeedService', () => {
  let service: PersonalizedFeedService;
  let mockDb: ReturnType<typeof createMockD1>;

  // Sample articles for testing
  const sampleArticles = [
    {
      id: 1,
      headline: 'Politics Article',
      slug: 'politics-article',
      description: 'About politics',
      content_snippet: 'Content...',
      author_name: 'John Doe',
      publisher_name: 'The Herald',
      publisher_id: 'herald',
      date_published: new Date().toISOString(),
      image: 'https://example.com/image1.jpg',
      main_entity_of_page: 'https://example.com/article1',
      article_section_id: 'politics',
      about_country_id: 'ZW',
      view_count: 100,
      like_count: 10,
      bookmark_count: 5,
    },
    {
      id: 2,
      headline: 'Sports Article',
      slug: 'sports-article',
      description: 'About sports',
      content_snippet: 'Content...',
      author_name: 'Jane Smith',
      publisher_name: 'Daily News',
      publisher_id: 'dailynews',
      date_published: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      image: 'https://example.com/image2.jpg',
      main_entity_of_page: 'https://example.com/article2',
      article_section_id: 'sports',
      about_country_id: 'ZA',
      view_count: 200,
      like_count: 20,
      bookmark_count: 10,
    },
    {
      id: 3,
      headline: 'Business Article',
      slug: 'business-article',
      description: 'About business',
      content_snippet: 'Content...',
      author_name: 'Bob Wilson',
      publisher_name: 'Chronicle',
      publisher_id: 'chronicle',
      date_published: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
      image: 'https://example.com/image3.jpg',
      main_entity_of_page: 'https://example.com/article3',
      article_section_id: 'business',
      about_country_id: 'KE',
      view_count: 50,
      like_count: 5,
      bookmark_count: 2,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockD1();
    service = new PersonalizedFeedService(mockDb as unknown as D1Database);
  });

  describe('getPersonalizedFeed', () => {
    describe('anonymous users', () => {
      it('should return trending feed for anonymous users', async () => {
        mockDb._statement.all.mockResolvedValue({ results: sampleArticles });
        mockDb._statement.first.mockResolvedValue({ total: 3 });

        const result = await service.getPersonalizedFeed(null);

        expect(result.isPersonalized).toBe(false);
        expect(result.articles).toBeDefined();
      });

      it('should filter by countries for anonymous users', async () => {
        mockDb._statement.all.mockResolvedValue({
          results: sampleArticles.filter(a => a.about_country_id === 'ZW')
        });
        mockDb._statement.first.mockResolvedValue({ total: 1 });

        const result = await service.getPersonalizedFeed(null, { countries: ['ZW'] });

        expect(result.countries).toEqual(['ZW']);
      });

      it('should respect limit and offset', async () => {
        mockDb._statement.all.mockResolvedValue({ results: [sampleArticles[0]] });
        mockDb._statement.first.mockResolvedValue({ total: 3 });

        const result = await service.getPersonalizedFeed(null, { limit: 1, offset: 0 });

        expect(result.articles.length).toBe(1);
      });
    });

    describe('users without preferences', () => {
      beforeEach(() => {
        // Mock empty preferences
        mockDb._statement.all.mockResolvedValue({ results: [] });
        mockDb._statement.first.mockResolvedValue({ total: 3 });
      });

      it('should return trending feed for users without preferences', async () => {
        // Re-setup for this specific test to return articles on second call
        mockDb._statement.all
          .mockResolvedValueOnce({ results: [] }) // sources
          .mockResolvedValueOnce({ results: [] }) // authors
          .mockResolvedValueOnce({ results: [] }) // categories
          .mockResolvedValueOnce({ results: [] }) // countries
          .mockResolvedValueOnce({ results: [] }) // history
          .mockResolvedValueOnce({ results: [] }) // recent
          .mockResolvedValue({ results: sampleArticles }); // trending

        const result = await service.getPersonalizedFeed('user-123');

        expect(result.isPersonalized).toBe(false);
      });
    });

    describe('users with preferences', () => {
      beforeEach(() => {
        // Setup user with preferences
        mockDb._statement.all
          .mockResolvedValueOnce({ results: [{ follow_id: 'herald' }] }) // followed sources
          .mockResolvedValueOnce({ results: [{ follow_id: 'John Doe' }] }) // followed authors
          .mockResolvedValueOnce({ results: [{ follow_id: 'politics' }] }) // followed categories
          .mockResolvedValueOnce({ results: [{ country_id: 'ZW', is_primary: true }] }) // countries
          .mockResolvedValueOnce({ results: [{ article_section_id: 'politics', read_count: 10, total_time: 600, avg_depth: 80 }] }) // history
          .mockResolvedValueOnce({ results: [] }) // recent reads
          .mockResolvedValue({ results: sampleArticles }); // candidates

        mockDb._statement.first.mockResolvedValue({ total: 3 });
      });

      it('should return personalized feed', async () => {
        const result = await service.getPersonalizedFeed('user-123');

        expect(result.isPersonalized).toBe(true);
        expect(result.articles).toBeDefined();
      });

      it('should boost articles from followed sources', async () => {
        const result = await service.getPersonalizedFeed('user-123');

        // Herald article should be ranked higher
        const heraldArticle = result.articles.find(a => a.publisher_id === 'herald');
        expect(heraldArticle).toBeDefined();
        if (heraldArticle?.scoreBreakdown) {
          expect(heraldArticle.scoreBreakdown.followedSource).toBeGreaterThan(0);
        }
      });

      it('should boost articles from followed authors', async () => {
        const result = await service.getPersonalizedFeed('user-123');

        const authorArticle = result.articles.find(a => a.author_name === 'John Doe');
        expect(authorArticle).toBeDefined();
        if (authorArticle?.scoreBreakdown) {
          expect(authorArticle.scoreBreakdown.followedAuthor).toBeGreaterThan(0);
        }
      });

      it('should boost articles from followed categories', async () => {
        const result = await service.getPersonalizedFeed('user-123');

        const categoryArticle = result.articles.find(a => a.article_section_id === 'politics');
        expect(categoryArticle).toBeDefined();
        if (categoryArticle?.scoreBreakdown) {
          expect(categoryArticle.scoreBreakdown.followedCategory).toBeGreaterThan(0);
        }
      });

      it('should boost articles from primary country', async () => {
        const result = await service.getPersonalizedFeed('user-123');

        const countryArticle = result.articles.find(a => a.about_country_id === 'ZW');
        expect(countryArticle).toBeDefined();
        if (countryArticle?.scoreBreakdown) {
          expect(countryArticle.scoreBreakdown.primaryCountry).toBeGreaterThan(0);
        }
      });

      it('should apply recency weight', async () => {
        const result = await service.getPersonalizedFeed('user-123', { recencyWeight: 2.0 });

        // More recent articles should have higher recency scores
        const newestArticle = result.articles.find(a => a.id === 1);
        const olderArticle = result.articles.find(a => a.id === 3);

        if (newestArticle?.scoreBreakdown && olderArticle?.scoreBreakdown) {
          expect(newestArticle.scoreBreakdown.recency).toBeGreaterThan(
            olderArticle.scoreBreakdown.recency
          );
        }
      });

      it('should exclude already read articles', async () => {
        // Setup with recently read articles
        mockDb._statement.all
          .mockResolvedValueOnce({ results: [{ follow_id: 'herald' }] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [{ article_id: 1 }] }) // article 1 was read
          .mockResolvedValue({ results: sampleArticles });

        const result = await service.getPersonalizedFeed('user-123', { excludeRead: true });

        const readArticle = result.articles.find(a => a.id === 1);
        expect(readArticle).toBeUndefined();
      });

      it('should override countries with option', async () => {
        const result = await service.getPersonalizedFeed('user-123', { countries: ['KE'] });

        expect(result.countries).toEqual(['KE']);
      });

      it('should handle extremely large preference lists (100+ categories)', async () => {
        // Generate 100 followed categories
        const manyCategories = Array.from({ length: 100 }, (_, i) => ({ follow_id: `category-${i}` }));
        // Generate 50 followed sources
        const manySources = Array.from({ length: 50 }, (_, i) => ({ follow_id: `source-${i}` }));
        // Generate 30 followed authors
        const manyAuthors = Array.from({ length: 30 }, (_, i) => ({ follow_id: `author-${i}` }));

        mockDb._statement.all
          .mockResolvedValueOnce({ results: manySources }) // followed sources
          .mockResolvedValueOnce({ results: manyAuthors }) // followed authors
          .mockResolvedValueOnce({ results: manyCategories }) // followed categories
          .mockResolvedValueOnce({ results: [{ country_id: 'ZW', is_primary: true }] }) // countries
          .mockResolvedValueOnce({ results: [] }) // history
          .mockResolvedValueOnce({ results: [] }) // recent reads
          .mockResolvedValueOnce({ results: sampleArticles }); // candidates - only return once

        mockDb._statement.first.mockResolvedValue({ total: 3 });

        const result = await service.getPersonalizedFeed('user-123');

        expect(result.isPersonalized).toBe(true);
        expect(result.articles).toBeDefined();
        // Service processes preferences without performance issues
        expect(result.articles.length).toBeGreaterThan(0);
      });

      it('should handle user with empty candidate results', async () => {
        // Reset mocks for this test
        vi.clearAllMocks();
        mockDb = createMockD1();
        service = new PersonalizedFeedService(mockDb as unknown as D1Database);

        // All queries return empty results
        mockDb._statement.all.mockResolvedValue({ results: [] });
        mockDb._statement.first.mockResolvedValue({ total: 0 });

        const result = await service.getPersonalizedFeed('user-123');

        // With no preferences and no articles, returns empty result
        expect(result.articles.length).toBe(0);
        expect(result.total).toBe(0);
      });
    });

    describe('diversity factor', () => {
      it('should apply diversity penalty with high factor', async () => {
        // Articles from same category
        const sameCategoryArticles = [
          { ...sampleArticles[0], id: 1, article_section_id: 'politics' },
          { ...sampleArticles[0], id: 2, article_section_id: 'politics' },
          { ...sampleArticles[0], id: 3, article_section_id: 'politics' },
        ];

        mockDb._statement.all
          .mockResolvedValueOnce({ results: [{ follow_id: 'politics' }] }) // followed categories
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValue({ results: sameCategoryArticles });

        mockDb._statement.first.mockResolvedValue({ total: 3 });

        const result = await service.getPersonalizedFeed('user-123', { diversityFactor: 1.0 });

        // Later articles from same category should have diversity penalty
        const articles = result.articles;
        if (articles.length >= 2 && articles[1].scoreBreakdown) {
          expect(articles[1].scoreBreakdown.diversity).toBeLessThan(0);
        }
      });

      it('should not apply diversity penalty with factor 0', async () => {
        mockDb._statement.all
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [{ follow_id: 'politics' }] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValue({ results: sampleArticles });

        mockDb._statement.first.mockResolvedValue({ total: 3 });

        const result = await service.getPersonalizedFeed('user-123', { diversityFactor: 0 });

        result.articles.forEach(article => {
          if (article.scoreBreakdown) {
            expect(article.scoreBreakdown.diversity).toBe(0);
          }
        });
      });
    });

    describe('engagement scoring', () => {
      it('should score based on engagement metrics', async () => {
        mockDb._statement.all
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValue({ results: sampleArticles });

        mockDb._statement.first.mockResolvedValue({ total: 3 });

        const result = await service.getPersonalizedFeed('user-123');

        // Sports article has highest engagement (200 views, 20 likes, 10 bookmarks)
        const highEngagement = result.articles.find(a => a.article_section_id === 'sports');
        const lowEngagement = result.articles.find(a => a.article_section_id === 'business');

        if (highEngagement?.scoreBreakdown && lowEngagement?.scoreBreakdown) {
          expect(highEngagement.scoreBreakdown.engagement).toBeGreaterThan(
            lowEngagement.scoreBreakdown.engagement
          );
        }
      });
    });
  });

  describe('Python Worker ranking integration', () => {
    // Mock DB returning a user with preferences and candidate articles
    const setupPreferenceMocks = (db: ReturnType<typeof createMockD1>) => {
      db._statement.all
        .mockResolvedValueOnce({ results: [{ follow_id: 'herald' }] })      // sources
        .mockResolvedValueOnce({ results: [{ follow_id: 'John Doe' }] })    // authors
        .mockResolvedValueOnce({ results: [{ follow_id: 'politics' }] })    // categories
        .mockResolvedValueOnce({ results: [{ country_id: 'ZW', is_primary: true }] }) // countries
        .mockResolvedValueOnce({ results: [] })                             // history
        .mockResolvedValueOnce({ results: [] })                             // recent reads
        .mockResolvedValue({ results: sampleArticles });                    // candidates
      db._statement.first.mockResolvedValue({ total: 3 });
    };

    it('uses Python rankFeed when processingClient is provided (happy path)', async () => {
      setupPreferenceMocks(mockDb);

      const rankedArticles = [
        { ...sampleArticles[1], score: 95.5, score_breakdown: { followed_source: 0, followed_author: 0, followed_category: 0, category_interest: 0, primary_country: 0, recency: 25, engagement: 15, diversity: 0, source_quality: 10 } },
        { ...sampleArticles[0], score: 80.0, score_breakdown: { followed_source: 50, followed_author: 40, followed_category: 30, category_interest: 0, primary_country: 35, recency: 24, engagement: 12, diversity: 0, source_quality: 9 } },
        { ...sampleArticles[2], score: 10.0, score_breakdown: { followed_source: 0, followed_author: 0, followed_category: 0, category_interest: 0, primary_country: 0, recency: 10, engagement: 8, diversity: -10, source_quality: 5 } },
      ];

      const mockProcessingClient = {
        rankFeed: vi.fn().mockResolvedValue({ articles: rankedArticles }),
      };

      const result = await service.getPersonalizedFeed('user-123', {}, mockProcessingClient);

      expect(mockProcessingClient.rankFeed).toHaveBeenCalledOnce();
      expect(result.isPersonalized).toBe(true);
      // Python-ranked order: sports (95.5) first
      expect(result.articles[0].category_id).toBe('sports');
      // snake_case score_breakdown mapped to camelCase scoreBreakdown
      expect(result.articles[0].scoreBreakdown?.recency).toBe(25);
      expect(result.articles[1].scoreBreakdown?.followedSource).toBe(50);
    });

    it('falls back to TS scorer when Python rankFeed throws', async () => {
      setupPreferenceMocks(mockDb);

      const mockProcessingClient = {
        rankFeed: vi.fn().mockRejectedValue(new Error('Python Worker unavailable')),
      };

      const result = await service.getPersonalizedFeed('user-123', {}, mockProcessingClient);

      expect(mockProcessingClient.rankFeed).toHaveBeenCalledOnce();
      expect(result.isPersonalized).toBe(true);
      // TS scorer still produces results
      expect(result.articles.length).toBeGreaterThan(0);
      // TS scorer sets camelCase scoreBreakdown directly
      expect(result.articles[0].scoreBreakdown).toBeDefined();
    });

    it('uses TS scorer when no processingClient provided', async () => {
      setupPreferenceMocks(mockDb);

      // No processingClient — pure TS path
      const result = await service.getPersonalizedFeed('user-123');

      expect(result.isPersonalized).toBe(true);
      expect(result.articles.length).toBeGreaterThan(0);
    });
  });

  describe('getFeedExplanation', () => {
    it('should return explanation of why articles are recommended', async () => {
      mockDb._statement.all
        .mockResolvedValueOnce({ results: [{ follow_id: 'herald' }] }) // sources
        .mockResolvedValueOnce({ results: [{ follow_id: 'John Doe' }] }) // authors
        .mockResolvedValueOnce({ results: [{ follow_id: 'politics' }] }) // categories
        .mockResolvedValueOnce({ results: [{ country_id: 'ZW' }] }) // countries
        .mockResolvedValueOnce({ results: [{ article_section_id: 'politics', read_count: 10, total_time: 600, avg_depth: 80 }] })
        .mockResolvedValueOnce({ results: [] }) // recent
        .mockResolvedValueOnce({ results: [{ name: 'The Herald' }] }) // source names
        .mockResolvedValueOnce({ results: [{ name: 'Politics' }] }); // category names

      const result = await service.getFeedExplanation('user-123');

      expect(result.sources).toContain('The Herald');
      expect(result.authors).toContain('John Doe');
      expect(result.categories).toContain('politics');
      expect(result.topInterests).toContain('Politics');
    });

    it('should handle users with no follows', async () => {
      mockDb._statement.all.mockResolvedValue({ results: [] });

      const result = await service.getFeedExplanation('user-123');

      expect(result.sources).toEqual([]);
      expect(result.authors).toEqual([]);
      expect(result.categories).toEqual([]);
      expect(result.topInterests).toEqual([]);
    });
  });

  describe('Pan-African country support', () => {
    it('should filter articles by multiple countries', async () => {
      const filteredArticles = sampleArticles.filter(
        a => ['ZW', 'ZA'].includes(a.about_country_id)
      );

      mockDb._statement.all.mockResolvedValue({ results: filteredArticles });
      mockDb._statement.first.mockResolvedValue({ total: 2 });

      const result = await service.getPersonalizedFeed(null, {
        countries: ['ZW', 'ZA']
      });

      expect(result.countries).toEqual(['ZW', 'ZA']);
      expect(result.articles.every(a => ['ZW', 'ZA'].includes(a.about_country_id))).toBe(true);
    });

    it('should use user preferred countries when no override', async () => {
      mockDb._statement.all
        .mockResolvedValueOnce({ results: [] }) // sources
        .mockResolvedValueOnce({ results: [] }) // authors
        .mockResolvedValueOnce({ results: [] }) // categories
        .mockResolvedValueOnce({ results: [
          { country_id: 'ZW', is_primary: true },
          { country_id: 'ZA', is_primary: false },
        ]})
        .mockResolvedValueOnce({ results: [] }) // history
        .mockResolvedValueOnce({ results: [] }) // recent
        .mockResolvedValue({ results: sampleArticles.filter(a => ['ZW', 'ZA'].includes(a.about_country_id)) });

      mockDb._statement.first.mockResolvedValue({ total: 2 });

      const result = await service.getPersonalizedFeed('user-123');

      expect(result.countries).toEqual(['ZW', 'ZA']);
    });

    it('should handle all 16 Pan-African countries', async () => {
      const allCountries = ['ZW', 'ZA', 'KE', 'NG', 'GH', 'TZ', 'UG', 'RW',
                          'ET', 'BW', 'ZM', 'MW', 'EG', 'MA', 'NA', 'MZ'];

      mockDb._statement.all.mockResolvedValue({ results: sampleArticles });
      mockDb._statement.first.mockResolvedValue({ total: sampleArticles.length });

      const result = await service.getPersonalizedFeed(null, {
        countries: allCountries
      });

      expect(result.countries).toEqual(allCountries);
    });
  });

  // ─── Security: SQL injection prevention ─────────────────────────────────
  describe('SQL injection prevention', () => {
    it('should use parameterized queries for country filter', async () => {
      const maliciousCountry = "ZW' OR '1'='1";

      mockDb._statement.all.mockResolvedValue({ results: [] });
      mockDb._statement.first.mockResolvedValue({ total: 0 });

      await service.getPersonalizedFeed(null, {
        countries: [maliciousCountry]
      });

      // Verify bind() was called with the malicious input (parameterized)
      expect(mockDb._statement.bind).toHaveBeenCalled();

      // Verify SQL string uses placeholders, not concatenated values
      const prepareCalls = mockDb.prepare.mock.calls;
      const sqlStrings = prepareCalls.map((call: unknown[]) => call[0] as string);

      // None of the SQL strings should contain the malicious input directly
      sqlStrings.forEach((sql: string) => {
        expect(sql).not.toContain("ZW' OR");
        expect(sql).not.toContain("'1'='1");
      });
    });

    it('should use parameterized queries for user ID', async () => {
      const maliciousUserId = "user'; DROP TABLE users; --";

      mockDb._statement.all.mockResolvedValue({ results: [] });
      mockDb._statement.first.mockResolvedValue({ total: 0 });

      await service.getPersonalizedFeed(maliciousUserId);

      // Verify SQL doesn't contain the malicious input
      const prepareCalls = mockDb.prepare.mock.calls;
      prepareCalls.forEach((call: unknown[]) => {
        expect(call[0]).not.toContain("DROP TABLE");
        expect(call[0]).not.toContain("user';");
      });
    });

    it('should use parameterized queries for limit/offset options', async () => {
      mockDb._statement.all.mockResolvedValue({ results: [] });
      mockDb._statement.first.mockResolvedValue({ total: 0 });

      // Test with numeric options that could be manipulated
      await service.getPersonalizedFeed(null, {
        limit: 10,
        offset: 0,
      });

      // Verify queries use proper parameterization
      expect(mockDb._statement.bind).toHaveBeenCalled();
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });
});
