import { describe, it, expect } from 'vitest';
import { classifyRequest, isArticlePath, ASSETS_IMAGE_ORIGIN } from '@/lib/pwa/sw-policy';

const ORIGIN = 'https://news.mukoko.com';

function classify(
  url: string,
  overrides: Partial<Parameters<typeof classifyRequest>[0]> = {}
) {
  return classifyRequest({
    url,
    method: 'GET',
    swOrigin: ORIGIN,
    ...overrides,
  });
}

describe('classifyRequest', () => {
  describe('never-handle exclusions', () => {
    it('ignores non-GET methods', () => {
      expect(classify(`${ORIGIN}/article/abc`, { method: 'POST', mode: 'navigate' })).toBeNull();
      expect(classify(`${ORIGIN}/_next/static/chunk.js`, { method: 'PUT' })).toBeNull();
      expect(classify(`${ORIGIN}/_next/static/chunk.js`, { method: 'HEAD' })).toBeNull();
    });

    it('ignores requests carrying an Authorization header', () => {
      expect(
        classify(`${ORIGIN}/article/abc`, { mode: 'navigate', hasAuthorization: true })
      ).toBeNull();
    });

    it('ignores /api/*, /auth/*, /admin*, /sign-in, and /mcp', () => {
      for (const path of [
        '/api/articles/1/like',
        '/api/health',
        '/auth/callback',
        '/admin',
        '/admin/sources',
        '/sign-in',
        '/mcp',
      ]) {
        expect(classify(`${ORIGIN}${path}`, { mode: 'navigate' })).toBeNull();
      }
    });

    it('does not over-match excluded prefixes on longer path segments', () => {
      // /administrator etc. is a normal (404) navigation, not an exclusion
      expect(classify(`${ORIGIN}/apiary`, { mode: 'navigate' })).toBe('navigation');
      expect(classify(`${ORIGIN}/administrator`, { mode: 'navigate' })).toBe('navigation');
    });

    it('ignores cross-origin requests that are not article images', () => {
      expect(classify('https://example.com/page', { mode: 'navigate' })).toBeNull();
      expect(classify('https://assets.example.com/i/photo.jpg')).toBeNull();
      // assets.mukoko.com but outside /i/
      expect(classify(`${ASSETS_IMAGE_ORIGIN}/other/photo.jpg`)).toBeNull();
    });

    it('ignores same-origin subresource fetches (e.g. RSC payloads, /_next/image)', () => {
      expect(classify(`${ORIGIN}/discover?_rsc=abc`)).toBeNull();
      expect(classify(`${ORIGIN}/_next/image?url=%2Ffoo.png&w=640&q=75`)).toBeNull();
    });

    it('ignores unparseable URLs', () => {
      expect(classify('not a url', { mode: 'navigate' })).toBeNull();
    });
  });

  describe('static assets', () => {
    it('classifies /_next/static/* as static-asset', () => {
      expect(classify(`${ORIGIN}/_next/static/chunks/main-abc123.js`)).toBe('static-asset');
      expect(classify(`${ORIGIN}/_next/static/css/app.css`)).toBe('static-asset');
    });
  });

  describe('navigations', () => {
    it('classifies top-level page loads as navigation', () => {
      for (const path of ['/', '/discover', '/insights', '/search?q=harare', '/article/abc123']) {
        expect(classify(`${ORIGIN}${path}`, { mode: 'navigate' })).toBe('navigation');
      }
    });

    it('requires navigate mode for pages', () => {
      expect(classify(`${ORIGIN}/article/abc123`)).toBeNull();
      expect(classify(`${ORIGIN}/article/abc123`, { mode: 'cors' })).toBeNull();
    });
  });

  describe('article images', () => {
    it('classifies assets.mukoko.com/i/* as image', () => {
      expect(classify(`${ASSETS_IMAGE_ORIGIN}/i/abc/photo.jpg`)).toBe('image');
    });

    it('still excludes non-GET image requests', () => {
      expect(classify(`${ASSETS_IMAGE_ORIGIN}/i/abc/photo.jpg`, { method: 'POST' })).toBeNull();
    });
  });
});

describe('isArticlePath', () => {
  it('matches exactly /article/{id}', () => {
    expect(isArticlePath('/article/abc123')).toBe(true);
    expect(isArticlePath('/article/65f0c9')).toBe(true);
  });

  it('rejects sub-routes, the bare prefix, and other pages', () => {
    expect(isArticlePath('/article')).toBe(false);
    expect(isArticlePath('/article/')).toBe(false);
    expect(isArticlePath('/article/abc/comments')).toBe(false);
    expect(isArticlePath('/discover')).toBe(false);
  });
});
