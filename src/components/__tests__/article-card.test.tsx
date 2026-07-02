/**
 * Tests for ArticleCard component
 * Tests rendering, image handling, date formatting, and engagement display
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArticleCard } from '../article-card';
import type { Article } from '@/lib/api';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock the image proxy to a stable pass-through so assertions are simple
vi.mock('@/lib/image', () => ({
  imageProxyUrl: (src: string) => src,
  mukokoImageLoader: ({ src }: { src: string }) => src,
}));

// Mock child components
vi.mock('@/components/ui/source-icon', () => ({
  SourceBadge: ({ source }: { source: string }) => (
    <span data-testid="source-badge">{source}</span>
  ),
}));

vi.mock('@/components/ui/engagement-bar', () => ({
  InlineEngagement: ({ likesCount, commentsCount }: { likesCount?: number; commentsCount?: number }) => (
    <div data-testid="inline-engagement">
      Likes: {likesCount}, Comments: {commentsCount}
    </div>
  ),
}));

describe('ArticleCard', () => {
  const baseArticle: Article = {
    id: '1',
    title: 'Test Article Title',
    description: 'Test article description',
    slug: 'test-article',
    source: 'The Herald',
    published_at: new Date().toISOString(),
  };

  describe('rendering', () => {
    it('should render article title', () => {
      render(<ArticleCard article={baseArticle} />);

      expect(screen.getByText('Test Article Title')).toBeInTheDocument();
    });

    it('should render article description', () => {
      render(<ArticleCard article={baseArticle} />);

      expect(screen.getByText('Test article description')).toBeInTheDocument();
    });

    it('should render source badge', () => {
      render(<ArticleCard article={baseArticle} />);

      expect(screen.getByTestId('source-badge')).toHaveTextContent('The Herald');
    });

    it('should link to article page', () => {
      render(<ArticleCard article={baseArticle} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/article/1');
    });

    it('should render category badge when category_id is present', () => {
      const article = { ...baseArticle, category_id: 'politics' };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('politics')).toBeInTheDocument();
    });

    it('should render category badge when category is present', () => {
      const article = { ...baseArticle, category: 'sports' };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('sports')).toBeInTheDocument();
    });
  });

  describe('image handling', () => {
    it('should render the cover image when valid image_url', () => {
      const article = {
        ...baseArticle,
        image_url: 'https://example.com/image.jpg',
      };
      render(<ArticleCard article={article} />);

      const img = document.querySelector('img');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/image.jpg');
    });

    it('should render a text-only card when no image', () => {
      render(<ArticleCard article={baseArticle} />);

      // The brand card omits the cover area entirely without an image
      expect(document.querySelector('img')).not.toBeInTheDocument();
      expect(screen.getByText('Test Article Title')).toBeInTheDocument();
    });

    it('should not display image for invalid URLs', () => {
      const article = {
        ...baseArticle,
        image_url: 'javascript:alert(1)',
      };
      render(<ArticleCard article={article} />);

      // Invalid/unsafe URLs are rejected → no <img> at all
      expect(document.querySelector('img')).not.toBeInTheDocument();
    });
  });

  describe('date formatting', () => {
    it('should show "Just now" for very recent articles', () => {
      const article = {
        ...baseArticle,
        published_at: new Date().toISOString(),
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('Just now')).toBeInTheDocument();
    });

    it('should show hours ago for articles within 24 hours', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const article = {
        ...baseArticle,
        published_at: twoHoursAgo.toISOString(),
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('2h ago')).toBeInTheDocument();
    });

    it('should show days ago for articles within a week', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const article = {
        ...baseArticle,
        published_at: threeDaysAgo.toISOString(),
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('3d ago')).toBeInTheDocument();
    });

    it('should show formatted date for older articles', () => {
      const article = {
        ...baseArticle,
        published_at: '2023-06-15T10:00:00Z',
      };
      render(<ArticleCard article={article} />);

      // Should show month and day
      expect(screen.getByText('Jun 15')).toBeInTheDocument();
    });

    it('should handle invalid date gracefully', () => {
      const article = {
        ...baseArticle,
        published_at: 'invalid-date',
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('Recently')).toBeInTheDocument();
    });
  });

  describe('engagement display', () => {
    it('should show engagement bar when likesCount is present', () => {
      const article = {
        ...baseArticle,
        likesCount: 10,
        commentsCount: 5,
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByTestId('inline-engagement')).toBeInTheDocument();
    });

    it('should show engagement bar when commentsCount is present', () => {
      const article = {
        ...baseArticle,
        commentsCount: 5,
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByTestId('inline-engagement')).toBeInTheDocument();
    });

    it('should not show engagement bar when no engagement data', () => {
      render(<ArticleCard article={baseArticle} />);

      expect(screen.queryByTestId('inline-engagement')).not.toBeInTheDocument();
    });

    it('should pass isLiked state to engagement bar', () => {
      const article = {
        ...baseArticle,
        likesCount: 10,
        isLiked: true,
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByTestId('inline-engagement')).toBeInTheDocument();
    });
  });

  describe('without description', () => {
    it('should not render description paragraph when missing', () => {
      const article = {
        ...baseArticle,
        description: undefined,
      };
      render(<ArticleCard article={article} />);

      // Should only have title and meta, no description
      expect(screen.queryByText('Test article description')).not.toBeInTheDocument();
    });
  });
});
