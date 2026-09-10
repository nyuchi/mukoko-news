import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { COUNTRY_SCOPE_TOTAL } from '@/lib/constants';

/**
 * A live count that is deliberately not the production figure — see the
 * sitemap suite for the same reasoning. If the markdown ignored the read and
 * fell back to a constant, a fixture equal to the real number would hide it.
 */
const LIVE_COUNT = 23;

import { GET as protectedResource } from '../.well-known/oauth-protected-resource/route';
import { GET as authServer } from '../.well-known/oauth-authorization-server/route';
import { GET as authMd } from '../auth.md/route';

const { mockGetArticle, mockGetArticles } = vi.hoisted(() => ({
  mockGetArticle: vi.fn(),
  mockGetArticles: vi.fn(),
}));

vi.mock('@/lib/actions/coverage', () => ({
  getLiveCoverageAction: async () => ({
    codes: [],
    count: LIVE_COUNT,
    scopeTotal: COUNTRY_SCOPE_TOTAL,
    fragment: `live in ${LIVE_COUNT} African countries, with all ${COUNTRY_SCOPE_TOTAL} in scope`,
    claim: `Live in ${LIVE_COUNT} African countries, with all ${COUNTRY_SCOPE_TOTAL} African Union member states in scope — the rest are coming soon.`,
    stale: false,
  }),
}));

vi.mock('@/lib/actions/feed', () => ({
  getArticleAction: mockGetArticle,
  getArticlesAction: mockGetArticles,
  searchArticlesAction: vi.fn(),
}));

describe('MCP server card (/.well-known/mcp/server-card.json)', () => {
  // No longer a static file: it states the coverage claim, which is a live
  // count now, so it is rendered per request through the same action as every
  // other surface. The test moved with it — reading `public/` would now assert
  // against a file that must NOT exist, since one there would shadow the route.
  it('is valid JSON exposing serverInfo, the MCP transport endpoint and tool capability', async () => {
    const { GET: serverCard } = await import('../.well-known/mcp/server-card.json/route');
    const body = await (await serverCard()).json();
    expect(body.serverInfo.name).toBe('mukoko-news');
    expect(body.serverInfo.version).toBeTruthy();
    expect(body.transport.endpoint).toBe('https://news.mukoko.dev/mcp');
    expect(body.capabilities.tools).toBe(true);
  });

  it('states the live coverage claim rather than a baked-in number', async () => {
    const { GET: serverCard } = await import('../.well-known/mcp/server-card.json/route');
    const body = await (await serverCard()).json();
    expect(body.serverInfo.description).toContain(String(LIVE_COUNT));
    expect(body.serverInfo.description).toContain(String(COUNTRY_SCOPE_TOTAL));
  });
});

describe('OAuth discovery metadata', () => {
  it('protected-resource lists a resource + authorization server', async () => {
    const body = await protectedResource().json();
    expect(body.resource).toBe('https://news.mukoko.com');
    expect(body.authorization_servers).toContain('https://identity.nyuchi.com');
    expect(Array.isArray(body.scopes_supported)).toBe(true);
  });

  it('authorization-server mirrors the WorkOS issuer + endpoints', async () => {
    const body = await authServer().json();
    expect(body.issuer).toBe('https://identity.nyuchi.com');
    expect(body.authorization_endpoint).toBe('https://identity.nyuchi.com/oauth/authorize');
    expect(body.token_endpoint).toBe('https://identity.nyuchi.com/oauth/token');
    expect(body.code_challenge_methods_supported).toContain('S256');
  });
});

