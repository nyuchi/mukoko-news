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
 *
 * ## The Suspense split (2026-09-17)
 *
 * The route now awaits a CHEAP `articleExists` and then streams the article
 * from inside `<Suspense>`. The order is the whole point: everything above the
 * boundary decides the status line, everything inside it is already too late —
 * a `loading.tsx` above this page is what made the `notFound()` below answer
 * `200` in production. So these tests reach THROUGH the boundary rather than
 * around it, and one of them asserts that the expensive read has not happened
 * yet when the boundary is returned.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

const { mockGetArticleById, mockArticleExists, mockNotFound } = vi.hoisted(() => ({
  mockGetArticleById: vi.fn(),
  mockArticleExists: vi.fn(),
  mockNotFound: vi.fn(() => {
    // The real `notFound()` throws to unwind into the 404 boundary. Preserving
    // that is what makes "did it render the shell anyway?" answerable.
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/mongodb/articles', () => ({
  getArticleById: mockGetArticleById,
  articleExists: mockArticleExists,
}));
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('../[id]/article-detail-client', () => ({ default: () => null }));

/** The props the page handed to the detail client. */
type ShellProps = { articleId: string; initialArticle: { id: string } | null };

/** The `<ArticleBody>` element the page suspended on, still unresolved. */
function suspendedBody(rendered: unknown) {
  const boundary = rendered as ReactElement<{ children: ReactElement<{ id: string }> }>;
  return boundary.props.children;
}

/**
 * Resolve the streamed half and read what it handed the client component.
 *
 * `ArticleBody` is an async Server Component, so it is called rather than
 * rendered — there is no renderer in this suite and none is needed to assert on
 * the props it produces.
 */
async function shellProps(rendered: unknown): Promise<ShellProps> {
  const body = suspendedBody(rendered);
  const resolve = body.type as (props: { id: string }) => Promise<ReactElement<ShellProps>>;
  return (await resolve(body.props)).props;
}

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
    mockArticleExists.mockResolvedValue(false);

    await expect(page({ params: Promise.resolve({ id: 'gone-1' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('decides that from the CHEAP read, before the boundary', async () => {
    // The whole reason the route reads twice. `articleExists` is a covered
    // `_id` projection; `getArticleById` is the document plus two joins. If a
    // future edit reaches for the expensive one to answer "does it exist", the
    // status decision moves behind the wait it was split out to avoid.
    mockArticleExists.mockResolvedValue(false);

    await expect(page({ params: Promise.resolve({ id: 'gone-2' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    expect(mockArticleExists).toHaveBeenCalledWith('gone-2');
    expect(mockGetArticleById).not.toHaveBeenCalled();
  });
});

describe('the existence check itself failing', () => {
  it('renders the shell rather than 404ing on an unknown', async () => {
    // `null` is "we could not look". A 404 here would deindex a live article
    // on the strength of an outage — the same rule the read below follows.
    mockArticleExists.mockResolvedValue(null);
    mockGetArticleById.mockRejectedValue(new Error('no primary available'));

    const props = await shellProps(await page({ params: Promise.resolve({ id: 'blind-1' }) }));

    expect(mockNotFound).not.toHaveBeenCalled();
    expect(props.initialArticle).toBeNull();
  });
});

describe('the expensive read', () => {
  it('has not run by the time the boundary is returned', async () => {
    // This is the streaming property, asserted structurally: the page returns a
    // `<Suspense>` whose child has not been resolved, so the shell (and the
    // status line) can go out while the document and its two joins are still in
    // flight. Await the page body above the boundary and this fails.
    mockArticleExists.mockResolvedValue(true);
    mockGetArticleById.mockResolvedValue(article({ id: 'stream-1' }));

    const rendered = await page({ params: Promise.resolve({ id: 'stream-1' }) });

    expect(mockGetArticleById).not.toHaveBeenCalled();
    // ...and it is genuinely the article that is suspended, not a stub.
    expect(suspendedBody(rendered).props.id).toBe('stream-1');
    await shellProps(rendered);
    expect(mockGetArticleById).toHaveBeenCalledWith('stream-1');
  });

  it('falls back to the article skeleton, which carries the spinner', async () => {
    // The skeleton is why the boundary is in the page at all rather than in a
    // `loading.tsx` — that file streamed the 200 along with it.
    mockArticleExists.mockResolvedValue(true);
    mockGetArticleById.mockResolvedValue(article({ id: 'fallback-1' }));

    const rendered = (await page({ params: Promise.resolve({ id: 'fallback-1' }) })) as ReactElement<{
      fallback: ReactElement;
    }>;

    expect(rendered.props.fallback).toBeTruthy();
    const { container } = render(rendered.props.fallback);
    expect(container.querySelector('.mukoko-spinner')).not.toBeNull();
    expect(screen.getByLabelText('Loading article')).toBeInTheDocument();
  });
});

describe('a read that fails', () => {
  it('renders the existing shell instead of 404ing every live article at once', async () => {
    mockArticleExists.mockResolvedValue(true);
    mockGetArticleById.mockRejectedValue(new Error('no primary available'));

    const props = await shellProps(await page({ params: Promise.resolve({ id: 'outage-1' }) }));

    expect(mockNotFound).not.toHaveBeenCalled();
    // The shell still receives the id, so the client can retry the fetch —
    // a transient failure degrades rather than deindexes.
    expect(props.articleId).toBe('outage-1');
    expect(props.initialArticle).toBeNull();
  });
});

describe('an article that resolves', () => {
  it('hands the server-read article straight to the client component', async () => {
    mockArticleExists.mockResolvedValue(true);
    mockGetArticleById.mockResolvedValue(article({ id: 'ok-1' }));

    const props = await shellProps(await page({ params: Promise.resolve({ id: 'ok-1' }) }));

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
