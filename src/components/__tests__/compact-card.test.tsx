import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompactCard } from '../compact-card';

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock source icon/badge components
vi.mock('../ui/source-icon', () => ({
  SourceIcon: ({ source }: { source: string }) => (
    <span data-testid="source-icon">{source}</span>
  ),
  SourceBadge: ({ source }: { source: string }) => (
    <span data-testid="source-badge">{source}</span>
  ),
}));

// Mock the image proxy to a stable pass-through
vi.mock('@/lib/image', () => ({
  imageProxyUrl: (src: string) => src,
  mukokoImageLoader: ({ src }: { src: string }) => src,
}));

const mockArticle = {
  id: 'test-article-1',
  title: 'Test Article Title for Compact Card',
  slug: 'test-article-title-for-compact-card',
  source: 'Test Source',
  published_at: '2024-01-15T10:00:00Z',
  category_id: 'economy',
  url: 'https://example.com/article',
};

describe('CompactCard', () => {
  it('should render article title', () => {
    render(<CompactCard article={mockArticle} />);
    expect(screen.getByText('Test Article Title for Compact Card')).toBeInTheDocument();
  });

  it('should render article source', () => {
    render(<CompactCard article={mockArticle} />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('Test Source');
  });

  it('should render category', () => {
    render(<CompactCard article={mockArticle} />);
    expect(screen.getByText('economy')).toBeInTheDocument();
  });

  it('should link to article detail page', () => {
    render(<CompactCard article={mockArticle} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/article/test-article-1');
  });

  it('should have proper aria-label', () => {
    render(<CompactCard article={mockArticle} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('aria-label', 'Read article: Test Article Title for Compact Card');
  });

  it('should render with focus-visible styles class', () => {
    render(<CompactCard article={mockArticle} />);
    const link = screen.getByRole('link');
    expect(link).toHaveClass('focus-visible:ring-2');
  });

  it('should render as the nyuchi article-card brand component (row variant)', () => {
    render(<CompactCard article={mockArticle} />);
    const card = document.querySelector('[data-slot="nyuchi-article-card"]');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('data-variant', 'row');
  });

  it('should render relative published time', () => {
    render(<CompactCard article={mockArticle} />);
    // 2024-01-15 is older than 7 days → absolute short date
    expect(screen.getByText(/Jan 15/)).toBeInTheDocument();
  });
});
