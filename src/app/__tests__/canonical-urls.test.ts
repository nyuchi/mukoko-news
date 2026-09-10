import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// App Router merges metadata per top-level field, so an `alternates` object set
// on the root layout is emitted verbatim on every route that does not declare
// its own. That is how /about, /topic/[slug] and /publishers/claim came to
// render <link rel="canonical" href="https://news.mukoko.com/"> and tell Google
// they were duplicates of the homepage. These tests pin the fix.

const { mockGetArticleById } = vi.hoisted(() => ({ mockGetArticleById: vi.fn() }));
vi.mock('@/lib/mongodb/articles', () => ({
  getArticleById: mockGetArticleById,
  getArticles: vi.fn(),
}));
// The root layout and the claim page pull in AuthKit / client components that
// do not resolve under the jsdom test runtime; neither is what we're asserting.
vi.mock('@workos-inc/authkit-nextjs/components', () => ({
  AuthKitProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/components/publisher/publisher-claim-form', () => ({
  PublisherClaimForm: () => null,
}));
vi.mock('@/lib/actions/feed', () => ({
  getTopicTimelineAction: vi.fn(),
  getSectionedFeedAction: vi.fn(),
  getCategoriesAction: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe('root layout does not leak a canonical to every route', () => {
  // Asserted against the source rather than the module: importing the root
  // layout pulls the whole AuthKit server chain, which does not resolve under
  // jsdom. The property we care about is syntactic anyway — a canonical must
  // not be declared at the root, because every route inherits it.
  it('declares no alternates.canonical', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf-8');
    const withoutComments = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toMatch(/alternates\s*:/);
  });
});

describe('routes that previously inherited the homepage canonical', () => {
  it('/ declares its own canonical', async () => {
    const { metadata } = await import('../page');
    expect(String(metadata.alternates?.canonical)).toBe('https://news.mukoko.com');
  });

  it('/about declares its own canonical', async () => {
    const { metadata } = await import('../about/layout');
    expect(String(metadata.alternates?.canonical)).toBe('https://news.mukoko.com/about');
  });

  it('/publishers/claim declares its own canonical', async () => {
    const { metadata } = await import('../publishers/claim/page');
    expect(String(metadata.alternates?.canonical)).toBe(
      'https://news.mukoko.com/publishers/claim'
    );
  });

  it('/topic/[slug] canonicalises to itself, not the homepage', async () => {
    const { generateMetadata } = await import('../topic/[slug]/page');
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: 'zimbabwe-elections' }),
    });
    expect(String(meta.alternates?.canonical)).toBe(
      'https://news.mukoko.com/topic/zimbabwe-elections'
    );
  });

  it('/topic/[slug] does not double-encode an escaped slug', async () => {
    const { generateMetadata } = await import('../topic/[slug]/page');
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: 'cote%20d%27ivoire' }),
    });
    expect(String(meta.alternates?.canonical)).toBe(
      'https://news.mukoko.com/topic/cote%20d%27ivoire'
    );
  });
});

describe('article route: missing vs unavailable', () => {
  it('marks an unresolvable article noindex instead of index,follow', async () => {
    mockGetArticleById.mockResolvedValue(null);
    const { generateMetadata } = await import('../article/[id]/page');
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'nope' }) });
    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });

  it('marks an article noindex when the read throws, rather than claiming it is live', async () => {
    mockGetArticleById.mockRejectedValue(new Error('mongo down'));
    const { generateMetadata } = await import('../article/[id]/page');
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'boom' }) });
    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });

  it('canonicalises a real article to its own URL', async () => {
    mockGetArticleById.mockResolvedValue({
      id: 'abc123',
      title: 'A headline',
      description: 'desc',
      source: 'The Herald',
      published_at: '2026-09-01T00:00:00.000Z',
      image_url: 'https://example.com/i.jpg',
    });
    const { generateMetadata } = await import('../article/[id]/page');
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'abc123' }) });
    expect(String(meta.alternates?.canonical)).toBe('https://news.mukoko.com/article/abc123');
    expect(meta.robots).toMatchObject({ index: true });
  });
});

describe('sitemap covers the indexable static surfaces', () => {
  it('lists /about, /sources and /analytics', async () => {
    const sitemap = (await import('../sitemap')).default;
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls).toContain('https://news.mukoko.com/about');
    expect(urls).toContain('https://news.mukoko.com/sources');
    expect(urls).toContain('https://news.mukoko.com/analytics');
  });
});
