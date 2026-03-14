/**
 * Tests for Embed Iframe page
 * Tests URL parameter parsing, validation, layout rendering,
 * article loading, error states, and theme application
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// Mock useSearchParams before importing the component
const mockSearchParams = new Map<string, string>();

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key) || null,
  }),
}));

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
    <img src={src} alt={alt} {...props} />
  ),
}));

// Mock SourceIcon
vi.mock('@/components/ui/source-icon', () => ({
  SourceIcon: ({ source }: { source: string }) => (
    <span data-testid="source-icon">{source}</span>
  ),
}));

// Mock API
const mockGetArticles = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    getArticles: (...args: unknown[]) => mockGetArticles(...args),
  },
}));

type Article = {
  id: string;
  headline: string;
  slug: string;
  publisher_name: string;
  date_published: string;
  description?: string;
  image?: string;
  article_section_id?: string;
  about_country_id?: string;
};

import EmbedIframePage from '../iframe/page';

function createArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'art-1',
    headline: 'Test Article Title',
    slug: 'test-article',
    publisher_name: 'The Herald',
    date_published: new Date().toISOString(),
    description: 'A test article description',
    image: 'https://example.com/image.jpg',
    article_section_id: 'politics',
    ...overrides,
  };
}

function setParams(params: Record<string, string>) {
  mockSearchParams.clear();
  for (const [key, value] of Object.entries(params)) {
    mockSearchParams.set(key, value);
  }
}

describe('EmbedIframePage', () => {
  beforeEach(() => {
    mockSearchParams.clear();
    mockGetArticles.mockResolvedValue({
      articles: [createArticle()],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove('light', 'dark');
  });

  // -----------------------------------------------------------------------
  // Parameter Parsing & Validation
  // -----------------------------------------------------------------------

  describe('parameter parsing', () => {
    it('should use default params when none provided', async () => {
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith({
          countries: ['ZW'],
          limit: 6,
          sort: 'latest',
          category: undefined,
        });
      });
    });

    it('should parse country parameter', async () => {
      setParams({ country: 'KE' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ countries: ['KE'] })
        );
      });
    });

    it('should fallback invalid country to ZW', async () => {
      setParams({ country: 'XX' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ countries: ['ZW'] })
        );
      });
    });

    it('should parse feed type "top" with trending sort', async () => {
      setParams({ type: 'top' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ sort: 'trending' })
        );
      });
    });

    it('should parse feed type "featured" with popular sort', async () => {
      setParams({ type: 'featured' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ sort: 'popular' })
        );
      });
    });

    it('should fallback invalid feed type to latest', async () => {
      setParams({ type: 'bogus' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ sort: 'latest' })
        );
      });
    });

    it('should parse category parameter', async () => {
      setParams({ category: 'sports' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'sports' })
        );
      });
    });

    it('should parse limit parameter', async () => {
      setParams({ limit: '3' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 3 })
        );
      });
    });

    it('should clamp limit to max 20', async () => {
      setParams({ limit: '50' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 20 })
        );
      });
    });

    it('should clamp limit to min 1', async () => {
      setParams({ limit: '0' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 1 })
        );
      });
    });

    it('should clamp negative limit to 1', async () => {
      setParams({ limit: '-5' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 1 })
        );
      });
    });

    it('should use layout default limit for NaN limit', async () => {
      setParams({ limit: 'abc', layout: 'compact' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 8 }) // compact default
        );
      });
    });

    it('should use hero default limit of 1', async () => {
      setParams({ layout: 'hero' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 1 })
        );
      });
    });

    it('should fallback invalid layout to cards defaults', async () => {
      setParams({ layout: 'bogus' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(mockGetArticles).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 6 }) // cards default
        );
      });
    });
  });

  // -----------------------------------------------------------------------
  // Theme Application
  // -----------------------------------------------------------------------

  describe('theme', () => {
    it('should apply light theme class to document', async () => {
      setParams({ theme: 'light' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(document.documentElement.classList.contains('light')).toBe(true);
        expect(document.documentElement.classList.contains('dark')).toBe(false);
      });
    });

    it('should apply dark theme class to document', async () => {
      setParams({ theme: 'dark' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(document.documentElement.classList.contains('light')).toBe(false);
      });
    });

    it('should not modify classes for auto theme', async () => {
      setParams({ theme: 'auto' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(document.documentElement.classList.contains('light')).toBe(false);
        expect(document.documentElement.classList.contains('dark')).toBe(false);
      });
    });

    it('should clean up theme class on unmount', async () => {
      setParams({ theme: 'dark' });
      const { unmount } = render(<EmbedIframePage />);

      await waitFor(() => {
        expect(document.documentElement.classList.contains('dark')).toBe(true);
      });

      unmount();

      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Layout Rendering
  // -----------------------------------------------------------------------

  describe('layout rendering', () => {
    it('should render cards layout header with feed icon', async () => {
      setParams({ layout: 'cards', type: 'top' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Top Stories')).toBeInTheDocument();
      });
    });

    it('should render location type with country name', async () => {
      setParams({ type: 'location', country: 'KE' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Kenya News')).toBeInTheDocument();
      });
    });

    it('should render list layout with articles', async () => {
      setParams({ layout: 'list' });
      mockGetArticles.mockResolvedValue({
        articles: [
          createArticle({ id: '1', headline: 'Article One' }),
          createArticle({ id: '2', headline: 'Article Two' }),
        ],
      });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Article One')).toBeInTheDocument();
        expect(screen.getByText('Article Two')).toBeInTheDocument();
      });
    });

    it('should render compact layout with articles', async () => {
      setParams({ layout: 'compact' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Test Article Title')).toBeInTheDocument();
      });
    });

    it('should render hero layout with single article', async () => {
      setParams({ layout: 'hero' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Test Article Title')).toBeInTheDocument();
      });
      // Hero shows footer with "Mukoko News"
      expect(screen.getByText('Mukoko News')).toBeInTheDocument();
    });

    it('should render ticker layout with minimal header', async () => {
      setParams({ layout: 'ticker' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Test Article Title')).toBeInTheDocument();
      });
      // Ticker shows "More" link
      expect(screen.getByText('More')).toBeInTheDocument();
    });

    it('should render country flag in header', async () => {
      setParams({ country: 'ZW' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Test Article Title')).toBeInTheDocument();
      });
    });

    it('should render article category', async () => {
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('politics')).toBeInTheDocument();
      });
    });

    it('should render article source', async () => {
      render(<EmbedIframePage />);

      await waitFor(() => {
        // SourceIcon mock and source span both render "The Herald"
        const sources = screen.getAllByText('The Herald');
        expect(sources.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should show article count in footer for default layouts', async () => {
      mockGetArticles.mockResolvedValue({
        articles: [createArticle({ id: '1' }), createArticle({ id: '2' })],
      });
      setParams({ layout: 'list' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('2 stories')).toBeInTheDocument();
      });
    });

    it('should show "More on Mukoko News" link in footer', async () => {
      setParams({ layout: 'list' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('More on Mukoko News')).toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Empty States
  // -----------------------------------------------------------------------

  describe('empty states', () => {
    it('should show empty state for hero when no articles', async () => {
      setParams({ layout: 'hero' });
      mockGetArticles.mockResolvedValue({ articles: [] });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('No stories available')).toBeInTheDocument();
      });
    });

    it('should show empty state for ticker when no articles', async () => {
      setParams({ layout: 'ticker' });
      mockGetArticles.mockResolvedValue({ articles: [] });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('No stories available')).toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Loading & Error States
  // -----------------------------------------------------------------------

  describe('loading and error states', () => {
    it('should show skeleton while loading', () => {
      mockGetArticles.mockReturnValue(new Promise(() => {})); // never resolves
      render(<EmbedIframePage />);

      // Skeletons are aria-hidden
      const hidden = document.querySelector('[aria-hidden="true"]');
      expect(hidden).toBeInTheDocument();
    });

    it('should show error state on fetch failure', async () => {
      mockGetArticles.mockRejectedValue(new Error('Network error'));
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load news')).toBeInTheDocument();
        expect(screen.getByText('Try Again')).toBeInTheDocument();
      });
    });

    it('should retry on Try Again click', async () => {
      mockGetArticles.mockRejectedValueOnce(new Error('fail'));
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Try Again')).toBeInTheDocument();
      });

      const callsBefore = mockGetArticles.mock.calls.length;
      mockGetArticles.mockResolvedValue({ articles: [createArticle()] });

      await act(async () => {
        fireEvent.click(screen.getByText('Try Again'));
      });

      await waitFor(() => {
        expect(mockGetArticles.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Refresh Button
  // -----------------------------------------------------------------------

  describe('refresh', () => {
    it('should have refresh button with aria-label', async () => {
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByLabelText('Refresh news')).toBeInTheDocument();
      });
    });

    it('should reload articles on refresh click', async () => {
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByLabelText('Refresh news')).toBeInTheDocument();
      });

      const callsBefore = mockGetArticles.mock.calls.length;

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Refresh news'));
      });

      await waitFor(() => {
        expect(mockGetArticles.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Auto-refresh Interval
  // -----------------------------------------------------------------------

  describe('auto-refresh', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockGetArticles.mockClear();
      mockGetArticles.mockResolvedValue({
        articles: [createArticle()],
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should set up auto-refresh interval', () => {
      render(<EmbedIframePage />);

      const initialCalls = mockGetArticles.mock.calls.length;

      // Advance 5 minutes
      act(() => {
        vi.advanceTimersByTime(5 * 60 * 1000);
      });

      // Should have been called again by the interval
      expect(mockGetArticles.mock.calls.length).toBeGreaterThan(initialCalls);
    });

    it('should clean up interval on unmount', () => {
      const { unmount } = render(<EmbedIframePage />);

      const callsBeforeUnmount = mockGetArticles.mock.calls.length;
      unmount();

      act(() => {
        vi.advanceTimersByTime(5 * 60 * 1000);
      });

      // No additional calls after unmount
      expect(mockGetArticles.mock.calls.length).toBe(callsBeforeUnmount);
    });
  });

  // -----------------------------------------------------------------------
  // Links
  // -----------------------------------------------------------------------

  describe('links', () => {
    it('should link articles to Mukoko News article pages', async () => {
      render(<EmbedIframePage />);

      await waitFor(() => {
        const links = screen.getAllByRole('link');
        const articleLink = links.find((l) =>
          l.getAttribute('href')?.includes('/article/art-1')
        );
        expect(articleLink).toBeDefined();
        expect(articleLink).toHaveAttribute('target', '_blank');
        expect(articleLink).toHaveAttribute('rel', 'noopener noreferrer');
      });
    });

    it('should have discover link with correct country', async () => {
      setParams({ country: 'KE', layout: 'list' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        const moreLink = screen.getByText('More on Mukoko News').closest('a');
        expect(moreLink?.getAttribute('href')).toContain('country=KE');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Image Handling
  // -----------------------------------------------------------------------

  describe('image handling', () => {
    it('should not render image for invalid URLs', async () => {
      mockGetArticles.mockResolvedValue({
        articles: [createArticle({ image: 'javascript:alert(1)' })],
      });
      setParams({ layout: 'list' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Test Article Title')).toBeInTheDocument();
      });
      // No image container should have the malicious URL
      const bgElements = document.querySelectorAll('[style*="background"]');
      bgElements.forEach((el) => {
        expect((el as HTMLElement).style.backgroundImage).not.toContain('javascript');
      });
    });

    it('should render articles without image_url', async () => {
      mockGetArticles.mockResolvedValue({
        articles: [createArticle({ image: undefined })],
      });
      setParams({ layout: 'list' });
      render(<EmbedIframePage />);

      await waitFor(() => {
        expect(screen.getByText('Test Article Title')).toBeInTheDocument();
      });
    });
  });
});
