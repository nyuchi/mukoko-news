/**
 * `/article/[id]` — the `missing` vs `unavailable` distinction.
 *
 * `canonical-urls.test.ts` pins the metadata half (both non-ok states are
 * noindex). This pins the half that decides the HTTP STATUS, which is the
 * riskier of the two and the reason the fix was not a one-liner:
 *
 *   - a genuinely unresolvable id MUST 404, or every dead article id stays in
 *     Google's index as a thin duplicate of the homepage;
 *   - a MongoDB read FAILURE must NOT 404, or a few seconds of cluster trouble
 *     answers 404 for every live article at once and hands Google a deindex
 *     signal for the whole corpus.
 *
 * Collapsing the two states back into one boolean is the obvious "simplification"
 * a future edit would make, and nothing else in the suite would notice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

const { mockGetArticleById, mockNotFound } = vi.hoisted(() => ({
  mockGetArticleById: vi.fn(),
  mockNotFound: vi.fn(() => {
    // The real `notFound()` throws to unwind into the 404 boundary. Preserving
    // that is what makes "did it render the shell anyway?" answerable.
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/mongodb/articles', () => ({ getArticleById: mockGetArticleById }));
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('../[id]/article-detail-client', () => ({ default: () => null }));

/** The props the page handed to the detail client. */
type ShellProps = { articleId: string; initialArticle: { id: string } | null };
const shellProps = (rendered: unknown) => (rendered as ReactElement<ShellProps>).props;

let page: (props: { params: Promise<{ id: string }> }) => Promise<unknown>;
let generateMetadata: (props: { params: Promise<{ id: string }> }) => Promise<{
  openGraph?: { images?: Array<{ url: string }> };
  twitter?: { card?: string; images?: string[] };
  description?: string;
  authors?: unknown;
}>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const mod = await import('../[id]/page');
  page = mod.default as typeof page;
  generateMetadata = mod.generateMetadata as typeof generateMetadata;
});

const article = (over: Record<string, unknown> = {}) => ({
  id: 'live-1',
  title: 'Cyclone warning issued for Manicaland',
  description: 'The Meteorological Services Department has issued a warning.',
  source: 'The Herald',
  published_at: '2026-09-01T06:00:00.000Z',
  image_url: 'https://cdn.example.com/cyclone.jpg',
  ...over,
});

describe('an id that resolves to nothing', () => {
  it('answers a real 404 rather than a 200 shell', async () => {
    mockGetArticleById.mockResolvedValue(null);

    await expect(page({ params: Promise.resolve({ id: 'gone-1' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    expect(mockNotFound).toHaveBeenCalled();
  });
});

describe('a read that fails', () => {
  it('renders the existing shell instead of 404ing every live article at once', async () => {
    mockGetArticleById.mockRejectedValue(new Error('no primary available'));

    const props = shellProps(await page({ params: Promise.resolve({ id: 'outage-1' }) }));

    expect(mockNotFound).not.toHaveBeenCalled();
    // The shell still receives the id, so the client can retry the fetch —
    // a transient failure degrades rather than deindexes.
    expect(props.articleId).toBe('outage-1');
    expect(props.initialArticle).toBeNull();
  });
});

describe('an article that resolves', () => {
  it('hands the server-read article straight to the client component', async () => {
    mockGetArticleById.mockResolvedValue(article({ id: 'ok-1' }));

    const props = shellProps(await page({ params: Promise.resolve({ id: 'ok-1' }) }));

    expect(mockNotFound).not.toHaveBeenCalled();
    expect(props.initialArticle?.id).toBe('ok-1');
  });
});

describe('social card metadata', () => {
  it('uses the article image only when it passes URL validation', async () => {
    // The image URL is publisher-controlled. `isValidImageUrl` blocks
    // javascript:/data:/blob: — a `summary_large_image` card pointed at one of
    // those is a hostile URL republished under the Mukoko brand.
    mockGetArticleById.mockResolvedValue(
      article({ id: 'evil-1', image_url: 'javascript:alert(1)' })
    );

    const meta = await generateMetadata({ params: Promise.resolve({ id: 'evil-1' }) });

    expect(meta.openGraph?.images?.[0].url).toContain('/mukoko-icon-dark.png');
    expect(meta.twitter?.card).toBe('summary');
    expect(meta.twitter?.images).toBeUndefined();
  });

  it('upgrades to a large image card when the image is safe', async () => {
    mockGetArticleById.mockResolvedValue(article({ id: 'img-1' }));

    const meta = await generateMetadata({ params: Promise.resolve({ id: 'img-1' }) });

    expect(meta.twitter?.card).toBe('summary_large_image');
    expect(meta.openGraph?.images?.[0].url).toBe('https://cdn.example.com/cyclone.jpg');
  });

  it('synthesises a description when the publisher supplied none', async () => {
    // An article with no description is the common case for a stub RSS feed.
    // An empty meta description is a blank search-result snippet.
    mockGetArticleById.mockResolvedValue(article({ id: 'nodesc-1', description: undefined }));

    const meta = await generateMetadata({ params: Promise.resolve({ id: 'nodesc-1' }) });

    expect(meta.description).toContain('Cyclone warning issued for Manicaland');
    expect(meta.description).toContain('The Herald');
  });

  it('omits the author block when there is no source to attribute', async () => {
    mockGetArticleById.mockResolvedValue(article({ id: 'nosrc-1', source: '' }));

    const meta = await generateMetadata({ params: Promise.resolve({ id: 'nosrc-1' }) });

    expect(meta.authors).toBeUndefined();
  });
});
