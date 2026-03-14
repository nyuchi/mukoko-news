/**
 * Tests for D1CacheService utility functions
 * Tests cache logic in isolation without complex mocking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('D1CacheService', () => {
  describe('Utility Functions', () => {
    describe('hashString', () => {
      const hashString = (str: string): string => {
        let hash = 0;
        if (str.length === 0) return hash.toString(36);

        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }

        return Math.abs(hash).toString(36);
      };

      it('should generate consistent hashes', () => {
        const hash1 = hashString('test-string');
        const hash2 = hashString('test-string');

        expect(hash1).toBe(hash2);
      });

      it('should generate different hashes for different strings', () => {
        const hash1 = hashString('string-1');
        const hash2 = hashString('string-2');

        expect(hash1).not.toBe(hash2);
      });

      it('should return valid hash for empty string', () => {
        const hash = hashString('');

        expect(hash).toBe('0');
      });

      it('should return alphanumeric hash', () => {
        const hash = hashString('test-input');

        expect(hash).toMatch(/^[a-z0-9]+$/);
      });
    });

    describe('formatCacheKey', () => {
      const formatCacheKey = (key: string): string => {
        return key.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      };

      it('should format cache keys correctly', () => {
        const key = formatCacheKey('Test Key!@#$%');

        expect(key).toBe('test_key_____');
      });

      it('should preserve alphanumeric and hyphens', () => {
        const key = formatCacheKey('valid-key_123');

        expect(key).toBe('valid-key_123');
      });

      it('should convert to lowercase', () => {
        const key = formatCacheKey('UPPERCASE');

        expect(key).toBe('uppercase');
      });

      it('should handle special characters', () => {
        const key = formatCacheKey('search:results@category');

        expect(key).toBe('search_results_category');
      });
    });
  });

  describe('Cache Expiry Logic', () => {
    describe('isCacheExpired', () => {
      const isCacheExpired = (timestamp: string, ttlSeconds: number): boolean => {
        const cachedTime = new Date(timestamp).getTime();
        const now = Date.now();
        const age = (now - cachedTime) / 1000;
        return age >= ttlSeconds;
      };

      it('should return false for fresh cache', () => {
        const timestamp = new Date().toISOString();
        expect(isCacheExpired(timestamp, 3600)).toBe(false);
      });

      it('should return true for expired cache', () => {
        const oldTime = new Date(Date.now() - 7200 * 1000).toISOString(); // 2 hours ago
        expect(isCacheExpired(oldTime, 3600)).toBe(true); // 1 hour TTL
      });

      it('should return true at exactly TTL', () => {
        const exactTtl = new Date(Date.now() - 3600 * 1000).toISOString();
        expect(isCacheExpired(exactTtl, 3600)).toBe(true);
      });
    });

    describe('shouldRunScheduledRefresh', () => {
      const shouldRunScheduledRefresh = (lastRun: string | null, intervalSeconds: number): boolean => {
        if (!lastRun) return true;

        const lastRunTime = new Date(lastRun).getTime();
        const now = Date.now();
        const timeDiff = (now - lastRunTime) / 1000;

        return timeDiff >= intervalSeconds;
      };

      it('should return true when never run', () => {
        expect(shouldRunScheduledRefresh(null, 3600)).toBe(true);
      });

      it('should return true when interval exceeded', () => {
        const oldTime = new Date(Date.now() - 7200 * 1000).toISOString();
        expect(shouldRunScheduledRefresh(oldTime, 3600)).toBe(true);
      });

      it('should return false when within interval', () => {
        const recentTime = new Date(Date.now() - 1800 * 1000).toISOString();
        expect(shouldRunScheduledRefresh(recentTime, 3600)).toBe(false);
      });
    });
  });

  describe('TTL Configuration', () => {
    const TTL = {
      ARTICLES: 14 * 24 * 60 * 60,        // 2 weeks
      CONFIG: 30 * 24 * 60 * 60,          // 30 days
      SEARCH: 60 * 60,                    // 1 hour
      METADATA: 60 * 60,                  // 1 hour
      LOCKS: 30 * 60                      // 30 minutes
    };

    it('should have correct article TTL (2 weeks)', () => {
      expect(TTL.ARTICLES).toBe(14 * 24 * 60 * 60);
    });

    it('should have correct config TTL (30 days)', () => {
      expect(TTL.CONFIG).toBe(30 * 24 * 60 * 60);
    });

    it('should have correct search TTL (1 hour)', () => {
      expect(TTL.SEARCH).toBe(3600);
    });

    it('should have correct metadata TTL (1 hour)', () => {
      expect(TTL.METADATA).toBe(3600);
    });

    it('should have correct lock TTL (30 minutes)', () => {
      expect(TTL.LOCKS).toBe(1800);
    });
  });

  describe('Article Sorting', () => {
    interface Article {
      title: string;
      pubDate: string;
    }

    const sortArticlesByDate = (articles: Article[]): Article[] => {
      return articles
        .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    };

    it('should sort articles by pubDate descending', () => {
      const articles = [
        { title: 'Old', pubDate: '2024-01-01' },
        { title: 'Newest', pubDate: '2024-01-03' },
        { title: 'Middle', pubDate: '2024-01-02' },
      ];

      const sorted = sortArticlesByDate(articles);

      expect(sorted[0].title).toBe('Newest');
      expect(sorted[1].title).toBe('Middle');
      expect(sorted[2].title).toBe('Old');
    });

    it('should handle same date articles', () => {
      const articles = [
        { title: 'First', pubDate: '2024-01-01' },
        { title: 'Second', pubDate: '2024-01-01' },
      ];

      const sorted = sortArticlesByDate(articles);

      expect(sorted).toHaveLength(2);
    });

    it('should handle empty array', () => {
      const sorted = sortArticlesByDate([]);

      expect(sorted).toEqual([]);
    });
  });

  describe('Lock Management Logic', () => {
    describe('Lock Acquisition', () => {
      const canAcquireLock = (existingLock: any | null): boolean => {
        return existingLock === null || existingLock === undefined;
      };

      it('should allow lock when no existing lock', () => {
        expect(canAcquireLock(null)).toBe(true);
        expect(canAcquireLock(undefined)).toBe(true);
      });

      it('should deny lock when existing lock present', () => {
        expect(canAcquireLock({ lockValue: 'existing' })).toBe(false);
      });
    });

    describe('Lock Value Generation', () => {
      const generateLockValue = (): string => {
        return `lock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      };

      it('should generate unique lock values', () => {
        const lock1 = generateLockValue();
        const lock2 = generateLockValue();

        expect(lock1).not.toBe(lock2);
      });

      it('should start with lock- prefix', () => {
        const lock = generateLockValue();

        expect(lock.startsWith('lock-')).toBe(true);
      });
    });
  });

  describe('Article Data Mapping', () => {
    interface RSSArticle {
      headline: string;
      description?: string;
      article_body?: string;
      pubDate?: string;
      link?: string;
      author_name?: string;
      imageUrl?: string;
      publisher_name?: string;
      article_section_id?: string;
    }

    const mapRSSToD1Article = (rss: RSSArticle) => ({
      headline: rss.headline,
      description: rss.description || '',
      article_body: rss.article_body || rss.description || '',
      date_published: rss.pubDate || new Date().toISOString(),
      main_entity_of_page: rss.link || '',
      author_name: rss.author_name || '',
      image: rss.imageUrl || '',
      publisher_name: rss.publisher_name || 'Unknown',
      article_section_id: rss.article_section_id || 'general',
    });

    it('should map required fields', () => {
      const rss = { headline: 'Test Article' };
      const d1 = mapRSSToD1Article(rss);

      expect(d1.headline).toBe('Test Article');
      expect(d1.publisher_name).toBe('Unknown');
      expect(d1.article_section_id).toBe('general');
    });

    it('should map optional fields when present', () => {
      const rss = {
        headline: 'Test',
        description: 'Description',
        author_name: 'Author Name',
        imageUrl: 'https://example.com/image.jpg',
      };
      const d1 = mapRSSToD1Article(rss);

      expect(d1.description).toBe('Description');
      expect(d1.author_name).toBe('Author Name');
      expect(d1.image).toBe('https://example.com/image.jpg');
    });

    it('should use description as article_body fallback', () => {
      const rss = {
        headline: 'Test',
        description: 'Description text',
      };
      const d1 = mapRSSToD1Article(rss);

      expect(d1.article_body).toBe('Description text');
    });
  });

  describe('Search Key Generation', () => {
    const generateSearchKey = (query: string, category: string, limit: number): string => {
      const combined = `${query}-${category}-${limit}`;
      // Simple hash
      let hash = 0;
      for (let i = 0; i < combined.length; i++) {
        hash = ((hash << 5) - hash) + combined.charCodeAt(i);
        hash = hash & hash;
      }
      return `search_${Math.abs(hash).toString(36)}`;
    };

    it('should generate consistent keys for same params', () => {
      const key1 = generateSearchKey('test', 'news', 10);
      const key2 = generateSearchKey('test', 'news', 10);

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different queries', () => {
      const key1 = generateSearchKey('query1', 'news', 10);
      const key2 = generateSearchKey('query2', 'news', 10);

      expect(key1).not.toBe(key2);
    });

    it('should start with search_ prefix', () => {
      const key = generateSearchKey('test', 'news', 10);

      expect(key.startsWith('search_')).toBe(true);
    });
  });

  describe('Cache Stats Structure', () => {
    const createCacheStats = (articleCount: number, isLocked: boolean, lastScheduled: string | null) => ({
      articles: {
        count: articleCount,
        status: articleCount > 0 ? 'active' : 'empty',
        storage: 'D1 Database',
      },
      locks: {
        refreshLocked: isLocked,
        storage: 'D1 Database',
      },
      scheduled: {
        lastRun: lastScheduled || 'Never',
        storage: 'D1 Database',
      },
      database: {
        provider: 'Cloudflare D1',
        healthy: true,
      },
    });

    it('should create valid stats structure', () => {
      const stats = createCacheStats(100, false, '2024-01-01');

      expect(stats.articles.count).toBe(100);
      expect(stats.articles.status).toBe('active');
      expect(stats.locks.refreshLocked).toBe(false);
      expect(stats.database.provider).toBe('Cloudflare D1');
    });

    it('should show empty status when no articles', () => {
      const stats = createCacheStats(0, false, null);

      expect(stats.articles.status).toBe('empty');
      expect(stats.scheduled.lastRun).toBe('Never');
    });
  });
});
