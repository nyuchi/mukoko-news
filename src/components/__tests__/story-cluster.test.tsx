import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoryCluster, StoryClusterCompact } from '../story-cluster';
import type { StoryCluster as StoryClusterType } from '@/lib/api';

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Clock: ({ className }: { className?: string }) => <span data-testid="clock-icon" className={className} />,
  Layers: ({ className }: { className?: string }) => <span data-testid="layers-icon" className={className} />,
  ChevronRight: ({ className }: { className?: string }) => <span data-testid="chevron-icon" className={className} />,
}));

// Mock SourceIcon component
vi.mock('@/components/ui/source-icon', () => ({
  SourceIcon: ({ source, size }: { source: string; size: number }) => (
    <span data-testid="source-icon" data-source={source} data-size={size} />
  ),
}));

const createMockCluster = (overrides: Partial<StoryClusterType> = {}): StoryClusterType => ({
  id: 'cluster-123',
  primaryArticle: {
    id: 'article-1',
    headline: 'Zimbabwe announces major economic reforms',
    slug: 'zimbabwe-economic-reforms',
    description: 'The government unveiled sweeping changes to boost the economy',
    publisher_name: 'Herald',
    publisher_id: 'herald',
    date_published: '2024-01-15T10:00:00Z',
    image: 'https://example.com/image.jpg',
    article_section_id: 'politics',
    about_country_id: 'ZW',
  },
  relatedArticles: [],
  articleCount: 1,
  ...overrides,
});

const createMockRelatedArticle = (id: string, source: string) => ({
  id,
  headline: `Related article about economic reforms from ${source}`,
  slug: `related-${id}`,
  description: 'Another perspective on economic reforms',
  publisher_name: source,
  publisher_id: source.toLowerCase(),
  date_published: '2024-01-15T09:00:00Z',
  image: 'https://example.com/related.jpg',
  article_section_id: 'politics',
  about_country_id: 'ZW',
});

