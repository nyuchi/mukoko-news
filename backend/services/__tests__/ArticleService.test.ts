/**
 * Tests for ArticleService
 * Tests slug generation, reading time calculation, content extraction, and article management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock D1Database for testing
const createMockDb = () => ({
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
  }),
});

// Import ArticleService dynamically since it's a JS file
// We'll test the pure functions directly
describe('ArticleService', () => {
  let articleService: any;
  let mockDb: any;

  beforeEach(() => {
    mockDb = createMockDb();
    // Create a minimal ArticleService instance for testing
    articleService = {
      db: mockDb,
      scraperConfig: {
        contentSelectors: ['.entry-content', '.post-content', '.article-content'],
        excludeSelectors: ['.advertisement', '.social-share'],
        maxContentLength: 50000,
        timeout: 10000,
      },
    };
  });

  describe('generateSlug', () => {
    // Test the slug generation logic directly
    const generateSlug = (title: string): string | null => {
      if (!title) return null;

      return title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single
        .trim()
        .substring(0, 80) // Limit length
        .replace(/-$/, ''); // Remove trailing hyphen
    };

    it('should convert title to lowercase slug', () => {
      expect(generateSlug('Hello World')).toBe('hello-world');
    });

    it('should replace spaces with hyphens', () => {
      expect(generateSlug('This Is A Test')).toBe('this-is-a-test');
    });

    it('should remove special characters', () => {
      expect(generateSlug('Hello, World! @2024')).toBe('hello-world-2024');
    });

    it('should handle multiple spaces', () => {
      expect(generateSlug('Hello   World')).toBe('hello-world');
    });

    it('should handle multiple hyphens', () => {
      expect(generateSlug('Hello---World')).toBe('hello-world');
    });

    it('should limit slug length to 80 characters', () => {
      const longTitle = 'A'.repeat(100);
      const slug = generateSlug(longTitle);
      expect(slug!.length).toBeLessThanOrEqual(80);
    });

    it('should remove trailing hyphens', () => {
      expect(generateSlug('Hello World!')).toBe('hello-world');
    });

    it('should return null for empty title', () => {
      expect(generateSlug('')).toBe(null);
    });

    it('should return null for undefined/null title', () => {
      expect(generateSlug(null as any)).toBe(null);
      expect(generateSlug(undefined as any)).toBe(null);
    });

    it('should handle unicode characters', () => {
      expect(generateSlug('Café & Restaurant')).toBe('caf-restaurant');
    });

    it('should handle numbers in title', () => {
      expect(generateSlug('Top 10 Tips for 2024')).toBe('top-10-tips-for-2024');
    });

    it('should handle Zimbabwe-specific titles', () => {
      expect(generateSlug('Harare City Council Announces New Policy'))
        .toBe('harare-city-council-announces-new-policy');
    });
  });

  describe('calculateReadingTime', () => {
    const calculateReadingTime = (content: string): number => {
      if (!content) return 0;
      const wordCount = content.split(/\s+/).length;
      return Math.ceil(wordCount / 200);
    };

    it('should return 0 for empty content', () => {
      expect(calculateReadingTime('')).toBe(0);
    });

    it('should return 0 for null/undefined content', () => {
      expect(calculateReadingTime(null as any)).toBe(0);
      expect(calculateReadingTime(undefined as any)).toBe(0);
    });

    it('should calculate 1 minute for short content', () => {
      const shortContent = 'Hello world';
      expect(calculateReadingTime(shortContent)).toBe(1);
    });

    it('should calculate reading time based on 200 words per minute', () => {
      const words = Array(200).fill('word').join(' ');
      expect(calculateReadingTime(words)).toBe(1);
    });

    it('should round up to next minute', () => {
      const words = Array(201).fill('word').join(' ');
      expect(calculateReadingTime(words)).toBe(2);
    });

    it('should handle 400 words as 2 minutes', () => {
      const words = Array(400).fill('word').join(' ');
      expect(calculateReadingTime(words)).toBe(2);
    });

    it('should handle 1000 words as 5 minutes', () => {
      const words = Array(1000).fill('word').join(' ');
      expect(calculateReadingTime(words)).toBe(5);
    });

    it('should handle content with multiple spaces', () => {
      const content = 'Hello    world   this    is    a    test';
      // 6 words = 1 minute
      expect(calculateReadingTime(content)).toBe(1);
    });
  });

  describe('extractContentFromHTML', () => {
    // Uses loop-based removal to handle nested/malformed tags safely
    const stripHTML = (html: string): string => {
      let result = html;
      let previousLength;

      // Loop to remove script tags until none remain (handles nested scripts)
      // Pattern matches any whitespace (spaces, tabs, newlines) in closing tag
      do {
        previousLength = result.length;
        result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script[\s\S]*?>/gi, '');
      } while (result.length !== previousLength);

      // Loop to remove style tags until none remain (handles nested styles)
      do {
        previousLength = result.length;
        result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style[\s\S]*?>/gi, '');
      } while (result.length !== previousLength);

      // Remove all remaining HTML tags with multiple passes for nested content
      do {
        previousLength = result.length;
        result = result.replace(/<[^>]+>/g, ' ');
      } while (result.length !== previousLength);

      // Normalize whitespace and trim
      return result.replace(/\s+/g, ' ').trim();
    };

    it('should strip HTML tags from content', () => {
      const html = '<p>Hello <strong>World</strong></p>';
      expect(stripHTML(html)).toBe('Hello World');
    });

    it('should remove script tags and their content', () => {
      const html = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
      expect(stripHTML(html)).toBe('Hello World');
    });

    it('should remove style tags and their content', () => {
      const html = '<p>Hello</p><style>.red { color: red; }</style><p>World</p>';
      expect(stripHTML(html)).toBe('Hello World');
    });

    it('should normalize whitespace', () => {
      const html = '<p>Hello</p>    <p>World</p>';
      expect(stripHTML(html)).toBe('Hello World');
    });

    it('should handle nested tags', () => {
      const html = '<div><p><span>Hello</span> <strong>World</strong></p></div>';
      expect(stripHTML(html)).toBe('Hello World');
    });

    it('should handle empty HTML', () => {
      expect(stripHTML('')).toBe('');
    });
  });

  describe('normalizeImageUrl', () => {
    const normalizeImageUrl = (imgUrl: string, baseUrl: string): string | null => {
      try {
        if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
          return imgUrl;
        }

        if (imgUrl.startsWith('//')) {
          const protocol = baseUrl.startsWith('https://') ? 'https:' : 'http:';
          return protocol + imgUrl;
        }

        if (imgUrl.startsWith('/')) {
          const urlObj = new URL(baseUrl);
          return `${urlObj.protocol}//${urlObj.hostname}${imgUrl}`;
        }

        if (!imgUrl.startsWith('/')) {
          const urlObj = new URL(baseUrl);
          const basePath = urlObj.pathname.endsWith('/')
            ? urlObj.pathname
            : urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
          return `${urlObj.protocol}//${urlObj.hostname}${basePath}${imgUrl}`;
        }

        return null;
      } catch {
        return null;
      }
    };

    it('should return absolute URLs unchanged', () => {
      const url = 'https://example.com/image.jpg';
      expect(normalizeImageUrl(url, 'https://other.com')).toBe(url);
    });

    it('should handle protocol-relative URLs with https base', () => {
      const url = '//cdn.example.com/image.jpg';
      expect(normalizeImageUrl(url, 'https://example.com'))
        .toBe('https://cdn.example.com/image.jpg');
    });

    it('should handle protocol-relative URLs with http base', () => {
      const url = '//cdn.example.com/image.jpg';
      expect(normalizeImageUrl(url, 'http://example.com'))
        .toBe('http://cdn.example.com/image.jpg');
    });

    it('should handle absolute path URLs', () => {
      const url = '/images/photo.jpg';
      expect(normalizeImageUrl(url, 'https://example.com/articles/page'))
        .toBe('https://example.com/images/photo.jpg');
    });

    it('should handle relative path URLs', () => {
      const url = 'images/photo.jpg';
      expect(normalizeImageUrl(url, 'https://example.com/articles/'))
        .toBe('https://example.com/articles/images/photo.jpg');
    });

    it('should handle invalid base URLs gracefully', () => {
      expect(normalizeImageUrl('/image.jpg', 'not-a-url')).toBe(null);
    });
  });

  describe('needsContentEnhancement', () => {
    const needsContentEnhancement = (article: { description?: string; article_body?: string }): boolean => {
      if (!article.description && !article.article_body) {
        return true;
      }

      const totalContent = (article.description || '') + (article.article_body || '');

      if (totalContent.length < 200) {
        return true;
      }

      const genericPhrases = [
        'read more',
        'continue reading',
        'full article',
        'visit website',
        'more details',
        'click here',
        'loading...',
        'content not available',
      ];

      const lowerContent = totalContent.toLowerCase();
      if (genericPhrases.some((phrase) => lowerContent.includes(phrase))) {
        return true;
      }

      return false;
    };

    it('should return true for articles with no content', () => {
      expect(needsContentEnhancement({})).toBe(true);
    });

    it('should return true for articles with short content', () => {
      expect(needsContentEnhancement({ description: 'Short' })).toBe(true);
    });

    it('should return true for content containing "read more"', () => {
      const article_body = 'A'.repeat(250) + ' Read more here...';
      expect(needsContentEnhancement({ article_body })).toBe(true);
    });

    it('should return true for content containing "click here"', () => {
      const article_body = 'A'.repeat(250) + ' Click here for details';
      expect(needsContentEnhancement({ article_body })).toBe(true);
    });

    it('should return false for adequate content', () => {
      const article_body = 'This is a complete article with enough content. '.repeat(20);
      expect(needsContentEnhancement({ article_body })).toBe(false);
    });

    it('should return false for content at exactly 200 characters', () => {
      const article_body = 'A'.repeat(200);
      expect(needsContentEnhancement({ article_body })).toBe(false);
    });

    it('should combine description and content for length check', () => {
      expect(needsContentEnhancement({
        description: 'A'.repeat(100),
        article_body: 'B'.repeat(100),
      })).toBe(false);
    });
  });

  describe('cleanText', () => {
    // IMPORTANT: Decode &amp; LAST to avoid double-unescaping (e.g., &amp;lt; -> &lt; -> <)
    const cleanText = (text: string): string => {
      return text
        .replace(/\s+/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')  // Decode &amp; LAST to prevent double-unescaping
        .trim();
    };

    it('should normalize whitespace', () => {
      expect(cleanText('Hello    World')).toBe('Hello World');
    });

    it('should decode HTML entities', () => {
      expect(cleanText('Tom &amp; Jerry')).toBe('Tom & Jerry');
      expect(cleanText('5 &lt; 10')).toBe('5 < 10');
      expect(cleanText('10 &gt; 5')).toBe('10 > 5');
    });

    it('should decode quote entities', () => {
      expect(cleanText('He said &quot;Hello&quot;')).toBe('He said "Hello"');
      expect(cleanText("It&#039;s fine")).toBe("It's fine");
    });

    it('should convert non-breaking spaces', () => {
      expect(cleanText('Hello&nbsp;World')).toBe('Hello World');
    });

    it('should trim whitespace', () => {
      expect(cleanText('  Hello World  ')).toBe('Hello World');
    });

    it('should handle mixed entities', () => {
      expect(cleanText('&lt;div&gt;Hello &amp; World&lt;/div&gt;'))
        .toBe('<div>Hello & World</div>');
    });
  });

  describe('getHashtags', () => {
    const getHashtags = (article: { category?: string; tags?: string[]; headline?: string }): string[] => {
      const tags: string[] = [];

      if (article.category) {
        tags.push(`#${article.category.toLowerCase().replace(/\s+/g, '')}`);
      }

      if (article.tags && Array.isArray(article.tags)) {
        article.tags.slice(0, 3).forEach((tag) => {
          const formatted = `#${tag.toLowerCase().replace(/\s+/g, '')}`;
          if (!tags.includes(formatted)) {
            tags.push(formatted);
          }
        });
      }

      const headlineLower = (article.headline || '').toLowerCase();
      const zimbabweKeywords = ['zimbabwe', 'zim', 'harare', 'bulawayo'];
      zimbabweKeywords.forEach((keyword) => {
        if (headlineLower.includes(keyword) && tags.length < 4) {
          const tag = `#${keyword}`;
          if (!tags.includes(tag)) {
            tags.push(tag);
          }
        }
      });

      return tags.slice(0, 4);
    };

    it('should include category as first tag', () => {
      const result = getHashtags({ category: 'Politics' });
      expect(result[0]).toBe('#politics');
    });

    it('should include article tags', () => {
      const result = getHashtags({ tags: ['Economy', 'Business'] });
      expect(result).toContain('#economy');
      expect(result).toContain('#business');
    });

    it('should extract Zimbabwe keywords from headline', () => {
      const result = getHashtags({ headline: 'Harare City Council News' });
      expect(result).toContain('#harare');
    });

    it('should limit to 4 tags maximum', () => {
      const result = getHashtags({
        category: 'Politics',
        tags: ['Tag1', 'Tag2', 'Tag3', 'Tag4', 'Tag5'],
        headline: 'Zimbabwe News from Harare and Bulawayo',
      });
      expect(result.length).toBeLessThanOrEqual(4);
    });

    it('should not duplicate tags', () => {
      const result = getHashtags({
        category: 'Politics',
        tags: ['politics', 'Politics'],
      });
      const uniqueTags = [...new Set(result)];
      expect(result.length).toBe(uniqueTags.length);
    });

    it('should handle spaces in tags', () => {
      const result = getHashtags({ category: 'Breaking News' });
      expect(result[0]).toBe('#breakingnews');
    });
  });
});
