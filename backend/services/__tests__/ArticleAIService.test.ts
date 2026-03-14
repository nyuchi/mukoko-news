/**
 * Tests for ArticleAIService
 * Tests content cleaning, keyword extraction, quality scoring, and AI processing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ArticleAIService } from '../ArticleAIService';

// Mock AI binding
const createMockAI = () => ({
  run: vi.fn(),
});

// Mock Vectorize binding
const createMockVectorize = () => ({
  upsert: vi.fn(),
  query: vi.fn(),
});

// Mock D1Service
const createMockD1Service = () => {
  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
  };

  return {
    db: {
      prepare: vi.fn().mockReturnValue(mockStatement),
      _statement: mockStatement,
    },
  };
};

// Mock Images binding
const createMockImages = () => ({
  upload: vi.fn(),
});

describe('ArticleAIService', () => {
  let service: ArticleAIService;
  let mockAI: ReturnType<typeof createMockAI>;
  let mockVectorize: ReturnType<typeof createMockVectorize>;
  let mockD1Service: ReturnType<typeof createMockD1Service>;
  let mockImages: ReturnType<typeof createMockImages>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAI = createMockAI();
    mockVectorize = createMockVectorize();
    mockD1Service = createMockD1Service();
    mockImages = createMockImages();
    service = new ArticleAIService(mockAI, mockVectorize, mockD1Service, mockImages);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cleanContent', () => {
    // Use minContentLength: 10 for tests with short content
    const shortContentOptions = {
      removeImages: true,
      removeRandomChars: false,
      normalizeWhitespace: true,
      extractImageUrls: true,
      minContentLength: 10,
    };

    // Use higher threshold for tests that need AI processing
    const aiCleaningOptions = {
      removeImages: true,
      removeRandomChars: true,
      normalizeWhitespace: true,
      extractImageUrls: true,
      minContentLength: 100,
    };

    it('should extract image URLs from HTML img tags', async () => {
      const content = '<p>Hello World this is a longer article content</p><img src="https://example.com/image.jpg"><p>With more text</p>';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.extractedImages).toContain('https://example.com/image.jpg');
    });

    it('should extract image URLs from markdown syntax', async () => {
      const content = 'Hello this is a longer article ![alt text](https://example.com/image.png) with more World text';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.extractedImages).toContain('https://example.com/image.png');
    });

    it('should extract direct image URLs from src attributes', async () => {
      const content = 'Check this image: <div src="https://cdn.example.com/photo.jpg"></div> more text here with additional content';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.extractedImages).toContain('https://cdn.example.com/photo.jpg');
    });

    it('should remove img tags when removeImages is true', async () => {
      const content = '<p>Hello World this is a test article</p><img src="test.jpg" alt="test"><p>World more text</p>';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.cleanedContent).not.toContain('<img');
      expect(result.cleanedContent).not.toContain('src=');
    });

    it('should remove figure tags', async () => {
      const content = '<p>Hello World article</p><figure><img src="test.jpg"><figcaption>Caption</figcaption></figure><p>More World text</p>';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.cleanedContent).not.toContain('<figure');
      expect(result.cleanedContent).not.toContain('Caption');
    });

    it('should remove markdown images', async () => {
      const content = 'Hello this is a longer article text ![alt text](image.png) World with more content';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.cleanedContent).not.toContain('![');
      expect(result.cleanedContent).not.toContain('image.png');
    });

    it('should normalize whitespace', async () => {
      const content = 'Hello    World    Test\n\n\n\nMore\t\ttabs content here';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.cleanedContent).toBe('Hello World Test More tabs content here');
    });

    it('should remove HTML entities', async () => {
      const content = 'Tom &amp; Jerry &lt;3 HTML &gt; text with more content here';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.cleanedContent).not.toContain('&amp;');
      expect(result.cleanedContent).not.toContain('&lt;');
    });

    it('should remove nested HTML tags', async () => {
      const content = '<div><p><span>Hello this is longer</span> <strong>World content</strong></p></div>';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.cleanedContent).toBe('Hello this is longer World content');
    });

    it('should return original content when below minContentLength', async () => {
      const shortContent = 'Short';
      const highThresholdOptions = { ...shortContentOptions, minContentLength: 100 };

      const result = await service.cleanContent(shortContent, highThresholdOptions);

      expect(result.cleanedContent).toBe('Short');
      expect(result.extractedImages).toEqual([]);
    });

    it('should handle empty content', async () => {
      const result = await service.cleanContent('', shortContentOptions);

      expect(result.cleanedContent).toBe('');
      expect(result.extractedImages).toEqual([]);
      expect(result.removedCharCount).toBe(0);
    });

    it('should track removed character count', async () => {
      const content = '<p>Hello World article</p> <img src="test.jpg"> <p>More World text content here</p>';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.removedCharCount).toBeGreaterThan(0);
    });

    it('should not duplicate extracted image URLs', async () => {
      const content = '<p>Article text</p><img src="https://example.com/image.jpg"><p>More text</p><img src="https://example.com/image.jpg">';

      const result = await service.cleanContent(content, shortContentOptions);

      const uniqueImages = [...new Set(result.extractedImages)];
      expect(result.extractedImages).toEqual(uniqueImages);
    });

    it('should use AI cleaning when removeRandomChars is true and content is long', async () => {
      mockAI.run.mockResolvedValue({ response: 'Cleaned content from AI' });

      const longContent = 'A'.repeat(300) + ' random@#$% chars';

      await service.cleanContent(longContent, {
        ...aiCleaningOptions,
        removeRandomChars: true,
      });

      expect(mockAI.run).toHaveBeenCalled();
    });

    it('should fallback to regex when AI cleaning fails', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error'));
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const longContent = 'A'.repeat(300);

      const result = await service.cleanContent(longContent, {
        ...aiCleaningOptions,
        removeRandomChars: true,
      });

      expect(result.cleanedContent).toBeDefined();
      consoleSpy.mockRestore();
    });

    // Security: HTML tag removal tests
    // Note: cleanContent removes HTML tags but preserves text content
    // Full XSS sanitization should happen at render time (React escapes by default)
    it('should remove script tags from content', async () => {
      const content = '<p>Hello World</p><script>alert("xss")</script><p>More content here</p>';

      const result = await service.cleanContent(content, shortContentOptions);

      // Tags are removed, text content may remain (sanitized at render)
      expect(result.cleanedContent).not.toContain('<script');
      expect(result.cleanedContent).not.toContain('</script>');
    });

    it('should remove style tags', async () => {
      const content = '<p>Article text</p><style>.malicious{}</style><p>More text</p>';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.cleanedContent).not.toContain('<style');
      expect(result.cleanedContent).not.toContain('</style>');
    });

    it('should remove iframe tags', async () => {
      const content = '<p>Article</p><iframe src="evil.com"></iframe><p>More content here</p>';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.cleanedContent).not.toContain('<iframe');
      expect(result.cleanedContent).not.toContain('</iframe>');
    });

    it('should remove object and embed tags', async () => {
      const content = '<p>Article</p><object data="malware.swf"></object><embed src="bad.swf"><p>More text</p>';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.cleanedContent).not.toContain('<object');
      expect(result.cleanedContent).not.toContain('<embed');
    });

    it('should handle nested dangerous tags', async () => {
      const content = '<div><p>Article</p><script><script>nested</script></script><p>More text here</p></div>';

      const result = await service.cleanContent(content, shortContentOptions);

      expect(result.cleanedContent).not.toContain('<script');
    });
  });

  describe('extractKeywords', () => {
    beforeEach(() => {
      mockD1Service.db._statement.all.mockResolvedValue({
        results: [
          { keyword: 'government', article_section_id: 'politics', relevance_score: 0.9 },
          { keyword: 'economy', article_section_id: 'business', relevance_score: 0.8 },
          { keyword: 'election', article_section_id: 'politics', relevance_score: 0.85 },
        ],
      });
    });

    it('should return empty array for short content', async () => {
      const result = await service.extractKeywords('Title', 'Short');

      expect(result).toEqual([]);
    });

    it('should extract keywords using AI', async () => {
      mockAI.run.mockResolvedValue({
        response: JSON.stringify({
          keywords: [
            { keyword: 'government', confidence: 0.95, reasoning: 'matches' },
            { keyword: 'economy', confidence: 0.8, reasoning: 'matches' },
          ],
        }),
      });

      const result = await service.extractKeywords(
        'Government Announces Economic Policy',
        'The government has announced new economic policies affecting the economy and businesses...'
      );

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('keyword');
      expect(result[0]).toHaveProperty('confidence');
      expect(result[0]).toHaveProperty('category');
    });

    it('should filter keywords with low confidence', async () => {
      mockAI.run.mockResolvedValue({
        response: JSON.stringify({
          keywords: [
            { keyword: 'government', confidence: 0.95, reasoning: 'high' },
            { keyword: 'economy', confidence: 0.3, reasoning: 'low' }, // Below 0.5 threshold
          ],
        }),
      });

      const result = await service.extractKeywords(
        'Title',
        'Content '.repeat(20)
      );

      const lowConfidence = result.filter(k => k.confidence < 0.5);
      expect(lowConfidence).toHaveLength(0);
    });

    it('should fallback to simple matching when AI returns invalid JSON', async () => {
      mockAI.run.mockResolvedValue({ response: 'not valid json at all' });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.extractKeywords(
        'Government Policy',
        'The government announced new policy changes affecting the economy...'
      );

      // Should use fallback matching - finds 'government' and 'economy' in content
      expect(result.some(k => k.keyword === 'government' || k.keyword === 'economy')).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should return empty array when AI throws error', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.extractKeywords(
        'Government Policy',
        'The government announced new policy changes affecting the economy...'
      );

      expect(result).toEqual([]);

      consoleSpy.mockRestore();
    });

    it('should limit to 8 keywords maximum', async () => {
      mockAI.run.mockResolvedValue({
        response: JSON.stringify({
          keywords: Array(15).fill({ keyword: 'government', confidence: 0.9 }),
        }),
      });

      const result = await service.extractKeywords(
        'Title',
        'Content '.repeat(20)
      );

      expect(result.length).toBeLessThanOrEqual(8);
    });

    it('should handle AI returning invalid JSON', async () => {
      mockAI.run.mockResolvedValue({ response: 'not valid json' });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.extractKeywords(
        'Government Title',
        'The government content here...'
      );

      // Should fallback to simple matching
      expect(Array.isArray(result)).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('calculateQualityScore', () => {
    it('should return low score for short content', async () => {
      const result = await service.calculateQualityScore('Title', 'Short');

      expect(result).toBe(0.3);
    });

    it('should use AI for quality scoring', async () => {
      mockAI.run.mockResolvedValue({ response: '0.85' });

      const result = await service.calculateQualityScore(
        'Good Title',
        'This is a well-written article with detailed content...'.repeat(10)
      );

      expect(result).toBe(0.85);
    });

    it('should handle AI returning non-numeric response', async () => {
      mockAI.run.mockResolvedValue({ response: 'excellent quality' });

      const result = await service.calculateQualityScore(
        'Title',
        'Content '.repeat(50)
      );

      // Should use fallback scoring
      expect(result).toBeGreaterThanOrEqual(0.5);
      expect(result).toBeLessThanOrEqual(1.0);
    });

    it('should clamp score between 0 and 1', async () => {
      mockAI.run.mockResolvedValue({ response: '1.5' }); // Invalid high value

      const result = await service.calculateQualityScore(
        'Title',
        'Content '.repeat(50)
      );

      // Should use fallback since 1.5 > 1
      expect(result).toBeLessThanOrEqual(1.0);
    });

    it('should use fallback scoring when AI fails', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.calculateQualityScore(
        'Title',
        'Content '.repeat(50)
      );

      expect(result).toBe(0.5); // Default score

      consoleSpy.mockRestore();
    });

    it('should boost score for longer content', async () => {
      mockAI.run.mockResolvedValue({ response: 'invalid' }); // Force fallback

      const shortResult = await service.calculateQualityScore(
        'Title here',
        'A '.repeat(60) // Just over 100 chars
      );

      const longResult = await service.calculateQualityScore(
        'Proper Title Here',
        'A '.repeat(600) // Over 1000 chars
      );

      expect(longResult).toBeGreaterThanOrEqual(shortResult);
    });

    it('should boost score for Zimbabwe-related content', async () => {
      mockAI.run.mockResolvedValue({ response: 'invalid' }); // Force fallback

      const result = await service.calculateQualityScore(
        'Title',
        'Zimbabwe and Harare news content '.repeat(20)
      );

      expect(result).toBeGreaterThan(0.5);
    });
  });

  describe('generateContentHash', () => {
    it('should generate consistent hash for same content', async () => {
      const content = 'Test content';

      const hash1 = await service.generateContentHash(content);
      const hash2 = await service.generateContentHash(content);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different content', async () => {
      const hash1 = await service.generateContentHash('Content A');
      const hash2 = await service.generateContentHash('Content B');

      expect(hash1).not.toBe(hash2);
    });

    it('should normalize content before hashing', async () => {
      const hash1 = await service.generateContentHash('Test  Content');
      const hash2 = await service.generateContentHash('test content');

      expect(hash1).toBe(hash2);
    });

    it('should return hex string', async () => {
      const hash = await service.generateContentHash('Test');

      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('processImages', () => {
    it('should return original URLs when no image service', async () => {
      const serviceWithoutImages = new ArticleAIService(mockAI, mockVectorize, mockD1Service);
      const urls = ['https://example.com/image.jpg'];

      const result = await serviceWithoutImages.processImages(urls);

      expect(result).toEqual(urls);
    });

    it('should return original URLs when no images provided', async () => {
      const result = await service.processImages([]);

      expect(result).toEqual([]);
    });

    it('should upload images to Cloudflare Images', async () => {
      mockImages.upload.mockResolvedValue({
        success: true,
        result: { variants: ['https://cdn.example.com/optimized.jpg'] },
      });

      const result = await service.processImages(['https://example.com/image.jpg']);

      expect(mockImages.upload).toHaveBeenCalled();
      expect(result).toContain('https://cdn.example.com/optimized.jpg');
    });

    it('should keep original URL when upload fails', async () => {
      mockImages.upload.mockResolvedValue({ success: false });

      const originalUrl = 'https://example.com/image.jpg';
      const result = await service.processImages([originalUrl]);

      expect(result).toContain(originalUrl);
    });

    it('should limit to 5 images', async () => {
      mockImages.upload.mockResolvedValue({
        success: true,
        result: { variants: ['https://cdn.example.com/optimized.jpg'] },
      });

      const urls = Array(10).fill('https://example.com/image.jpg');
      await service.processImages(urls);

      expect(mockImages.upload).toHaveBeenCalledTimes(5);
    });

    it('should handle upload errors gracefully', async () => {
      mockImages.upload.mockRejectedValue(new Error('Upload failed'));
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const originalUrl = 'https://example.com/image.jpg';
      const result = await service.processImages([originalUrl]);

      expect(result).toContain(originalUrl);

      consoleSpy.mockRestore();
    });
  });

  describe('createEmbedding', () => {
    it('should return undefined when no vectorize service', async () => {
      const serviceWithoutVectorize = new ArticleAIService(mockAI, null, mockD1Service);

      const result = await serviceWithoutVectorize.createEmbedding(1, 'Title', 'Content');

      expect(result).toBeUndefined();
    });

    it('should create embedding and store in vectorize', async () => {
      mockAI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      mockVectorize.upsert.mockResolvedValue(undefined);

      const result = await service.createEmbedding(123, 'Title', 'Content');

      expect(result).toBe('article_123');
      expect(mockVectorize.upsert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'article_123',
          values: [0.1, 0.2, 0.3],
          metadata: expect.objectContaining({
            articleId: 123,
            title: 'Title',
          }),
        }),
      ]);
    });

    it('should handle embedding generation failure', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.createEmbedding(1, 'Title', 'Content');

      expect(result).toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  describe('classifyNewsCategory', () => {
    it('should classify article into category', async () => {
      mockAI.run.mockResolvedValue({
        response: '{"category": "politics", "confidence": 0.9}',
      });

      const result = await service.classifyNewsCategory(
        'Government Announces New Policy',
        'The government has announced...'
      );

      expect(result.category).toBe('politics');
      expect(result.confidence).toBe(0.9);
    });

    it('should default to general for invalid category', async () => {
      mockAI.run.mockResolvedValue({
        response: '{"category": "invalid_category", "confidence": 0.9}',
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.classifyNewsCategory('Title', 'Content');

      expect(result.category).toBe('general');
      expect(result.confidence).toBe(0.3);

      consoleSpy.mockRestore();
    });

    it('should handle AI failure', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.classifyNewsCategory('Title', 'Content');

      expect(result.category).toBe('general');
      expect(result.confidence).toBe(0.3);

      consoleSpy.mockRestore();
    });

    it('should extract JSON from response text', async () => {
      mockAI.run.mockResolvedValue({
        response: 'Here is the classification: {"category": "sports", "confidence": 0.85}',
      });

      const result = await service.classifyNewsCategory('Sports News', 'Football match results...');

      expect(result.category).toBe('sports');
    });

    it('should clamp confidence between 0.3 and 1', async () => {
      mockAI.run.mockResolvedValue({
        response: '{"category": "economy", "confidence": 0.1}',
      });

      const result = await service.classifyNewsCategory('Title', 'Content');

      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    it('should handle valid JSON with missing category field', async () => {
      mockAI.run.mockResolvedValue({
        response: '{"confidence": 0.9}', // Missing category
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.classifyNewsCategory('Title', 'Content');

      // Falls back to 'general' for missing category, but keeps confidence
      expect(result.category).toBe('general');
      expect(result.confidence).toBe(0.9); // Uses provided confidence, clamped

      consoleSpy.mockRestore();
    });

    it('should handle valid JSON with unexpected structure', async () => {
      // This response has nested objects - the regex \{[^}]+\} captures incomplete JSON
      // which causes JSON.parse to fail, triggering the fallback
      mockAI.run.mockResolvedValue({
        response: '{"result": {"cat": "politics"}, "score": 0.9}', // Nested structure
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.classifyNewsCategory('Title', 'Content');

      // Nested JSON causes parse error, returns default fallback
      expect(result.category).toBe('general');
      expect(result.confidence).toBe(0.3);

      consoleSpy.mockRestore();
    });

    it('should handle array response - extracts first object', async () => {
      mockAI.run.mockResolvedValue({
        response: '[{"category": "sports", "confidence": 0.8}]', // Array wrapping valid object
      });

      const result = await service.classifyNewsCategory('Title', 'Content');

      // Regex extracts the inner JSON object from the array
      expect(result.category).toBe('sports');
      expect(result.confidence).toBe(0.8);
    });

    it('should handle null response fields with defaults', async () => {
      mockAI.run.mockResolvedValue({
        response: '{"category": null, "confidence": null}',
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.classifyNewsCategory('Title', 'Content');

      // null category triggers fallback to 'general'
      // null confidence falls back to 0.5
      expect(result.category).toBe('general');
      expect(result.confidence).toBe(0.5);

      consoleSpy.mockRestore();
    });

    it('should handle response with no valid JSON', async () => {
      mockAI.run.mockResolvedValue({
        response: 'This is not valid JSON at all',
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.classifyNewsCategory('Title', 'Content');

      expect(result.category).toBe('general');
      expect(result.confidence).toBe(0.3);

      consoleSpy.mockRestore();
    });
  });

  describe('processArticle', () => {
    beforeEach(() => {
      // Setup all necessary mocks for full processing
      mockD1Service.db._statement.all.mockResolvedValue({ results: [] });
      mockD1Service.db._statement.run.mockResolvedValue({ success: true });
      mockD1Service.db._statement.first.mockResolvedValue(null);
      mockAI.run.mockResolvedValue({ response: '0.8' });
      mockVectorize.upsert.mockResolvedValue(undefined);
    });

    it('should process article through full pipeline', async () => {
      mockAI.run
        .mockResolvedValueOnce({ response: '{"keywords": []}' }) // extractKeywords
        .mockResolvedValueOnce({ response: '0.75' }) // calculateQualityScore
        .mockResolvedValueOnce({ data: [[0.1, 0.2]] }); // createEmbedding

      const result = await service.processArticle({
        id: 1,
        headline: 'Test Article',
        content: 'Test content '.repeat(50),
      });

      expect(result).toHaveProperty('cleanedContent');
      expect(result).toHaveProperty('extractedImages');
      expect(result).toHaveProperty('keywords');
      expect(result).toHaveProperty('qualityScore');
      expect(result).toHaveProperty('contentHash');
      expect(result).toHaveProperty('processingTime');
    });

    it('should log processing start and completion', async () => {
      mockAI.run.mockResolvedValue({ response: '0.8' });

      await service.processArticle({
        id: 1,
        headline: 'Test',
        content: 'Content '.repeat(50),
      });

      // Should have called prepare for logging
      expect(mockD1Service.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ai_processing_log')
      );
    });

    it('should handle AI errors gracefully with fallbacks', async () => {
      // When AI fails, processArticle uses fallback values (doesn't throw)
      mockAI.run.mockRejectedValue(new Error('AI failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.processArticle({
        id: 1,
        headline: 'Test',
        content: 'Content '.repeat(50),
      });

      // Should complete with fallback values
      expect(result).toHaveProperty('cleanedContent');
      expect(result).toHaveProperty('qualityScore', 0.5); // Fallback score
      expect(result.keywords).toEqual([]); // Empty keywords on error

      // Should have logged processing
      expect(mockD1Service.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ai_processing_log')
      );

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('should complete processing even when some AI operations fail', async () => {
      // First call (extractKeywords) fails, second call (qualityScore) succeeds
      mockAI.run
        .mockRejectedValueOnce(new Error('Keywords extraction failed'))
        .mockResolvedValueOnce({ response: '0.75' })
        .mockResolvedValueOnce({ data: [[0.1, 0.2]] }); // embedding

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.processArticle({
        id: 1,
        headline: 'Test Article',
        content: 'Test content '.repeat(50),
      });

      // Should complete with partial results
      expect(result.keywords).toEqual([]); // Failed operation returns empty
      expect(result.qualityScore).toBeDefined();
      expect(result.cleanedContent).toBeDefined();

      consoleSpy.mockRestore();
    });
  });

  describe('extractAuthors', () => {
    it('should extract author from byline using AI', async () => {
      mockAI.run.mockResolvedValue({
        response: JSON.stringify({
          authors: [
            {
              name: 'John Doe',
              normalizedName: 'john_doe',
              title: 'Senior Reporter',
              contributionType: 'primary',
              confidence: 0.95,
            },
          ],
          confidence: 0.9,
        }),
      });

      const result = await service.extractAuthors(
        'By John Doe, Senior Reporter',
        'Article Title',
        'The Herald'
      );

      expect(result.authors).toHaveLength(1);
      expect(result.authors[0].name).toBe('John Doe');
      expect(result.authors[0].outlet).toBe('The Herald');
    });

    it('should use fallback extraction when AI fails', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.extractAuthors(
        'By Jane Smith',
        'Article Title',
        'Daily News'
      );

      expect(result.authors).toHaveLength(1);
      expect(result.authors[0].name).toBe('Jane Smith');
      expect(result.confidence).toBe(0.5);

      consoleSpy.mockRestore();
    });

    it('should handle "Staff Reporter" bylines', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.extractAuthors(
        'Staff Reporter',
        'Article Title',
        'The Herald'
      );

      // Fallback should match "Staff Reporter"
      expect(result.authors.length).toBeLessThanOrEqual(1);

      consoleSpy.mockRestore();
    });
  });

  describe('assessGrammar', () => {
    it('should return 0 for empty content', async () => {
      const result = await service.assessGrammar('');

      expect(result).toBe(0);
    });

    it('should return 0 for short content', async () => {
      const result = await service.assessGrammar('Short');

      expect(result).toBe(0);
    });

    it('should use AI for grammar assessment', async () => {
      mockAI.run.mockResolvedValue({ response: '0.85' });

      const result = await service.assessGrammar('This is a well-written sentence with proper grammar.');

      expect(result).toBe(0.85);
    });

    it('should clamp score between 0 and 1', async () => {
      mockAI.run.mockResolvedValue({ response: '1.5' });

      const result = await service.assessGrammar('Content '.repeat(20));

      expect(result).toBeLessThanOrEqual(1);
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('assessHeadlineQuality', () => {
    it('should return 0 for empty headline', async () => {
      const result = await service.assessHeadlineQuality('');

      expect(result).toBe(0);
    });

    it('should use AI for headline assessment', async () => {
      mockAI.run.mockResolvedValue({ response: '0.9' });

      const result = await service.assessHeadlineQuality('Government Announces Major Economic Reforms');

      expect(result).toBe(0.9);
    });
  });

  describe('assessTopicRelevance', () => {
    it('should use AI for topic relevance assessment', async () => {
      mockAI.run.mockResolvedValue({ response: '0.95' });

      const result = await service.assessTopicRelevance(
        'Harare City Council News',
        'The Harare City Council in Zimbabwe announced...'
      );

      expect(result).toBe(0.95);
    });

    it('should handle AI failure', async () => {
      mockAI.run.mockRejectedValue(new Error('AI error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.assessTopicRelevance('Title', 'Content');

      expect(result).toBe(0.5);

      consoleSpy.mockRestore();
    });
  });
});