describe('auth.md', () => {
  it('serves markdown with the required auth.md H1', async () => {
    const res = authMd();
    expect(res.headers.get('content-type')).toContain('text/markdown');
    const text = await res.text();
    expect(text).toMatch(/^# auth\.md/m);
    expect(text).toContain('identity.nyuchi.com');
  });
});

describe('Markdown for Agents (/api/agent-md)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an article as markdown with a title and body', async () => {
    const { GET } = await import('../api/agent-md/route');
    mockGetArticle.mockResolvedValue({
      id: 'a1',
      title: 'Big Story',
      source: 'Herald',
      published_at: '2026-07-03',
      content_markdown: '## Section\n\nBody text.',
      original_url: 'https://herald.co.zw/big-story',
    });
    const req = new NextRequest('https://news.mukoko.com/api/agent-md?path=/article/a1');
    const res = await GET(req);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    const text = await res.text();
    expect(text).toContain('# Big Story');
    expect(text).toContain('Body text.');
    expect(text).toContain('herald.co.zw/big-story');
    expect(res.headers.get('x-markdown-tokens')).toBeTruthy();
  });

  it('renders the homepage as a markdown headline index', async () => {
    const { GET } = await import('../api/agent-md/route');
    mockGetArticles.mockResolvedValue({
      articles: [{ id: 'a1', title: 'One', source: 'Herald', published_at: '2026-07-03' }],
      total: 1,
    });
    const req = new NextRequest('https://news.mukoko.com/api/agent-md?path=/');
    const text = await (await GET(req)).text();
    expect(text).toContain('# Mukoko News');
    expect(text).toContain('- [One]');
  });

  it('404s an unknown article', async () => {
    const { GET } = await import('../api/agent-md/route');
    mockGetArticle.mockResolvedValue(null);
    const req = new NextRequest('https://news.mukoko.com/api/agent-md?path=/article/missing');
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  /**
   * This endpoint used to serve the publisher's COMPLETE body under a "Read on
   * Mukoko News" link listed above "Original source" — an agent could satisfy a
   * reader end-to-end without the newsroom ever being fetched, from a document
   * whose link order said the aggregator was the destination.
   */
  it('serves an excerpt, not the publisher\'s full text', async () => {
    const { GET } = await import('../api/agent-md/route');
    const fullBody = Array.from({ length: 300 }, (_, i) => `paragraph ${i} of real reporting`).join('. ');
    mockGetArticle.mockResolvedValue({
      id: 'a1',
      title: 'Big Story',
      source: 'Herald',
      published_at: '2026-07-03',
      content: fullBody,
      original_url: 'https://herald.co.zw/big-story',
    });
    const req = new NextRequest('https://news.mukoko.com/api/agent-md?path=/article/a1');
    const text = await (await GET(req)).text();

    expect(text).not.toContain(fullBody);
    expect(text).not.toContain(fullBody.slice(-80)); // the tail never ships
    expect(text).toContain(fullBody.slice(0, 60)); // the opening does
    expect(text).toContain('Excerpt only.');
  });

  it('links the publisher first and labels it as the full article', async () => {
    const { GET } = await import('../api/agent-md/route');
    mockGetArticle.mockResolvedValue({
      id: 'a1',
      title: 'Big Story',
      source: 'Herald',
      published_at: '2026-07-03',
      content: 'Short body.',
      original_url: 'https://herald.co.zw/big-story',
    });
    const req = new NextRequest('https://news.mukoko.com/api/agent-md?path=/article/a1');
    const text = await (await GET(req)).text();

    const publisherLink = text.indexOf('https://herald.co.zw/big-story');
    const mukokoLink = text.indexOf('/article/a1');
    expect(publisherLink).toBeGreaterThan(-1);
    expect(mukokoLink).toBeGreaterThan(-1);
    expect(publisherLink).toBeLessThan(mukokoLink);
    expect(text).toContain('Read the full article at Herald');
  });

  it('still links Mukoko when the article has no original URL', async () => {
    const { GET } = await import('../api/agent-md/route');
    mockGetArticle.mockResolvedValue({
      id: 'a1',
      title: 'Big Story',
      source: 'Herald',
      published_at: '2026-07-03',
      content: 'Short body.',
    });
    const req = new NextRequest('https://news.mukoko.com/api/agent-md?path=/article/a1');
    const text = await (await GET(req)).text();
    expect(text).toContain('/article/a1');
  });

  it('states the 54-in-scope / 16-live coverage claim on the index', async () => {
    const { GET } = await import('../api/agent-md/route');
    mockGetArticles.mockResolvedValue({
      articles: [{ id: 'a1', title: 'One', source: 'Herald', published_at: '2026-07-03' }],
      total: 1,
    });
    const req = new NextRequest('https://news.mukoko.com/api/agent-md?path=/');
    const text = await (await GET(req)).text();
    expect(text).toContain(String(LIVE_COUNT));
    expect(text).toContain(String(COUNTRY_SCOPE_TOTAL));
    expect(text.toLowerCase()).toContain('coming soon');
  });
});