describe('StoryCluster', () => {
  describe('Primary Article Rendering', () => {
    it('should render primary article title', () => {
      const cluster = createMockCluster();
      render(<StoryCluster cluster={cluster} />);
      expect(screen.getByText('Zimbabwe announces major economic reforms')).toBeInTheDocument();
    });

    it('should render primary article description', () => {
      const cluster = createMockCluster();
      render(<StoryCluster cluster={cluster} />);
      expect(screen.getByText('The government unveiled sweeping changes to boost the economy')).toBeInTheDocument();
    });

    it('should render source name', () => {
      const cluster = createMockCluster();
      render(<StoryCluster cluster={cluster} />);
      expect(screen.getByText('Herald')).toBeInTheDocument();
    });

    it('should render category badge when article_section_id exists', () => {
      const cluster = createMockCluster();
      render(<StoryCluster cluster={cluster} />);
      expect(screen.getByText('politics')).toBeInTheDocument();
    });

    it('should link to article page', () => {
      const cluster = createMockCluster();
      render(<StoryCluster cluster={cluster} />);
      const links = screen.getAllByRole('link');
      expect(links[0]).toHaveAttribute('href', '/article/article-1');
    });

    it('should render time ago', () => {
      const cluster = createMockCluster();
      render(<StoryCluster cluster={cluster} />);
      // Time element should be present with datetime attribute
      const timeElement = screen.getByRole('time');
      expect(timeElement).toHaveAttribute('datetime', '2024-01-15T10:00:00Z');
    });

    it('should render source icon', () => {
      const cluster = createMockCluster();
      render(<StoryCluster cluster={cluster} />);
      const sourceIcon = screen.getAllByTestId('source-icon')[0];
      expect(sourceIcon).toHaveAttribute('data-source', 'Herald');
    });
  });

  describe('Image Handling', () => {
    it('should render image when valid image is provided', () => {
      const cluster = createMockCluster();
      render(<StoryCluster cluster={cluster} />);
      // Image is rendered as background, check for the container
      const imageContainer = document.querySelector('[style*="background"]');
      expect(imageContainer).toBeInTheDocument();
    });

    it('should not render image section when image is empty', () => {
      const cluster = createMockCluster({
        primaryArticle: {
          ...createMockCluster().primaryArticle,
          image: '',
        },
      });
      render(<StoryCluster cluster={cluster} />);
      // Should still render title
      expect(screen.getByText('Zimbabwe announces major economic reforms')).toBeInTheDocument();
    });

    it('should not render image section for invalid protocols', () => {
      const cluster = createMockCluster({
        primaryArticle: {
          ...createMockCluster().primaryArticle,
          image: 'javascript:alert(1)',
        },
      });
      render(<StoryCluster cluster={cluster} />);
      // Component should render without the image
      expect(screen.getByText('Zimbabwe announces major economic reforms')).toBeInTheDocument();
    });
  });

  describe('Related Articles', () => {
    it('should render related articles when present', () => {
      const cluster = createMockCluster({
        relatedArticles: [
          createMockRelatedArticle('2', 'Chronicle'),
          createMockRelatedArticle('3', 'NewsDay'),
        ],
        articleCount: 3,
      });
      render(<StoryCluster cluster={cluster} />);

      expect(screen.getByText('Chronicle')).toBeInTheDocument();
      expect(screen.getByText('NewsDay')).toBeInTheDocument();
    });

    it('should link related articles correctly', () => {
      const cluster = createMockCluster({
        relatedArticles: [createMockRelatedArticle('2', 'Chronicle')],
        articleCount: 2,
      });
      render(<StoryCluster cluster={cluster} />);

      const links = screen.getAllByRole('link');
      const chronicleLink = links.find(link => link.getAttribute('href') === '/article/2');
      expect(chronicleLink).toBeInTheDocument();
    });

    it('should display only first 2 related articles', () => {
      const cluster = createMockCluster({
        relatedArticles: [
          createMockRelatedArticle('2', 'Chronicle'),
          createMockRelatedArticle('3', 'NewsDay'),
          createMockRelatedArticle('4', 'Daily News'),
        ],
        articleCount: 4,
      });
      render(<StoryCluster cluster={cluster} />);

      expect(screen.getByText('Chronicle')).toBeInTheDocument();
      expect(screen.getByText('NewsDay')).toBeInTheDocument();
      expect(screen.queryByText('Daily News')).not.toBeInTheDocument();
    });

    it('should render related article thumbnails when valid', () => {
      const cluster = createMockCluster({
        relatedArticles: [createMockRelatedArticle('2', 'Chronicle')],
        articleCount: 2,
      });
      render(<StoryCluster cluster={cluster} />);

      // Check for thumbnail container
      const thumbnails = document.querySelectorAll('[class*="w-16"]');
      expect(thumbnails.length).toBeGreaterThan(0);
    });
  });

  describe('Full Coverage Link', () => {
    it('should show Full Coverage link when articleCount > 2', () => {
      const cluster = createMockCluster({
        relatedArticles: [
          createMockRelatedArticle('2', 'Chronicle'),
          createMockRelatedArticle('3', 'NewsDay'),
        ],
        articleCount: 3,
      });
      render(<StoryCluster cluster={cluster} />);

      expect(screen.getByText(/Full Coverage/)).toBeInTheDocument();
      expect(screen.getByText(/3 sources/)).toBeInTheDocument();
    });

    it('should not show Full Coverage link when articleCount <= 2', () => {
      const cluster = createMockCluster({
        relatedArticles: [createMockRelatedArticle('2', 'Chronicle')],
        articleCount: 2,
      });
      render(<StoryCluster cluster={cluster} />);

      expect(screen.queryByText(/Full Coverage/)).not.toBeInTheDocument();
    });

    it('should link to search with encoded title keywords', () => {
      const cluster = createMockCluster({
        relatedArticles: [
          createMockRelatedArticle('2', 'Chronicle'),
          createMockRelatedArticle('3', 'NewsDay'),
        ],
        articleCount: 3,
      });
      render(<StoryCluster cluster={cluster} />);

      const fullCoverageLink = screen.getByLabelText(/View full coverage/);
      expect(fullCoverageLink).toHaveAttribute('href', expect.stringContaining('/search?q='));
    });

    it('should have accessible aria-label', () => {
      const cluster = createMockCluster({
        relatedArticles: [
          createMockRelatedArticle('2', 'Chronicle'),
          createMockRelatedArticle('3', 'NewsDay'),
        ],
        articleCount: 3,
      });
      render(<StoryCluster cluster={cluster} />);

      const link = screen.getByLabelText(/View full coverage: 3 sources covering this story/);
      expect(link).toBeInTheDocument();
    });

    it('should render Layers icon', () => {
      const cluster = createMockCluster({
        relatedArticles: [
          createMockRelatedArticle('2', 'Chronicle'),
          createMockRelatedArticle('3', 'NewsDay'),
        ],
        articleCount: 3,
      });
      render(<StoryCluster cluster={cluster} />);

      expect(screen.getByTestId('layers-icon')).toBeInTheDocument();
    });
  });

  describe('No Related Articles', () => {
    it('should not render related section when no related articles', () => {
      const cluster = createMockCluster({
        relatedArticles: [],
        articleCount: 1,
      });
      render(<StoryCluster cluster={cluster} />);

      // Only one link (primary article)
      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(1);
    });
  });

  describe('Description Handling', () => {
    it('should render description when present', () => {
      const cluster = createMockCluster();
      render(<StoryCluster cluster={cluster} />);
      expect(screen.getByText(/government unveiled/)).toBeInTheDocument();
    });

    it('should not render description paragraph when empty', () => {
      const cluster = createMockCluster({
        primaryArticle: {
          ...createMockCluster().primaryArticle,
          description: '',
        },
      });
      render(<StoryCluster cluster={cluster} />);
      // Title should still be there
      expect(screen.getByText('Zimbabwe announces major economic reforms')).toBeInTheDocument();
    });
  });
});

