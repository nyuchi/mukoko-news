import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentModerationService } from '../../platform/ContentModerationService.js';
import { createMockD1, createMockAI } from '../helpers.js';

describe('ContentModerationService', () => {
  let service: ContentModerationService;
  let db: ReturnType<typeof createMockD1>['db'];
  let statement: ReturnType<typeof createMockD1>['statement'];
  let ai: ReturnType<typeof createMockAI>;

  beforeEach(() => {
    ({ db, statement } = createMockD1());
    ai = createMockAI();
    service = new ContentModerationService(
      ai as unknown as Ai,
      db as unknown as D1Database,
      { enableAIModeration: false } // Pattern-only for deterministic tests
    );
  });

  describe('Pattern Detection', () => {
    it('should detect clickbait patterns', async () => {
      const result = await service.moderateArticle({
        id: '1',
        title: 'YOU WON\'T BELIEVE what they don\'t want you to know',
        content: 'Some content here about a topic',
        source_url: 'https://example.com/article',
        source_name: 'Test Source',
      });

      expect(result.flags.length).toBeGreaterThan(0);
      const misleadingFlags = result.flags.filter(f => f.type === 'misleading');
      expect(misleadingFlags.length).toBeGreaterThan(0);
    });

    it('should detect harmful stereotypes', async () => {
      const result = await service.moderateArticle({
        id: '2',
        title: 'Report on development',
        content: 'The dark continent faces many challenges in a third world environment',
        source_url: 'https://example.com/article2',
        source_name: 'Test Source',
      });

      const stereotypeFlags = result.flags.filter(f => f.type === 'stereotype');
      expect(stereotypeFlags.length).toBeGreaterThan(0);
      expect(stereotypeFlags[0].severity).toBe('high');
    });

    it('should detect hate speech', async () => {
      const result = await service.moderateArticle({
        id: '3',
        title: 'Breaking news',
        content: 'We must exterminate those we disagree with',
        source_url: 'https://example.com/article3',
        source_name: 'Test Source',
      });

      const hateFlags = result.flags.filter(f => f.type === 'hate_speech');
      expect(hateFlags.length).toBeGreaterThan(0);
      expect(hateFlags[0].severity).toBe('critical');
    });

    it('should flag excessive capitalization', async () => {
      const result = await service.moderateArticle({
        id: '4',
        title: 'BREAKING SHOCKING NEWS FROM AFRICA TODAY!!!',
        content: 'Normal content about a normal event',
        source_url: 'https://example.com/article4',
        source_name: 'Test Source',
      });

      const capsFlags = result.flags.filter(f =>
        f.type === 'misleading' && f.description.includes('capitalization')
      );
      expect(capsFlags.length).toBe(1);
    });

    it('should not flag legitimate news', async () => {
      const result = await service.moderateArticle({
        id: '5',
        title: 'Zimbabwe economy shows growth in Q3',
        content: 'According to the Ministry of Finance, Zimbabwe GDP grew by 3.2% in Q3, said the finance minister.',
        source_url: 'https://example.com/article5',
        source_name: 'The Herald',
      });

      const criticalFlags = result.flags.filter(f => f.severity === 'critical' || f.severity === 'high');
      expect(criticalFlags.length).toBe(0);
    });
  });

  describe('Source Reputation', () => {
    it('should flag blocked domains', async () => {
      service.updateConfig({ blockedDomains: ['fake-news.com'] });

      const result = await service.moderateArticle({
        id: '6',
        title: 'Some article',
        content: 'Content',
        source_url: 'https://fake-news.com/article',
        source_name: 'Fake News',
      });

      const fakeFlags = result.flags.filter(f => f.type === 'fake_news');
      expect(fakeFlags.length).toBe(1);
      expect(fakeFlags[0].severity).toBe('critical');
    });

    it('should flag invalid URLs', async () => {
      const result = await service.moderateArticle({
        id: '7',
        title: 'Some article',
        content: 'Content',
        source_url: 'not-a-valid-url',
        source_name: 'Unknown',
      });

      const unverifiedFlags = result.flags.filter(f => f.type === 'unverified');
      expect(unverifiedFlags.length).toBeGreaterThan(0);
    });
  });

  describe('Recommendations', () => {
    it('should reject articles with critical flags', async () => {
      const result = await service.moderateArticle({
        id: '8',
        title: 'Kill all those people we disagree with',
        content: 'Exterminate them all',
        source_url: 'https://example.com/article',
        source_name: 'Test',
      });

      expect(result.recommendation).toBe('reject');
    });

    it('should approve clean articles with high score', async () => {
      const result = await service.moderateArticle({
        id: '9',
        title: 'Zimbabwe hosts African Union summit',
        content: 'According to government officials, Zimbabwe successfully hosted the AU summit. The event was reported by multiple international news agencies.',
        source_url: 'https://herald.co.zw/article',
        source_name: 'The Herald',
      });

      // Without AI, pattern-only score should be reasonable
      expect(['approve', 'review']).toContain(result.recommendation);
    });
  });

  describe('Scoring', () => {
    it('should return score between 0 and 100', async () => {
      const result = await service.moderateArticle({
        id: '10',
        title: 'Test article',
        content: 'Test content',
        source_url: 'https://example.com',
        source_name: 'Test',
      });

      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });

    it('should include processing metadata', async () => {
      const result = await service.moderateArticle({
        id: '11',
        title: 'Test',
        content: 'Test content',
        source_url: 'https://example.com',
        source_name: 'Test',
      });

      expect(result.articleId).toBe('11');
      expect(result.processedAt).toBeTruthy();
      expect(result.model).toBe('pattern-only');
    });
  });

  describe('Batch Moderation', () => {
    it('should moderate multiple articles', async () => {
      const articles = [
        { id: 'a', title: 'Article A', content: 'Content A', source_url: 'https://a.com', source_name: 'A' },
        { id: 'b', title: 'Article B', content: 'Content B', source_url: 'https://b.com', source_name: 'B' },
        { id: 'c', title: 'Article C', content: 'Content C', source_url: 'https://c.com', source_name: 'C' },
      ];

      const results = await service.moderateBatch(articles);
      expect(results).toHaveLength(3);
      expect(results[0].articleId).toBe('a');
      expect(results[1].articleId).toBe('b');
      expect(results[2].articleId).toBe('c');
    });
  });

  describe('Config Updates', () => {
    it('should update moderation config', () => {
      service.updateConfig({ autoApproveThreshold: 90 });
      // No error means success
    });

    it('should update domain lists', async () => {
      await service.updateDomainList('blocked', 'add', 'spam.com');
      await service.updateDomainList('trusted', 'add', 'reuters.com');
      // Verify blocked domain is flagged
      const result = await service.moderateArticle({
        id: '12',
        title: 'Test',
        content: 'Content',
        source_url: 'https://spam.com/article',
        source_name: 'Spam',
      });
      const fakeFlags = result.flags.filter(f => f.type === 'fake_news');
      expect(fakeFlags.length).toBe(1);
    });
  });
});
