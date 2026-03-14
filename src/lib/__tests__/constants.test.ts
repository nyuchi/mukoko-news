import { describe, it, expect } from 'vitest';
import { COUNTRIES, SECTION_META, getCategoryEmoji, BASE_URL, getArticleUrl, getFullUrl } from '../constants';

describe('COUNTRIES', () => {
  it('should have all 16 Pan-African countries', () => {
    expect(COUNTRIES).toHaveLength(16);
  });

  it('should have Zimbabwe as the first country (primary market)', () => {
    expect(COUNTRIES[0].code).toBe('ZW');
    expect(COUNTRIES[0].name).toBe('Zimbabwe');
  });

  it('should have required properties for each country', () => {
    COUNTRIES.forEach((country) => {
      expect(country).toHaveProperty('code');
      expect(country).toHaveProperty('name');
      expect(country).toHaveProperty('flag');
      expect(country).toHaveProperty('color');
      expect(country.code).toMatch(/^[A-Z]{2}$/);
      expect(country.flag).toBeTruthy();
      expect(country.color).toMatch(/^bg-/);
    });
  });

  it('should have unique country codes', () => {
    const codes = COUNTRIES.map((c) => c.code);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });

  it('should include key African markets', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(codes).toContain('ZW'); // Zimbabwe
    expect(codes).toContain('ZA'); // South Africa
    expect(codes).toContain('KE'); // Kenya
    expect(codes).toContain('NG'); // Nigeria
    expect(codes).toContain('GH'); // Ghana
  });
});

describe('SECTION_META', () => {
  it('should have emoji and color for common categories', () => {
    const commonCategories = ['politics', 'economy', 'technology', 'sports', 'health'];

    commonCategories.forEach((category) => {
      expect(SECTION_META[category]).toBeDefined();
      expect(SECTION_META[category].emoji).toBeTruthy();
      expect(SECTION_META[category].color).toMatch(/^bg-/);
    });
  });

  it('should have a fallback "all" category', () => {
    expect(SECTION_META['all']).toBeDefined();
    expect(SECTION_META['all'].emoji).toBe('📰');
  });
});

describe('getCategoryEmoji', () => {
  it('should return correct emoji for known categories', () => {
    expect(getCategoryEmoji('politics')).toBe('🏛️');
    expect(getCategoryEmoji('technology')).toBe('💻');
    expect(getCategoryEmoji('sports')).toBe('⚽');
  });

  it('should return default emoji for unknown categories', () => {
    expect(getCategoryEmoji('unknown-category')).toBe('📰');
    expect(getCategoryEmoji('random')).toBe('📰');
  });

  it('should return default emoji for empty or null input', () => {
    expect(getCategoryEmoji('')).toBe('📰');
  });

  it('should be case-insensitive', () => {
    expect(getCategoryEmoji('POLITICS')).toBe('🏛️');
    expect(getCategoryEmoji('Politics')).toBe('🏛️');
    expect(getCategoryEmoji('TECHNOLOGY')).toBe('💻');
  });
});

describe('BASE_URL', () => {
  it('should have a default base URL', () => {
    expect(BASE_URL).toBeTruthy();
    expect(BASE_URL).toMatch(/^https?:\/\//);
  });
});

describe('getArticleUrl', () => {
  it('should generate correct article URL', () => {
    const url = getArticleUrl('123');
    expect(url).toBe(`${BASE_URL}/article/123`);
  });

  it('should handle article IDs with special characters', () => {
    const url = getArticleUrl('abc-123-def');
    expect(url).toBe(`${BASE_URL}/article/abc-123-def`);
  });
});

describe('getFullUrl', () => {
  it('should generate full URL from path with leading slash', () => {
    const url = getFullUrl('/discover');
    expect(url).toBe(`${BASE_URL}/discover`);
  });

  it('should handle paths without leading slash', () => {
    const url = getFullUrl('discover');
    expect(url).toBe(`${BASE_URL}/discover`);
  });

  it('should handle paths with query parameters', () => {
    const url = getFullUrl('/discover?category=politics');
    expect(url).toBe(`${BASE_URL}/discover?category=politics`);
  });

  it('should handle root path', () => {
    const url = getFullUrl('/');
    expect(url).toBe(`${BASE_URL}/`);
  });
});

// ─── Security: URL utility injection & path traversal tests ─────────────
describe('getArticleUrl - security', () => {
  it('should preserve path traversal sequences in article ID (no server-side resolution)', () => {
    // These are string-concatenated, so traversal chars stay literal
    const url = getArticleUrl('../../etc/passwd');
    expect(url).toBe(`${BASE_URL}/article/../../etc/passwd`);
    // Important: the base URL is always prepended, no origin escaping
    expect(url.startsWith(BASE_URL)).toBe(true);
  });

  it('should handle script injection in article ID', () => {
    const url = getArticleUrl('<script>alert(1)</script>');
    // URL is string concatenation; < > stay literal (escaped at render time by React)
    expect(url).toBe(`${BASE_URL}/article/<script>alert(1)</script>`);
    expect(url.startsWith(BASE_URL)).toBe(true);
  });

  it('should always start with BASE_URL regardless of input', () => {
    const inputs = [
      '123',
      '../../../admin',
      'javascript:alert(1)',
      '//evil.com/steal',
      '\n\r<script>',
    ];
    for (const input of inputs) {
      expect(getArticleUrl(input).startsWith(BASE_URL)).toBe(true);
    }
  });
});

describe('getFullUrl - security', () => {
  it('should always start with BASE_URL regardless of path', () => {
    const paths = [
      '/normal',
      '//evil.com',
      '/../../../etc/passwd',
      'javascript:alert(1)',
      '\n\r<script>alert(1)</script>',
    ];
    for (const path of paths) {
      expect(getFullUrl(path).startsWith(BASE_URL)).toBe(true);
    }
  });

  it('should normalize paths without leading slash', () => {
    expect(getFullUrl('discover')).toBe(`${BASE_URL}/discover`);
    expect(getFullUrl('admin/settings')).toBe(`${BASE_URL}/admin/settings`);
  });

  it('should handle protocol-relative path (//evil.com)', () => {
    // getFullUrl prepends BASE_URL, so //evil.com becomes BASE_URL//evil.com
    const url = getFullUrl('//evil.com');
    expect(url.startsWith(BASE_URL)).toBe(true);
    // The result won't resolve to evil.com when used as a relative link on the page
  });

  it('should handle empty path', () => {
    const url = getFullUrl('');
    // Empty path normalizes to /
    expect(url).toBe(`${BASE_URL}/`);
  });
});

describe('BASE_URL - security invariants', () => {
  it('should use HTTPS protocol', () => {
    expect(BASE_URL).toMatch(/^https:\/\//);
  });

  it('should not end with a trailing slash', () => {
    expect(BASE_URL).not.toMatch(/\/$/);
  });

  it('should be a valid URL', () => {
    expect(() => new URL(BASE_URL)).not.toThrow();
  });
});