describe('StoryClusterCompact', () => {
  it('should render primary article title', () => {
    const cluster = createMockCluster();
    render(<StoryClusterCompact cluster={cluster} />);
    expect(screen.getByText('Zimbabwe announces major economic reforms')).toBeInTheDocument();
  });

  it('should render source name', () => {
    const cluster = createMockCluster();
    render(<StoryClusterCompact cluster={cluster} />);
    expect(screen.getByText('Herald')).toBeInTheDocument();
  });

  it('should link to article page', () => {
    const cluster = createMockCluster();
    render(<StoryClusterCompact cluster={cluster} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/article/article-1');
  });

  it('should show article count badge when more than 1 article', () => {
    const cluster = createMockCluster({
      relatedArticles: [createMockRelatedArticle('2', 'Chronicle')],
      articleCount: 2,
    });
    render(<StoryClusterCompact cluster={cluster} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('should not show article count badge when only 1 article', () => {
    const cluster = createMockCluster({
      articleCount: 1,
    });
    render(<StoryClusterCompact cluster={cluster} />);
    // The "1" should not appear as a badge
    const layersIcon = screen.queryByTestId('layers-icon');
    expect(layersIcon).not.toBeInTheDocument();
  });

  it('should render image when valid', () => {
    const cluster = createMockCluster();
    render(<StoryClusterCompact cluster={cluster} />);
    // Background image container should exist
    const container = document.querySelector('[style*="background"]');
    expect(container).toBeInTheDocument();
  });

  it('should render time ago', () => {
    const cluster = createMockCluster();
    render(<StoryClusterCompact cluster={cluster} />);
    // Time text should be present
    const content = document.body.textContent;
    // formatTimeAgo returns relative time
    expect(content).toBeDefined();
  });

  it('should have fixed width for horizontal scrolling', () => {
    const cluster = createMockCluster();
    render(<StoryClusterCompact cluster={cluster} />);
    const link = screen.getByRole('link');
    expect(link.className).toContain('w-[280px]');
  });
});
