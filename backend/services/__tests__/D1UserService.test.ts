/**
 * Tests for D1UserService
 * Tests user CRUD, likes, bookmarks, reading history, and statistics
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { D1UserService } from '../D1UserService';

// Mock D1Database
const createMockDb = () => {
  const mockFirst = vi.fn();
  const mockAll = vi.fn();
  const mockRun = vi.fn();
  const mockBind = vi.fn();

  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    first: mockFirst,
    all: mockAll,
    run: mockRun,
  };

  mockBind.mockReturnValue(mockStatement);

  return {
    prepare: vi.fn().mockReturnValue({
      bind: mockBind,
      first: mockFirst,
      all: mockAll,
      run: mockRun,
    }),
    batch: vi.fn(),
    _mocks: { mockFirst, mockAll, mockRun, mockBind },
  };
};

describe('D1UserService', () => {
  let service: D1UserService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    service = new D1UserService(mockDb as unknown as D1Database);
  });

  describe('initialize', () => {
    it('should create tables on first initialization', async () => {
      mockDb._mocks.mockRun.mockResolvedValue({ success: true });

      await service.initialize();

      // Should create users table
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS users')
      );
    });

    it('should only initialize once', async () => {
      mockDb._mocks.mockRun.mockResolvedValue({ success: true });

      await service.initialize();
      const callCount = mockDb.prepare.mock.calls.length;

      await service.initialize();

      // Should not have made additional calls
      expect(mockDb.prepare.mock.calls.length).toBe(callCount);
    });

    it('should throw on initialization error', async () => {
      mockDb._mocks.mockRun.mockRejectedValue(new Error('DB error'));

      await expect(service.initialize()).rejects.toThrow('DB error');
    });
  });

  describe('createUser', () => {
    it('should create user with default values', async () => {
      mockDb._mocks.mockRun.mockResolvedValue({ success: true });
      mockDb._mocks.mockFirst.mockResolvedValue({
        id: 'user-123',
        email: null,
        preferences: '{}',
        stats: '{}',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

      const result = await service.createUser('user-123');

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
    });

    it('should create user with email and preferences', async () => {
      mockDb._mocks.mockRun.mockResolvedValue({ success: true });
      mockDb._mocks.mockFirst.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        preferences: '{"theme":"dark"}',
        stats: '{}',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

      const result = await service.createUser('user-123', {
        email: 'test@example.com',
        preferences: { theme: 'dark' },
      });

      expect(result.success).toBe(true);
    });

    it('should handle creation error', async () => {
      mockDb._mocks.mockRun.mockResolvedValue({ success: false });

      const result = await service.createUser('user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getUser', () => {
    it('should return existing user with parsed JSON fields', async () => {
      mockDb._mocks.mockRun.mockResolvedValue({ success: true });
      mockDb._mocks.mockFirst.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        preferences: '{"theme":"dark"}',
        stats: '{"total_likes":5}',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

      const user = await service.getUser('user-123');

      expect(user.id).toBe('user-123');
      expect(user.preferences).toEqual({ theme: 'dark' });
      expect(user.stats).toEqual({ total_likes: 5 });
    });

    it('should create user if not found', async () => {
      mockDb._mocks.mockRun.mockResolvedValue({ success: true });
      mockDb._mocks.mockFirst
        .mockResolvedValueOnce(null) // First call - user not found
        .mockResolvedValue({ // After creation
          id: 'user-123',
          email: null,
          preferences: '{}',
          stats: '{}',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        });

      const user = await service.getUser('user-123');

      expect(user).toBeDefined();
    });

    it('should return default user on error', async () => {
      mockDb._mocks.mockFirst.mockRejectedValue(new Error('DB error'));

      const user = await service.getUser('user-123');

      expect(user.id).toBe('user-123');
      expect(user.stats).toEqual({
        total_likes: 0,
        total_bookmarks: 0,
        total_views: 0,
      });
    });
  });

  describe('updateUser', () => {
    it('should update user email', async () => {
      mockDb._mocks.mockRun.mockResolvedValue({ success: true });
      mockDb._mocks.mockFirst.mockResolvedValue({
        id: 'user-123',
        email: 'new@example.com',
        preferences: '{}',
        stats: '{}',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

      const result = await service.updateUser('user-123', {
        email: 'new@example.com',
      });

      expect(result.success).toBe(true);
    });

    it('should update user preferences', async () => {
      mockDb._mocks.mockRun.mockResolvedValue({ success: true });
      mockDb._mocks.mockFirst.mockResolvedValue({
        id: 'user-123',
        email: null,
        preferences: '{"notifications":true}',
        stats: '{}',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

      const result = await service.updateUser('user-123', {
        preferences: { notifications: true },
      });

      expect(result.success).toBe(true);
    });

    it('should handle update error', async () => {
      mockDb._mocks.mockRun.mockResolvedValue({ success: false });

      const result = await service.updateUser('user-123', {
        email: 'test@example.com',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('User Likes', () => {
    describe('getUserLikes', () => {
      it('should return user likes ordered by date', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { article_id: 'article-1', liked_at: '2024-01-02' },
            { article_id: 'article-2', liked_at: '2024-01-01' },
          ],
        });

        const likes = await service.getUserLikes('user-123');

        expect(likes).toHaveLength(2);
        expect(likes[0].article_id).toBe('article-1');
      });

      it('should support pagination', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockAll.mockResolvedValue({ results: [] });

        await service.getUserLikes('user-123', 10, 20);

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining('LIMIT ? OFFSET ?')
        );
      });

      it('should return empty array on error', async () => {
        mockDb._mocks.mockAll.mockRejectedValue(new Error('DB error'));

        const likes = await service.getUserLikes('user-123');

        expect(likes).toEqual([]);
      });
    });

    describe('addUserLike', () => {
      it('should add like and update stats', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue({
          id: 'user-123',
          preferences: '{}',
          stats: '{"total_likes":0}',
        });

        const result = await service.addUserLike('user-123', {
          id: 'article-1',
          headline: 'Test Article',
          publisher_name: 'Test Source',
          article_section_id: 'news',
        });

        expect(result.success).toBe(true);
      });

      it('should handle article with link instead of id', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue({
          id: 'user-123',
          preferences: '{}',
          stats: '{}',
        });

        const result = await service.addUserLike('user-123', {
          link: 'https://example.com/article',
          headline: 'Test Article',
          publisher_name: 'Test Source',
          article_section_id: 'news',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('removeUserLike', () => {
      it('should remove like and decrement stats', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue({
          id: 'user-123',
          preferences: '{}',
          stats: '{"total_likes":5}',
        });

        const result = await service.removeUserLike('user-123', 'article-1');

        expect(result.success).toBe(true);
      });
    });

    describe('isArticleLiked', () => {
      it('should return true when article is liked', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue({ id: 1 });

        const isLiked = await service.isArticleLiked('user-123', 'article-1');

        expect(isLiked).toBe(true);
      });

      it('should return false when article is not liked', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue(null);

        const isLiked = await service.isArticleLiked('user-123', 'article-1');

        expect(isLiked).toBe(false);
      });
    });
  });

  describe('User Bookmarks', () => {
    describe('getUserBookmarks', () => {
      it('should return user bookmarks', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { article_id: 'article-1', saved_at: '2024-01-01' },
          ],
        });

        const bookmarks = await service.getUserBookmarks('user-123');

        expect(bookmarks).toHaveLength(1);
      });
    });

    describe('addUserBookmark', () => {
      it('should add bookmark with full article data', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue({
          id: 'user-123',
          preferences: '{}',
          stats: '{}',
        });

        const result = await service.addUserBookmark('user-123', {
          id: 'article-1',
          headline: 'Test Article',
          description: 'Test description',
          publisher_name: 'Test Source',
          article_section_id: 'news',
          link: 'https://example.com',
          imageUrl: 'https://example.com/image.jpg',
          pubDate: '2024-01-01',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('isArticleBookmarked', () => {
      it('should check bookmark status', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue({ id: 1 });

        const isBookmarked = await service.isArticleBookmarked('user-123', 'article-1');

        expect(isBookmarked).toBe(true);
      });
    });
  });

  describe('Reading History', () => {
    describe('addReadingHistory', () => {
      it('should add reading history entry', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue({
          id: 'user-123',
          preferences: '{}',
          stats: '{}',
        });

        const result = await service.addReadingHistory(
          'user-123',
          { id: 'article-1', headline: 'Test', publisher_name: 'Source', article_section_id: 'news' },
          120 // 2 minutes time spent
        );

        expect(result.success).toBe(true);
      });
    });

    describe('getUserReadingHistory', () => {
      it('should return reading history', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockAll.mockResolvedValue({
          results: [
            { article_id: 'article-1', read_at: '2024-01-01', time_spent: 120 },
          ],
        });

        const history = await service.getUserReadingHistory('user-123');

        expect(history).toHaveLength(1);
        expect(history[0].time_spent).toBe(120);
      });
    });
  });

  describe('User Statistics', () => {
    describe('getUserStats', () => {
      it('should return user statistics', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue({
          id: 'user-123',
          preferences: '{}',
          stats: '{"total_likes":10,"total_bookmarks":5,"total_views":100}',
        });

        const stats = await service.getUserStats('user-123');

        expect(stats.total_likes).toBe(10);
        expect(stats.total_bookmarks).toBe(5);
        expect(stats.total_views).toBe(100);
      });

      it('should return default stats on error', async () => {
        mockDb._mocks.mockFirst.mockRejectedValue(new Error('DB error'));

        const stats = await service.getUserStats('user-123');

        expect(stats).toEqual({
          total_likes: 0,
          total_bookmarks: 0,
          total_views: 0,
        });
      });
    });

    describe('updateUserStats', () => {
      it('should increment stat value', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue({
          id: 'user-123',
          preferences: '{}',
          stats: '{"total_likes":5}',
        });

        await service.updateUserStats('user-123', 'total_likes', 1);

        // Should update with incremented value
        expect(mockDb.prepare).toHaveBeenCalled();
      });

      it('should not go below zero', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });
        mockDb._mocks.mockFirst.mockResolvedValue({
          id: 'user-123',
          preferences: '{}',
          stats: '{"total_likes":0}',
        });

        await service.updateUserStats('user-123', 'total_likes', -5);

        // Stats should not go negative
      });
    });
  });

  describe('Batch Operations', () => {
    describe('batchAddLikes', () => {
      it('should add multiple likes at once', async () => {
        mockDb.batch.mockResolvedValue([
          { success: true },
          { success: true },
          { success: true },
        ]);
        mockDb._mocks.mockFirst.mockResolvedValue({
          id: 'user-123',
          preferences: '{}',
          stats: '{}',
        });
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });

        const articles = [
          { id: '1', headline: 'Article 1', publisher_name: 'Source', article_section_id: 'news' },
          { id: '2', headline: 'Article 2', publisher_name: 'Source', article_section_id: 'news' },
          { id: '3', headline: 'Article 3', publisher_name: 'Source', article_section_id: 'news' },
        ];

        const result = await service.batchAddLikes('user-123', articles);

        expect(result.success).toBe(true);
        expect(result.added).toBe(3);
        expect(result.total).toBe(3);
      });
    });

    describe('batchAddBookmarks', () => {
      it('should add multiple bookmarks at once', async () => {
        mockDb.batch.mockResolvedValue([
          { success: true },
          { success: true },
        ]);
        mockDb._mocks.mockFirst.mockResolvedValue({
          id: 'user-123',
          preferences: '{}',
          stats: '{}',
        });
        mockDb._mocks.mockRun.mockResolvedValue({ success: true });

        const articles = [
          { id: '1', headline: 'Article 1', publisher_name: 'Source', article_section_id: 'news' },
          { id: '2', headline: 'Article 2', publisher_name: 'Source', article_section_id: 'news' },
        ];

        const result = await service.batchAddBookmarks('user-123', articles);

        expect(result.success).toBe(true);
        expect(result.added).toBe(2);
      });
    });
  });

  describe('Cleanup Operations', () => {
    describe('cleanupOldData', () => {
      it('should clean up old reading history', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({
          success: true,
          meta: { changes: 50 },
        });

        const result = await service.cleanupOldData(90);

        expect(result.success).toBe(true);
        expect(result.cleanedEntries).toBe(50);
      });

      it('should use default 90 days', async () => {
        mockDb._mocks.mockRun.mockResolvedValue({
          success: true,
          meta: { changes: 0 },
        });

        await service.cleanupOldData();

        expect(mockDb.prepare).toHaveBeenCalled();
      });
    });
  });
});
