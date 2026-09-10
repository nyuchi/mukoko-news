import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { mockGetAuthorPageAction, mockNotFound } = vi.hoisted(() => ({
  mockGetAuthorPageAction: vi.fn(),
  mockNotFound: vi.fn(() => {
    // The real `notFound()` throws to unwind into the 404 boundary. Keeping that
    // is what makes "did it render the page anyway?" an answerable question.
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/actions/authors', () => ({ getAuthorPageAction: mockGetAuthorPageAction }));
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('@/components/compact-card', () => ({
  CompactCard: ({ article }: { article: { title: string } }) => <li>{article.title}</li>,
}));

import AuthorRoute, { generateMetadata } from '../[...slug]/page';

const PROFILE = {
  total: 323,
  firstPublished: '2026-06-20T12:10:45.000Z',
  lastPublished: '2026-09-08T05:19:29.000Z',
  sources: [{ key: 'src-joy-news', count: 313 }],
  newsrooms: [{ key: 'org-joy', count: 313 }],
  countries: [{ key: 'GH', count: 313 }],
  topics: [],
  categories: [{ key: 'international', count: 152 }],
  tags: [{ key: 'world cup', count: 47 }],
  articles: [{ id: 'a1', title: 'Cup final ends in a draw' }],
  windowDays: 365,
};

const PERSON = {
  name: 'Abubakar Ibrahim',
  slug: 'abubakar-ibrahim',
  desk: false,
  profile: PROFILE,
  sources: [{ key: 'src-joy-news', count: 313, label: 'Joy News' }],
  newsrooms: [{ key: 'org-joy', count: 313, label: 'Joy News' }],
  tags: [{ key: 'world cup', count: 47, label: 'World Cup', href: '/topic/world-cup' }],
  categories: [
    { key: 'international', count: 152, label: 'international', href: '/topic/international' },
  ],
};

const DESK = {
  ...PERSON,
  name: 'Staff Reporter',
  slug: 'staff-reporter',
  desk: true,
  newsroom: { id: 'org-herald', name: 'The Herald' },
  profile: { ...PROFILE, total: 198 },
};

function route(...slug: string[]) {
  return AuthorRoute({ params: Promise.resolve({ slug }) });
}

/**
 * What the page tells the reader, as opposed to what the URL encodes.
 *
 * The scoping of a desk byline lives in the URL, and a reader does not read the
 * URL. The whole reason `/author/the-herald/staff-reporter` exists is that ten
 * different newsrooms use that same label — so if the page does not SAY which
 * newsroom's desk it is showing, the reader takes 198 articles under one
 * heading to be one journalist's work and the scoping has bought nothing.
 */
describe('/author', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthorPageAction.mockResolvedValue(PERSON);
  });

  it('renders a person with their byline, sources and reporting', async () => {
    render(await route('abubakar-ibrahim'));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Abubakar Ibrahim');
    expect(screen.getByText('Byline')).toBeInTheDocument();
    expect(screen.getByText('Joy News')).toBeInTheDocument();
    expect(screen.getByText('Cup final ends in a draw')).toBeInTheDocument();
  });

  it('names the newsroom a desk byline belongs to, and says it is not one person', async () => {
    mockGetAuthorPageAction.mockResolvedValue(DESK);
    render(await route('the-herald', 'staff-reporter'));

    expect(screen.getByText('Newsroom desk')).toBeInTheDocument();
    expect(screen.getByText('The Herald')).toBeInTheDocument();
    expect(screen.getByText(/does not treat it as one journalist/i)).toBeInTheDocument();
  });

  it('does not call a person a desk', async () => {
    render(await route('abubakar-ibrahim'));
    expect(screen.queryByText('Newsroom desk')).not.toBeInTheDocument();
    expect(screen.queryByText(/one journalist/i)).not.toBeInTheDocument();
  });

  it('passes the newsroom segment through as the scope, not as the byline', async () => {
    mockGetAuthorPageAction.mockResolvedValue(DESK);
    await route('the-herald', 'staff-reporter');
    expect(mockGetAuthorPageAction).toHaveBeenCalledWith('staff-reporter', 'the-herald');
  });

  it('links each tag to the developing-story timeline for it', async () => {
    render(await route('abubakar-ibrahim'));
    expect(screen.getByRole('link', { name: /World Cup/ })).toHaveAttribute(
      'href',
      '/topic/world-cup'
    );
  });

  it('renders a topic chip flat, because /topic does not query that field', async () => {
    // `engagement.topics` is not one of the fields `getTopicTimeline` matches,
    // so a linked topic chip would land the reader on a timeline with no
    // coverage — which reads as a gap in the reporting rather than in the query.
    mockGetAuthorPageAction.mockResolvedValue({
      ...PERSON,
      profile: { ...PROFILE, topics: [{ key: 'health', count: 12 }] },
    });
    render(await route('abubakar-ibrahim'));

    expect(screen.getByText(/Health/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Health/ })).not.toBeInTheDocument();
  });

  it('names countries rather than printing a bare ISO code', async () => {
    mockGetAuthorPageAction.mockResolvedValue({
      ...PERSON,
      profile: { ...PROFILE, countries: [{ key: 'GH', count: 313 }, { key: 'XX', count: 4 }] },
    });
    render(await route('abubakar-ibrahim'));

    // An unrecognised code means this app's country list is behind `places`,
    // not that the article is from nowhere — so it is dropped, not printed.
    expect(screen.getByText(/Ghana/)).toBeInTheDocument();
    expect(screen.queryByText(/XX/)).not.toBeInTheDocument();
  });

  it('says the corpus is unreachable rather than claiming the byline wrote nothing', async () => {
    // The byline is in the directory, so it HAS published. A page that renders a
    // real person's name above "0 articles" makes a claim about them out of an
    // outage.
    mockGetAuthorPageAction.mockResolvedValue({
      ...PERSON,
      profile: { ...PROFILE, total: 0, articles: [] },
    });
    render(await route('abubakar-ibrahim'));

    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
  });

  it('404s a URL that is not a byline', async () => {
    mockGetAuthorPageAction.mockResolvedValue(null);
    await expect(route('nobody')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s a URL with more segments than the page ever issues', async () => {
    // Coercing it to the nearest valid address would serve someone's page at a
    // URL nothing generated.
    await expect(route('a', 'b', 'c')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockGetAuthorPageAction).not.toHaveBeenCalled();
  });

  describe('metadata', () => {
    it('canonicalises a person at their single address', async () => {
      const meta = await generateMetadata({
        params: Promise.resolve({ slug: ['abubakar-ibrahim'] }),
      });
      expect(meta.alternates?.canonical).toContain('/author/abubakar-ibrahim');
    });

    it('canonicalises a desk at its scoped address, never at the bare byline', async () => {
      mockGetAuthorPageAction.mockResolvedValue(DESK);
      const meta = await generateMetadata({
        params: Promise.resolve({ slug: ['the-herald', 'staff-reporter'] }),
      });
      expect(meta.alternates?.canonical).toContain('/author/the-herald/staff-reporter');
      expect(meta.title).toBe('Staff Reporter, The Herald');
    });
  });
});
