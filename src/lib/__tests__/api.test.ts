/**
 * Tests for API client
 * Tests fetch wrapper, authentication, error handling, and API methods
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../api';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default successful response
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchAPI', () => {
    it('should make GET request with correct headers', async () => {
      await api.health();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/health'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should throw on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(api.health()).rejects.toThrow('API error: 404 Not Found');
    });

    it('should throw timeout error when request is aborted', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(api.health()).rejects.toThrow('Request timeout');
    });

    it('should throw network error with context', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

      await expect(api.health()).rejects.toThrow('Network error: Failed to fetch');
    });

    it('should throw on 429 rate limit response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      await expect(api.health()).rejects.toThrow('API error: 429 Too Many Requests');
    });

    it('should throw on 500 server error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(api.health()).rejects.toThrow('API error: 500 Internal Server Error');
    });

    it('should throw on 503 service unavailable response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      await expect(api.health()).rejects.toThrow('API error: 503 Service Unavailable');
    });
  });

  describe('getArticles', () => {
    it('should fetch articles without params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ articles: [] }),
      });

      await api.getArticles();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/feeds'),
        expect.any(Object)
      );
    });

    it('should include limit and page params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ articles: [] }),
      });

      await api.getArticles({ limit: 10, page: 2 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=10.*page=2|page=2.*limit=10/),
        expect.any(Object)
      );
    });

    it('should include category filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ articles: [] }),
      });

      await api.getArticles({ category: 'politics' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('category=politics'),
        expect.any(Object)
      );
    });

    it('should include countries filter as comma-separated', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ articles: [] }),
      });

      await api.getArticles({ countries: ['ZW', 'ZA'] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('countries=ZW%2CZA'),
        expect.any(Object)
      );
    });

    it('should include sort parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ articles: [] }),
      });

      await api.getArticles({ sort: 'trending' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=trending'),
        expect.any(Object)
      );
    });
  });

  describe('getSectionedFeed', () => {
    it('should fetch sectioned feed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          topStories: [],
          yourNews: [],
          byCategory: [],
          latest: [],
        }),
      });

      await api.getSectionedFeed();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/feeds/sectioned'),
        expect.any(Object)
      );
    });

    it('should include countries filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          topStories: [],
          yourNews: [],
          byCategory: [],
          latest: [],
        }),
      });

      await api.getSectionedFeed({ countries: ['ZW', 'KE'] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('countries=ZW%2CKE'),
        expect.any(Object)
      );
    });

    it('should include categories filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          topStories: [],
          yourNews: [],
          byCategory: [],
          latest: [],
        }),
      });

      await api.getSectionedFeed({ categories: ['politics', 'sports'] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('categories=politics%2Csports'),
        expect.any(Object)
      );
    });
  });

  describe('getArticle', () => {
    it('should fetch single article by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          article: { id: '123', headline: 'Test' },
        }),
      });

      const result = await api.getArticle('123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/article/123'),
        expect.any(Object)
      );
      expect(result.article.id).toBe('123');
    });
  });

  describe('getCategories', () => {
    it('should fetch categories', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          categories: [
            { id: '1', name: 'Politics', slug: 'politics' },
          ],
        }),
      });

      const result = await api.getCategories();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/categories'),
        expect.any(Object)
      );
      expect(result.categories).toHaveLength(1);
    });
  });

  describe('getNewsBytes', () => {
    it('should fetch news bytes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ articles: [] }),
      });

      await api.getNewsBytes({ limit: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/news-bytes.*limit=20/),
        expect.any(Object)
      );
    });
  });

  describe('search', () => {
    it('should search with query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ articles: [] }),
      });

      await api.search('zimbabwe elections');

      // URLSearchParams encodes spaces as + by default
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/q=zimbabwe(\+|%20)elections/),
        expect.any(Object)
      );
    });

    it('should include limit parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ articles: [] }),
      });

      await api.search('test', { limit: 5 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=5'),
        expect.any(Object)
      );
    });
  });

  describe('User Engagement APIs', () => {
    describe('likeArticle', () => {
      it('should POST to like endpoint', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, liked: true }),
        });

        const result = await api.likeArticle('123');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/articles/123/like'),
          expect.objectContaining({ method: 'POST' })
        );
        expect(result.liked).toBe(true);
      });
    });

    describe('saveArticle', () => {
      it('should POST to save endpoint', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, saved: true }),
        });

        const result = await api.saveArticle('123');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/articles/123/save'),
          expect.objectContaining({ method: 'POST' })
        );
        expect(result.saved).toBe(true);
      });
    });

    describe('trackView', () => {
      it('should POST view with metrics', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, views: 100 }),
        });

        await api.trackView('123', { readingTime: 60, scrollDepth: 80 });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/articles/123/view'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"reading_time":60'),
          })
        );
      });

      it('should use default values when no metrics provided', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, views: 1 }),
        });

        await api.trackView('123');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/articles/123/view'),
          expect.objectContaining({
            body: expect.stringContaining('"reading_time":0'),
          })
        );
      });
    });

    describe('getSavedArticles', () => {
      it('should fetch user bookmarks', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ articles: [], total: 0 }),
        });

        await api.getSavedArticles();

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/user/bookmarks'),
          expect.any(Object)
        );
      });
    });

    describe('getArticleEngagement', () => {
      it('should fetch engagement counts', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            likes: 10,
            saves: 5,
            shares: 3,
            views: 100,
          }),
        });

        const result = await api.getArticleEngagement('123');

        expect(result.likes).toBe(10);
        expect(result.views).toBe(100);
      });
    });
  });

  describe('Stats and Trending APIs', () => {
    describe('getStats', () => {
      it('should fetch database stats', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            database: {
              total_articles: 1000,
              active_sources: 20,
              categories: 12,
            },
          }),
        });

        const result = await api.getStats();

        expect(result.database.total_articles).toBe(1000);
      });
    });

    describe('getTrendingCategories', () => {
      it('should fetch trending categories with limit', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            trending: [],
          }),
        });

        await api.getTrendingCategories(5);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('limit=5'),
          expect.any(Object)
        );
      });
    });

    describe('getKeywords', () => {
      it('should fetch keywords for tag cloud', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            keywords: [],
            total: 0,
          }),
        });

        await api.getKeywords(32);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/keywords?limit=32'),
          expect.any(Object)
        );
      });
    });
  });

  describe('AI Search', () => {
    describe('searchWithAI', () => {
      it('should search with AI by default', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: [],
            query: 'test',
            count: 0,
            searchMethod: 'semantic',
          }),
        });

        await api.searchWithAI('test query');

        // URLSearchParams encodes spaces as + by default
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringMatching(/q=test(\+|%20)query/),
          expect.any(Object)
        );
      });

      it('should disable AI search when specified', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: [],
            searchMethod: 'keyword',
          }),
        });

        await api.searchWithAI('test', { useAI: false });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('ai=false'),
          expect.any(Object)
        );
      });

      it('should include category filter', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ results: [] }),
        });

        await api.searchWithAI('test', { category: 'politics' });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('category=politics'),
          expect.any(Object)
        );
      });
    });
  });

  describe('Related Content', () => {
    describe('getRelatedArticles', () => {
      it('should fetch related articles', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ related: [] }),
        });

        await api.getRelatedArticles('123', 5);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/article/123/related?limit=5'),
          expect.any(Object)
        );
      });
    });
  });
});
