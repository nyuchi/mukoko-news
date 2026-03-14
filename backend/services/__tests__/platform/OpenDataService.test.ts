import { describe, it, expect, beforeEach } from 'vitest';
import { OpenDataService, MANIFESTO } from '../../platform/OpenDataService.js';
import { createMockD1 } from '../helpers.js';

describe('OpenDataService', () => {
  let service: OpenDataService;
  let db: ReturnType<typeof createMockD1>['db'];
  let statement: ReturnType<typeof createMockD1>['statement'];

  beforeEach(() => {
    ({ db, statement } = createMockD1());
    service = new OpenDataService(db as unknown as D1Database);
  });

  describe('Manifesto', () => {
    it('should return the open data manifesto', () => {
      const manifesto = service.getManifesto();

      expect(manifesto.version).toBe('1.0');
      expect(manifesto.organization).toBe('Mukoko News');
      expect(manifesto.license).toContain('CC BY 4.0');
      expect(manifesto.commitment).toContain('free flow of information');
      expect(manifesto.commitment).toContain('Africa');
    });

    it('should define all data categories', () => {
      const manifesto = service.getManifesto();

      const categoryNames = manifesto.dataCategories.map(c => c.name);
      expect(categoryNames).toContain('Articles');
      expect(categoryNames).toContain('Sources');
      expect(categoryNames).toContain('Categories');
      expect(categoryNames).toContain('Keywords/Tags');
      expect(categoryNames).toContain('Aggregate Analytics');
      expect(categoryNames).toContain('Countries');
    });

    it('should define privacy boundaries', () => {
      const manifesto = service.getManifesto();

      expect(manifesto.privacyBoundaries.length).toBeGreaterThan(0);
      const categories = manifesto.privacyBoundaries.map(b => b.category);
      expect(categories).toContain('User Identifiers');
      expect(categories).toContain('Authentication');
      expect(categories).toContain('User Behavior');
      expect(categories).toContain('Location Data');
      expect(categories).toContain('Device Information');
    });

    it('should define access methods', () => {
      const manifesto = service.getManifesto();

      const types = manifesto.accessMethods.map(a => a.type);
      expect(types).toContain('api');
      expect(types).toContain('feed');
      expect(types).toContain('replication');
      expect(types).toContain('stream');
      expect(types).toContain('export');
    });
  });

  describe('getArticles', () => {
    it('should return PII-free article data', async () => {
      statement.all.mockResolvedValue({
        results: [
          {
            id: 'art-1',
            title: 'Test Article',
            description: 'Description',
            url: 'https://example.com',
            image_url: null,
            author: 'Author',
            published_at: '2026-03-14T00:00:00Z',
            source_id: 'src-1',
            country_code: 'ZW',
            quality_score: 80,
            views: 100,
            likes: 10,
            saves: 5,
            shares: 3,
          },
        ],
      });

      const result = await service.getArticles();

      expect(result.data).toHaveLength(1);
      expect(result.metadata.license).toBe('CC BY 4.0');
      expect(result.metadata.attribution).toContain('Mukoko News');

      // Should NOT contain PII fields
      const article = result.data[0] as Record<string, unknown>;
      expect(article).not.toHaveProperty('user_id');
      expect(article).not.toHaveProperty('email');
      expect(article).not.toHaveProperty('ip_address');
    });

    it('should support cursor-based pagination', async () => {
      statement.all.mockResolvedValue({ results: [] });

      await service.getArticles({ cursor: 'last-id-123' });

      const query = db.prepare.mock.calls[0][0] as string;
      expect(query).toContain('id > ?');
    });

    it('should support country filtering', async () => {
      statement.all.mockResolvedValue({ results: [] });

      await service.getArticles({ country: 'ZW' });

      const query = db.prepare.mock.calls[0][0] as string;
      expect(query).toContain('country_id');
    });

    it('should limit results', async () => {
      statement.all.mockResolvedValue({ results: [] });

      await service.getArticles({ limit: 50 });

      expect(statement.bind).toHaveBeenCalledWith(50);
    });
  });

  describe('CSV Export', () => {
    it('should format data as CSV', () => {
      const data = [
        { id: '1', title: 'Article One', views: 100 },
        { id: '2', title: 'Article Two', views: 200 },
      ];

      const csv = service.formatAsCSV(data);
      const lines = csv.split('\n');

      expect(lines[0]).toBe('id,title,views');
      expect(lines[1]).toBe('1,Article One,100');
      expect(lines[2]).toBe('2,Article Two,200');
    });

    it('should escape CSV special characters', () => {
      const data = [
        { id: '1', title: 'Article with, comma', note: 'Has "quotes"' },
      ];

      const csv = service.formatAsCSV(data);
      expect(csv).toContain('"Article with, comma"');
      expect(csv).toContain('"Has ""quotes"""');
    });

    it('should return empty string for empty data', () => {
      expect(service.formatAsCSV([])).toBe('');
    });
  });

  describe('JSONL Export', () => {
    it('should format data as newline-delimited JSON', () => {
      const data = [
        { id: '1', title: 'Article One' },
        { id: '2', title: 'Article Two' },
      ];

      const jsonl = service.formatAsJSONL(data);
      const lines = jsonl.split('\n');

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).id).toBe('1');
      expect(JSON.parse(lines[1]).id).toBe('2');
    });
  });

  describe('MANIFESTO constant', () => {
    it('should have correct static values', () => {
      expect(MANIFESTO.version).toBe('1.0');
      expect(MANIFESTO.organization).toBe('Mukoko News');
      expect(MANIFESTO.dataCategories.length).toBe(6);
      expect(MANIFESTO.privacyBoundaries.length).toBe(5);
      expect(MANIFESTO.accessMethods.length).toBe(5);
    });
  });
});
