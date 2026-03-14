import { describe, it, expect, beforeEach } from 'vitest';
import { FeedOutputService } from '../../platform/FeedOutputService.js';
import { createMockD1 } from '../helpers.js';

describe('FeedOutputService', () => {
  let service: FeedOutputService;
  let db: ReturnType<typeof createMockD1>['db'];
  let statement: ReturnType<typeof createMockD1>['statement'];

  const mockArticles = [
    {
      id: 'art-1',
      title: 'Zimbabwe Economy Grows',
      description: 'GDP growth exceeds expectations',
      content: '<p>The economy showed strong growth in Q3.</p>',
      url: 'https://herald.co.zw/economy-grows',
      image_url: 'https://images.example.com/econ.jpg',
      author: 'John Moyo',
      published_at: '2026-03-14T10:00:00Z',
      country_code: 'ZW',
      source_name: 'The Herald',
      source_url: 'https://herald.co.zw',
    },
    {
      id: 'art-2',
      title: 'Kenya Tech Hub Expands',
      description: 'Nairobi tech ecosystem continues to grow',
      content: '<p>New investments boost the tech sector.</p>',
      url: 'https://nation.africa/tech-hub',
      author: 'Jane Wanjiku',
      published_at: '2026-03-14T09:00:00Z',
      country_code: 'KE',
      source_name: 'Daily Nation',
      source_url: 'https://nation.africa',
    },
  ];

  beforeEach(() => {
    ({ db, statement } = createMockD1());
    statement.all.mockResolvedValue({ results: mockArticles });
    service = new FeedOutputService(db as unknown as D1Database);
  });

  describe('RSS 2.0 Generation', () => {
    it('should generate valid RSS 2.0 XML', async () => {
      const result = await service.generateFeed({ format: 'rss' });

      expect(result.contentType).toBe('application/rss+xml; charset=utf-8');
      expect(result.content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(result.content).toContain('<rss version="2.0"');
      expect(result.content).toContain('<channel>');
      expect(result.content).toContain('Mukoko News');
    });

    it('should include article items', async () => {
      const result = await service.generateFeed({ format: 'rss' });

      expect(result.content).toContain('<item>');
      expect(result.content).toContain('Zimbabwe Economy Grows');
      expect(result.content).toContain('Kenya Tech Hub Expands');
    });

    it('should include media:content for images', async () => {
      const result = await service.generateFeed({ format: 'rss' });

      expect(result.content).toContain('media:content');
      expect(result.content).toContain('images.example.com/econ.jpg');
    });

    it('should include Dublin Core creator', async () => {
      const result = await service.generateFeed({ format: 'rss' });

      expect(result.content).toContain('dc:creator');
      expect(result.content).toContain('John Moyo');
    });

    it('should include namespace declarations', async () => {
      const result = await service.generateFeed({ format: 'rss' });

      expect(result.content).toContain('xmlns:content=');
      expect(result.content).toContain('xmlns:dc=');
      expect(result.content).toContain('xmlns:media=');
      expect(result.content).toContain('xmlns:atom=');
    });

    it('should include atom:link self-reference', async () => {
      const result = await service.generateFeed({ format: 'rss' });

      expect(result.content).toContain('rel="self"');
      expect(result.content).toContain('type="application/rss+xml"');
    });
  });

  describe('Atom Generation', () => {
    it('should generate valid Atom XML', async () => {
      const result = await service.generateFeed({ format: 'atom' });

      expect(result.contentType).toBe('application/atom+xml; charset=utf-8');
      expect(result.content).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
      expect(result.content).toContain('<entry>');
    });

    it('should include article entries with URN IDs', async () => {
      const result = await service.generateFeed({ format: 'atom' });

      expect(result.content).toContain('urn:mukoko:article:art-1');
      expect(result.content).toContain('urn:mukoko:article:art-2');
    });

    it('should include published and updated dates', async () => {
      const result = await service.generateFeed({ format: 'atom' });

      expect(result.content).toContain('<published>');
      expect(result.content).toContain('<updated>');
    });
  });

  describe('JSON Feed Generation', () => {
    it('should generate valid JSON Feed', async () => {
      const result = await service.generateFeed({ format: 'json' });

      expect(result.contentType).toBe('application/feed+json; charset=utf-8');
      const feed = JSON.parse(result.content);
      expect(feed.version).toBe('https://jsonfeed.org/version/1.1');
      expect(feed.title).toContain('Mukoko News');
      expect(feed.items).toHaveLength(2);
    });

    it('should include article items with correct fields', async () => {
      const result = await service.generateFeed({ format: 'json' });
      const feed = JSON.parse(result.content);

      expect(feed.items[0].id).toBe('art-1');
      expect(feed.items[0].title).toBe('Zimbabwe Economy Grows');
      expect(feed.items[0].external_url).toBe('https://herald.co.zw/economy-grows');
      expect(feed.items[0]._mukoko.country_code).toBe('ZW');
    });

    it('should include Mukoko extension data', async () => {
      const result = await service.generateFeed({ format: 'json' });
      const feed = JSON.parse(result.content);

      expect(feed.items[0]._mukoko).toBeDefined();
      expect(feed.items[0]._mukoko.source_name).toBe('The Herald');
    });
  });

  describe('Caching Headers', () => {
    it('should include ETag', async () => {
      const result = await service.generateFeed({ format: 'rss' });
      expect(result.etag).toBeTruthy();
      expect(result.etag.startsWith('"')).toBe(true);
    });

    it('should include lastModified', async () => {
      const result = await service.generateFeed({ format: 'rss' });
      expect(result.lastModified).toBeTruthy();
    });

    it('should produce consistent ETags for same content', async () => {
      const result1 = await service.generateFeed({ format: 'rss' });
      const result2 = await service.generateFeed({ format: 'rss' });
      expect(result1.etag).toBe(result2.etag);
    });
  });

  describe('Filtering', () => {
    it('should pass country filter to query', async () => {
      await service.generateFeed({ format: 'rss', country: 'ZW' });

      const query = db.prepare.mock.calls[0][0] as string;
      expect(query).toContain('country_id');
    });

    it('should pass category filter to query', async () => {
      await service.generateFeed({ format: 'rss', category: 'politics' });

      const query = db.prepare.mock.calls[0][0] as string;
      expect(query).toContain('category');
    });
  });

  describe('XML Escaping', () => {
    it('should escape special characters in RSS', async () => {
      statement.all.mockResolvedValue({
        results: [{
          id: 'xss-1',
          title: 'Title with <script>alert("xss")</script>',
          description: 'Desc with & ampersand',
          content: 'Content',
          url: 'https://example.com',
          published_at: '2026-03-14T10:00:00Z',
          country_code: 'ZW',
          source_name: 'Test',
        }],
      });

      const result = await service.generateFeed({ format: 'rss' });

      expect(result.content).not.toContain('<script>');
      expect(result.content).toContain('&lt;script&gt;');
      expect(result.content).toContain('&amp; ampersand');
    });
  });
});
