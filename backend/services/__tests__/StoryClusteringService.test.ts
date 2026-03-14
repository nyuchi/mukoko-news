import { describe, it, expect } from 'vitest';
import {
  normalizeHeadline,
  titleSimilarity,
  clusterArticles,
  STOP_WORDS,
  type Article,
} from '../StoryClusteringService.js';

describe('StoryClusteringService', () => {
  describe('normalizeHeadline', () => {
    it('should convert title to lowercase', () => {
      const result = normalizeHeadline('BREAKING NEWS Alert');
      expect(result.every(word => word === word.toLowerCase())).toBe(true);
    });

    it('should remove punctuation', () => {
      const result = normalizeHeadline("Test: Title's with, punctuation!");
      expect(result.some(word => /[^\w]/.test(word))).toBe(false);
    });

    it('should split on whitespace', () => {
      const result = normalizeHeadline('word1   word2\tword3\nword4');
      expect(result).toContain('word1');
      expect(result).toContain('word2');
      expect(result).toContain('word3');
      expect(result).toContain('word4');
    });

    it('should filter out words with 3 or fewer characters', () => {
      const result = normalizeHeadline('The big red fox ran away');
      expect(result).not.toContain('the');
      expect(result).not.toContain('big');
      expect(result).not.toContain('red');
      expect(result).not.toContain('fox');
      expect(result).not.toContain('ran');
      expect(result).toContain('away');
    });

    it('should filter out stop words', () => {
      const result = normalizeHeadline('The president says this about that report');
      expect(result).not.toContain('says');
      expect(result).not.toContain('this');
      expect(result).not.toContain('about');
      expect(result).not.toContain('that');
      expect(result).not.toContain('report');
      expect(result).toContain('president');
    });

    it('should return empty array for empty string', () => {
      expect(normalizeHeadline('')).toEqual([]);
    });

    it('should return empty array for null/undefined input', () => {
      expect(normalizeHeadline(null as unknown as string)).toEqual([]);
      expect(normalizeHeadline(undefined as unknown as string)).toEqual([]);
    });

    it('should return empty array for non-string input', () => {
      expect(normalizeHeadline(123 as unknown as string)).toEqual([]);
      expect(normalizeHeadline({} as unknown as string)).toEqual([]);
    });

    it('should handle title with only stop words', () => {
      const result = normalizeHeadline('the and or but in on at to');
      expect(result).toEqual([]);
    });

    it('should handle title with only short words', () => {
      const result = normalizeHeadline('a an to by is as');
      expect(result).toEqual([]);
    });

    // DoS prevention tests
    it('should limit title length to 500 characters', () => {
      const longTitle = 'abcdefghij '.repeat(100); // 1100 chars
      const result = normalizeHeadline(longTitle);
      // Should process only first 500 chars worth of words
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('should limit word count to 50 words', () => {
      const manyWords = Array.from({ length: 100 }, (_, i) => `word${i}abcd`).join(' ');
      const result = normalizeHeadline(manyWords);
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('should handle extremely long single word', () => {
      const longWord = 'a'.repeat(1000);
      const result = normalizeHeadline(longWord);
      // Should be truncated but still processed
      expect(result.length).toBeLessThanOrEqual(1);
    });

    it('should extract meaningful words from real headline', () => {
      const result = normalizeHeadline('Zimbabwe announces new economic reforms for 2024');
      expect(result).toContain('zimbabwe');
      expect(result).toContain('announces');
      expect(result).toContain('economic');
      expect(result).toContain('reforms');
      expect(result).toContain('2024');
    });
  });

  describe('titleSimilarity', () => {
    it('should return 1 for identical word arrays', () => {
      const words = ['president', 'announces', 'policy'];
      expect(titleSimilarity(words, words)).toBe(1);
    });

    it('should return 0 for completely different word arrays', () => {
      const words1 = ['apple', 'banana', 'cherry'];
      const words2 = ['delta', 'echo', 'foxtrot'];
      expect(titleSimilarity(words1, words2)).toBe(0);
    });

    it('should return 0 for empty first array', () => {
      expect(titleSimilarity([], ['word'])).toBe(0);
    });

    it('should return 0 for empty second array', () => {
      expect(titleSimilarity(['word'], [])).toBe(0);
    });

    it('should return 0 for both empty arrays', () => {
      expect(titleSimilarity([], [])).toBe(0);
    });

    it('should calculate correct Jaccard similarity', () => {
      // Jaccard = intersection / union
      // intersection = {alpha, bravo} = 2
      // union = {alpha, bravo, charlie, delta} = 4
      // similarity = 2/4 = 0.5
      const words1 = ['alpha', 'bravo', 'charlie'];
      const words2 = ['alpha', 'bravo', 'delta'];
      expect(titleSimilarity(words1, words2)).toBe(0.5);
    });

    it('should handle partial overlap', () => {
      // intersection = {common} = 1
      // union = {common, unique1, unique2} = 3
      // similarity = 1/3 ≈ 0.333
      const words1 = ['common', 'unique1'];
      const words2 = ['common', 'unique2'];
      expect(titleSimilarity(words1, words2)).toBeCloseTo(1 / 3, 5);
    });

    it('should handle single word match', () => {
      const words1 = ['president'];
      const words2 = ['president'];
      expect(titleSimilarity(words1, words2)).toBe(1);
    });

    it('should be order independent', () => {
      const words1 = ['alpha', 'bravo', 'charlie'];
      const words2 = ['charlie', 'bravo', 'alpha'];
      expect(titleSimilarity(words1, words2)).toBe(1);
    });

    it('should handle duplicate words (sets)', () => {
      const words1 = ['word', 'word', 'word'];
      const words2 = ['word'];
      expect(titleSimilarity(words1, words2)).toBe(1);
    });

    it('should calculate similarity for news-like titles', () => {
      const title1Words = normalizeHeadline('Zimbabwe President Announces Economic Policy');
      const title2Words = normalizeHeadline('President of Zimbabwe Announces New Economic Policy');
      const similarity = titleSimilarity(title1Words, title2Words);
      expect(similarity).toBeGreaterThan(0.5);
    });
  });

  describe('clusterArticles', () => {
    const createArticle = (id: string, headline: string, publisher_name: string): Article => ({
      id,
      headline,
      publisher_name,
    });

    it('should return empty array for empty input', () => {
      expect(clusterArticles([])).toEqual([]);
    });

    it('should return empty array for null/undefined input', () => {
      expect(clusterArticles(null as unknown as Article[])).toEqual([]);
      expect(clusterArticles(undefined as unknown as Article[])).toEqual([]);
    });

    it('should create single cluster for single article', () => {
      const articles = [createArticle('1', 'Test Article Title', 'Source A')];
      const clusters = clusterArticles(articles);

      expect(clusters).toHaveLength(1);
      expect(clusters[0].primaryArticle.id).toBe('1');
      expect(clusters[0].relatedArticles).toHaveLength(0);
      expect(clusters[0].articleCount).toBe(1);
    });

    it('should cluster similar articles from different sources', () => {
      const articles = [
        createArticle('1', 'Zimbabwe announces major economic reforms', 'Herald'),
        createArticle('2', 'Major economic reforms announced in Zimbabwe', 'Chronicle'),
        createArticle('3', 'Sports team wins championship', 'Sports News'),
      ];

      const clusters = clusterArticles(articles);

      // First two should be clustered, third should be separate
      expect(clusters.length).toBeLessThanOrEqual(2);

      const economicCluster = clusters.find(c =>
        c.primaryArticle.headline.includes('economic')
      );
      expect(economicCluster).toBeDefined();
      expect(economicCluster!.articleCount).toBe(2);
    });

    it('should not cluster articles from the same source', () => {
      const articles = [
        createArticle('1', 'Zimbabwe announces major economic reforms', 'Herald'),
        createArticle('2', 'Zimbabwe announces major economic reforms update', 'Herald'),
      ];

      const clusters = clusterArticles(articles);

      // Same source articles should not be clustered together
      expect(clusters).toHaveLength(2);
      expect(clusters[0].relatedArticles).toHaveLength(0);
      expect(clusters[1].relatedArticles).toHaveLength(0);
    });

    it('should not cluster dissimilar articles', () => {
      const articles = [
        createArticle('1', 'Zimbabwe announces economic reforms', 'Herald'),
        createArticle('2', 'Football team wins championship game', 'Sports'),
        createArticle('3', 'New technology startup launches product', 'Tech News'),
      ];

      const clusters = clusterArticles(articles);

      // All articles should be in separate clusters
      expect(clusters).toHaveLength(3);
      clusters.forEach(cluster => {
        expect(cluster.relatedArticles).toHaveLength(0);
      });
    });

    it('should respect maxClusters configuration', () => {
      const articles = Array.from({ length: 20 }, (_, i) =>
        createArticle(`${i}`, `Unique article number ${i}`, `Source ${i}`)
      );

      const clusters = clusterArticles(articles, { maxClusters: 5 });

      expect(clusters.length).toBeLessThanOrEqual(5);
    });

    it('should respect maxRelatedPerCluster configuration', () => {
      // Create many similar articles from different sources
      const articles = Array.from({ length: 10 }, (_, i) =>
        createArticle(`${i}`, 'Zimbabwe announces major economic reforms', `Source ${i}`)
      );

      const clusters = clusterArticles(articles, { maxRelatedPerCluster: 2 });

      // First cluster should have at most 2 related articles
      expect(clusters[0].relatedArticles.length).toBeLessThanOrEqual(2);
    });

    it('should respect similarityThreshold configuration', () => {
      const articles = [
        createArticle('1', 'Zimbabwe announces economic policy', 'Herald'),
        createArticle('2', 'Zimbabwe economy policy announcement', 'Chronicle'),
      ];

      // With very high threshold, should not cluster
      const highThresholdClusters = clusterArticles(articles, { similarityThreshold: 0.95 });
      expect(highThresholdClusters).toHaveLength(2);

      // With very low threshold, should cluster
      const lowThresholdClusters = clusterArticles(articles, { similarityThreshold: 0.1 });
      expect(lowThresholdClusters).toHaveLength(1);
      expect(lowThresholdClusters[0].articleCount).toBe(2);
    });

    it('should generate correct cluster IDs', () => {
      const articles = [createArticle('abc123', 'Test Article', 'Source')];
      const clusters = clusterArticles(articles);

      expect(clusters[0].id).toBe('cluster-abc123');
    });

    it('should handle articles with empty titles', () => {
      const articles = [
        createArticle('1', '', 'Source A'),
        createArticle('2', 'Normal article title', 'Source B'),
      ];

      const clusters = clusterArticles(articles);

      // Should not throw and should process valid articles
      expect(clusters.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle mixed valid and invalid articles', () => {
      const articles = [
        createArticle('1', 'Valid article about Zimbabwe', 'Herald'),
        createArticle('2', '', 'Empty Title Source'),
        createArticle('3', 'the and or but', 'Stop Words Only'),
        createArticle('4', 'Another valid article about Zimbabwe', 'Chronicle'),
      ];

      const clusters = clusterArticles(articles);

      // Should handle gracefully
      expect(clusters.length).toBeGreaterThanOrEqual(1);
    });

    it('should cluster real-world similar headlines', () => {
      const articles = [
        createArticle('1', 'Breaking: Reserve Bank of Zimbabwe raises interest rates to combat inflation', 'Herald'),
        createArticle('2', 'Zimbabwe central bank increases interest rates amid inflation concerns', 'Chronicle'),
        createArticle('3', 'Interest rates hiked by Reserve Bank of Zimbabwe to fight rising inflation', 'NewsDay'),
        createArticle('4', 'Local football club wins league title', 'Sports Herald'),
      ];

      const clusters = clusterArticles(articles);

      // The three banking articles should cluster together
      const bankingCluster = clusters.find(c =>
        c.primaryArticle.headline.includes('interest') ||
        c.primaryArticle.headline.includes('Reserve Bank')
      );

      expect(bankingCluster).toBeDefined();
      expect(bankingCluster!.articleCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('STOP_WORDS', () => {
    it('should contain common English stop words', () => {
      expect(STOP_WORDS.has('the')).toBe(true);
      expect(STOP_WORDS.has('and')).toBe(true);
      expect(STOP_WORDS.has('or')).toBe(true);
      expect(STOP_WORDS.has('but')).toBe(true);
    });

    it('should contain news-specific stop words', () => {
      expect(STOP_WORDS.has('says')).toBe(true);
      expect(STOP_WORDS.has('said')).toBe(true);
      expect(STOP_WORDS.has('breaking')).toBe(true);
      expect(STOP_WORDS.has('report')).toBe(true);
      expect(STOP_WORDS.has('update')).toBe(true);
    });

    it('should not contain meaningful words', () => {
      expect(STOP_WORDS.has('president')).toBe(false);
      expect(STOP_WORDS.has('economy')).toBe(false);
      expect(STOP_WORDS.has('zimbabwe')).toBe(false);
      expect(STOP_WORDS.has('government')).toBe(false);
    });
  });
});
