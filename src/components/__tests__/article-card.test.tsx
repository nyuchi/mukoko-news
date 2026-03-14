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
    headline: 'Test Article Title',
    description: 'Test article description',
    slug: 'test-article',
    publisher_name: 'The Herald',
    date_published: new Date().toISOString(),
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

    it('should render category badge when article_section_id is present', () => {
      const article = { ...baseArticle, article_section_id: 'politics' };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('politics')).toBeInTheDocument();
    });

    it('should render category badge when article_section_id is present with different value', () => {
      const article = { ...baseArticle, article_section_id: 'sports' };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('sports')).toBeInTheDocument();
    });
  });

  describe('image handling', () => {
    it('should display image background when valid image', () => {
      const article = {
        ...baseArticle,
        image: 'https://example.com/image.jpg',
      };
      render(<ArticleCard article={article} />);

      // The component should have a background style with the image
      const container = document.querySelector('[style*="background"]');
      expect(container).toBeInTheDocument();
    });

    it('should display gradient fallback when no image', () => {
      render(<ArticleCard article={baseArticle} />);

      // Should use gradient background
      const container = document.querySelector('[style*="linear-gradient"]');
      expect(container).toBeInTheDocument();
    });

    it('should not display image for invalid URLs', () => {
      const article = {
        ...baseArticle,
        image: 'javascript:alert(1)',
      };
      render(<ArticleCard article={article} />);

      // Should use gradient fallback for invalid URLs
      const container = document.querySelector('[style*="var(--primary)"]');
      expect(container).toBeInTheDocument();
    });
  });

  describe('date formatting', () => {
    it('should show "Just now" for very recent articles', () => {
      const article = {
        ...baseArticle,
        date_published: new Date().toISOString(),
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('Just now')).toBeInTheDocument();
    });

    it('should show hours ago for articles within 24 hours', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const article = {
        ...baseArticle,
        date_published: twoHoursAgo.toISOString(),
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('2h ago')).toBeInTheDocument();
    });

    it('should show days ago for articles within a week', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const article = {
        ...baseArticle,
        date_published: threeDaysAgo.toISOString(),
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('3d ago')).toBeInTheDocument();
    });

    it('should show formatted date for older articles', () => {
      const article = {
        ...baseArticle,
        date_published: '2023-06-15T10:00:00Z',
      };
      render(<ArticleCard article={article} />);

      // Should show month and day
      expect(screen.getByText('Jun 15')).toBeInTheDocument();
    });

    it('should handle invalid date gracefully', () => {
      const article = {
        ...baseArticle,
        date_published: 'invalid-date',
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('Recently')).toBeInTheDocument();
    });
  });

  describe('date badge', () => {
    it('should display day number', () => {
      const article = {
        ...baseArticle,
        date_published: '2024-01-15T10:00:00Z',
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('15')).toBeInTheDocument();
    });

    it('should display month abbreviation', () => {
      const article = {
        ...baseArticle,
        date_published: '2024-01-15T10:00:00Z',
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByText('JAN')).toBeInTheDocument();
    });
  });

  describe('engagement display', () => {
    it('should show engagement bar when likesCount is present', () => {
      const article = {
        ...baseArticle,
        like_count: 10,
        comment_count: 5,
      };
      render(<ArticleCard article={article} />);

      expect(screen.getByTestId('inline-engagement')).toBeInTheDocument();
    });

    it('should show engagement bar when commentsCount is present', () => {
      const article = {
        ...baseArticle,
        comment_count: 5,
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
        like_count: 10,
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
