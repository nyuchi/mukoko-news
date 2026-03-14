/**
 * Tests for CategoryManager
 * Tests user interest tracking, category performance analytics, trend detection, and content classification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CategoryManager } from '../CategoryManager';

// Mock D1Database
const createMockDb = () => {
  const mockFirst = vi.fn();
  const mockAll = vi.fn();
  const mockRun = vi.fn();

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: mockFirst,
      all: mockAll,
      run: mockRun,
    }),
    _mocks: { mockFirst, mockAll, mockRun },
  };
};

describe('CategoryManager', () => {
  let manager: CategoryManager;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    manager = new CategoryManager(mockDb as unknown as D1Database);
  });

  describe('User Interest Tracking', () => {
    describe('getUserInterests', () => {
      it('should return user interests with scores', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { user_id: 'user-1', category_id: 'politics', interest_score: 50, view_count: 10 },
            { user_id: 'user-1', category_id: 'sports', interest_score: 30, view_count: 5 },
          ],
        });

        const interests = await manager.getUserInterests('user-1');

        expect(interests).toHaveLength(2);
        expect(interests[0].category_id).toBe('politics');
        expect(interests[0].interest_score).toBe(50);
      });

      it('should return empty array when no interests', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({ results: [] });

        const interests = await manager.getUserInterests('user-1');

        expect(interests).toEqual([]);
      });

      it('should return empty array on error', async () => {
        mockDb._mocks.mockAll.mockRejectedValue(new Error('DB error'));

        const interests = await manager.getUserInterests('user-1');

        expect(interests).toEqual([]);
      });
    });

    describe('updateInterestScore', () => {
      it('should update interest score for view interaction', async () => {
        mockDb._mocks.mockFirst.mockResolvedValue({ id: 'politics' }); // Category exists
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });

        await manager.updateInterestScore('user-1', 'politics', 10, 'view');

        expect(mockDb.prepare).toHaveBeenCalled();
        expect(mockDb._mocks.mockRun).toHaveBeenCalled();
      });

      it('should update interest score for engagement interaction', async () => {
        mockDb._mocks.mockFirst.mockResolvedValue({ id: 'politics' });
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });

        await manager.updateInterestScore('user-1', 'politics', 20, 'engagement');

        expect(mockDb._mocks.mockRun).toHaveBeenCalled();
      });

      it('should not update for non-existent category', async () => {
        mockDb._mocks.mockFirst.mockResolvedValue(null); // Category doesn't exist

        await manager.updateInterestScore('user-1', 'fake-category', 10, 'view');

        // Should not call run for insert
        expect(mockDb._mocks.mockRun).not.toHaveBeenCalled();
      });

      it('should handle errors gracefully', async () => {
        mockDb._mocks.mockFirst.mockRejectedValue(new Error('DB error'));

        // Should not throw
        await expect(
          manager.updateInterestScore('user-1', 'politics', 10, 'view')
        ).resolves.toBeUndefined();
      });
    });

    describe('getPersonalizedCategories', () => {
      it('should return top categories for user', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { category_id: 'politics', interest_score: 100 },
            { category_id: 'sports', interest_score: 80 },
            { category_id: 'tech', interest_score: 60 },
          ],
        });

        const categories = await manager.getPersonalizedCategories('user-1', 3);

        expect(categories).toEqual(['politics', 'sports', 'tech']);
      });

      it('should respect limit parameter', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [{ category_id: 'politics', interest_score: 100 }],
        });

        await manager.getPersonalizedCategories('user-1', 5);

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining('LIMIT ?')
        );
      });

      it('should return empty array on error', async () => {
        mockDb._mocks.mockAll.mockRejectedValue(new Error('DB error'));

        const categories = await manager.getPersonalizedCategories('user-1');

        expect(categories).toEqual([]);
      });
    });
  });

  describe('Category Performance Analytics', () => {
    describe('trackCategoryPerformance', () => {
      it('should insert or update performance metrics', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });

        await manager.trackCategoryPerformance('politics', {
          article_count: 10,
          total_views: 500,
          total_engagements: 50,
          unique_readers: 200,
          avg_read_time: 180,
          bounce_rate: 0.3,
        });

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO category_performance')
        );
      });

      it('should use current date when not specified', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });

        await manager.trackCategoryPerformance('politics', {
          article_count: 10,
        });

        expect(mockDb._mocks.mockRun).toHaveBeenCalled();
      });

      it('should handle errors gracefully', async () => {
        mockDb._mocks.mockRun.mockRejectedValue(new Error('DB error'));

        await expect(
          manager.trackCategoryPerformance('politics', { article_count: 10 })
        ).resolves.toBeUndefined();
      });
    });

    describe('getCategoryAnalytics', () => {
      it('should return analytics for specific category', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { category_id: 'politics', date: '2024-01-01', total_views: 100 },
            { category_id: 'politics', date: '2024-01-02', total_views: 150 },
          ],
        });

        const analytics = await manager.getCategoryAnalytics('politics', 7);

        expect(analytics).toHaveLength(2);
        expect(analytics[0].category_id).toBe('politics');
      });

      it('should return analytics for all categories when no id specified', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { category_id: 'politics', total_engagements: 100 },
            { category_id: 'sports', total_engagements: 80 },
          ],
        });

        const analytics = await manager.getCategoryAnalytics(undefined, 7);

        expect(analytics).toHaveLength(2);
      });

      it('should return empty array on error', async () => {
        mockDb._mocks.mockAll.mockRejectedValue(new Error('DB error'));

        const analytics = await manager.getCategoryAnalytics('politics');

        expect(analytics).toEqual([]);
      });
    });
  });

  describe('Trend Detection', () => {
    describe('getCategoryTrends', () => {
      it('should detect upward trends', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            {
              category_id: 'politics',
              category_name: 'Politics',
              current_engagement: 100,
              previous_engagement: 50,
              growth_rate: 100,
            },
          ],
        });

        const trends = await manager.getCategoryTrends(7);

        expect(trends[0].trend_direction).toBe('up');
        expect(trends[0].growth_rate).toBe(100);
      });

      it('should detect downward trends', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            {
              category_id: 'sports',
              category_name: 'Sports',
              current_engagement: 50,
              previous_engagement: 100,
              growth_rate: -50,
            },
          ],
        });

        const trends = await manager.getCategoryTrends(7);

        expect(trends[0].trend_direction).toBe('down');
      });

      it('should detect stable trends', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            {
              category_id: 'tech',
              category_name: 'Technology',
              current_engagement: 100,
              previous_engagement: 98,
              growth_rate: 2,
            },
          ],
        });

        const trends = await manager.getCategoryTrends(7);

        expect(trends[0].trend_direction).toBe('stable');
      });

      it('should return empty array on error', async () => {
        mockDb._mocks.mockAll.mockRejectedValue(new Error('DB error'));

        const trends = await manager.getCategoryTrends(7);

        expect(trends).toEqual([]);
      });
    });

    describe('getTrendingCategories', () => {
      it('should return upward trending categories', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { category_id: 'politics', category_name: 'Politics', growth_rate: 50 },
            { category_id: 'tech', category_name: 'Technology', growth_rate: 30 },
          ],
        });

        const trending = await manager.getTrendingCategories(5);

        expect(trending).toHaveLength(2);
        expect(trending[0].article_section_id).toBe('politics');
      });

      it('should fallback to article counts when no engagement data', async () => {
        // First call for trends returns nothing
        mockDb._mocks.mockAll
          .mockResolvedValueOnce({ results: [] })
          .mockResolvedValueOnce({
            results: [
              { category_id: 'politics', category_name: 'Politics', article_count: 50, recent_articles: 10 },
            ],
          });

        const trending = await manager.getTrendingCategories(5);

        expect(trending).toHaveLength(1);
      });
    });
  });

  describe('Content Classification', () => {
    describe('classifyContent', () => {
      it('should classify content based on keywords', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { id: 'politics', name: 'Politics', keywords: '["government","parliament","minister"]' },
            { id: 'sports', name: 'Sports', keywords: '["football","cricket","tennis"]' },
          ],
        });

        const category = await manager.classifyContent(
          'Government announces new policy in parliament',
          'Minister speaks about reforms'
        );

        expect(category).toBe('politics');
      });

      it('should return general when no keywords match', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { id: 'politics', name: 'Politics', keywords: '["government"]' },
          ],
        });

        const category = await manager.classifyContent(
          'Random article about nothing',
          'No relevant keywords here'
        );

        expect(category).toBe('general');
      });

      it('should handle comma-separated keywords for backward compatibility', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { id: 'tech', name: 'Technology', keywords: 'tech, software, innovation' },
          ],
        });

        const category = await manager.classifyContent(
          'New software innovation announced',
          ''
        );

        expect(category).toBe('tech');
      });

      it('should weight longer keywords higher', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { id: 'economy', name: 'Economy', keywords: '["economy","inflation","monetary"]' },
            { id: 'tech', name: 'Technology', keywords: '["ai"]' },
          ],
        });

        // "economy" (7 chars) should score higher than "ai" (2 chars)
        const category = await manager.classifyContent(
          'Economy and AI trends',
          ''
        );

        expect(category).toBe('economy');
      });

      it('should return general on error', async () => {
        mockDb._mocks.mockAll.mockRejectedValue(new Error('DB error'));

        const category = await manager.classifyContent('Test title', 'Test desc');

        expect(category).toBe('general');
      });
    });
  });

  describe('User Segmentation', () => {
    describe('getUserSegments', () => {
      it('should return user segments', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { segment_name: 'Heavy Users', user_count: 100, category_id: 'politics', category_name: 'Politics', avg_engagement: 50 },
            { segment_name: 'Heavy Users', user_count: 100, category_id: 'sports', category_name: 'Sports', avg_engagement: 30 },
            { segment_name: 'Casual Users', user_count: 500, category_id: 'news', category_name: 'News', avg_engagement: 5 },
          ],
        });

        const segments = await manager.getUserSegments();

        expect(segments).toHaveLength(2); // Heavy Users and Casual Users
        expect(segments.find(s => s.segment_name === 'Heavy Users')).toBeDefined();
      });

      it('should limit top categories to 5 per segment', async () => {
        mockDb._mocks.mockAll.mockResolvedValue({
          results: Array(10).fill(null).map((_, i) => ({
            segment_name: 'Heavy Users',
            user_count: 100,
            category_id: `cat-${i}`,
            category_name: `Category ${i}`,
            avg_engagement: 50 - i,
          })),
        });

        const segments = await manager.getUserSegments();

        expect(segments[0].top_categories).toHaveLength(5);
      });

      it('should return empty array on error', async () => {
        mockDb._mocks.mockAll.mockRejectedValue(new Error('DB error'));

        const segments = await manager.getUserSegments();

        expect(segments).toEqual([]);
      });
    });
  });

  describe('Insights and Reporting', () => {
    describe('generateInsights', () => {
      it('should generate comprehensive insights', async () => {
        // Mock summary query
        mockDb._mocks.mockFirst.mockResolvedValue({
          total_categories: 10,
          active_categories: 8,
          total_engagements: 1000,
        });

        // Mock other queries
        mockDb._mocks.mockAll.mockResolvedValue({ results: [] });

        const insights = await manager.generateInsights(30);

        expect(insights.summary.total_categories).toBe(10);
        expect(insights.summary.active_categories).toBe(8);
        expect(insights.summary.total_engagements).toBe(1000);
      });

      it('should calculate average engagement per category', async () => {
        mockDb._mocks.mockFirst.mockResolvedValue({
          total_categories: 10,
          active_categories: 5,
          total_engagements: 500,
        });
        mockDb._mocks.mockAll.mockResolvedValue({ results: [] });

        const insights = await manager.generateInsights(30);

        expect(insights.summary.avg_engagement_per_category).toBe(100);
      });

      it('should handle zero active categories', async () => {
        mockDb._mocks.mockFirst.mockResolvedValue({
          total_categories: 10,
          active_categories: 0,
          total_engagements: 0,
        });
        mockDb._mocks.mockAll.mockResolvedValue({ results: [] });

        const insights = await manager.generateInsights(30);

        expect(insights.summary.avg_engagement_per_category).toBe(0);
      });

      it('should return empty insights on error', async () => {
        mockDb._mocks.mockFirst.mockRejectedValue(new Error('DB error'));

        const insights = await manager.generateInsights(30);

        expect(insights.summary.total_categories).toBe(0);
        expect(insights.recommendations).toEqual([]);
      });
    });
  });

  describe('Utility Methods', () => {
    describe('batchUpdatePerformance', () => {
      it('should update multiple performance records', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });

        const data = [
          { category_id: 'politics', date: '2024-01-01', article_count: 10, total_views: 100, total_engagements: 50, unique_readers: 40, avg_read_time: 120, bounce_rate: 0.3 },
          { category_id: 'sports', date: '2024-01-01', article_count: 5, total_views: 80, total_engagements: 30, unique_readers: 25, avg_read_time: 90, bounce_rate: 0.4 },
        ];

        await manager.batchUpdatePerformance(data);

        expect(mockDb._mocks.mockRun).toHaveBeenCalledTimes(2);
      });
    });

    describe('cleanupOldData', () => {
      it('should delete old performance and interest data', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });

        await manager.cleanupOldData(90);

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM category_performance')
        );
        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM user_category_interests')
        );
      });
    });
  });
});
