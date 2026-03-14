import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompactCard } from '../compact-card';

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock SourceIcon component
vi.mock('../ui/source-icon', () => ({
  SourceIcon: ({ source }: { source: string }) => (
    <span data-testid="source-icon">{source}</span>
  ),
}));

const mockArticle = {
  id: 'test-article-1',
  headline: 'Test Article Title for Compact Card',
  slug: 'test-article-title-for-compact-card',
  publisher_name: 'Test Source',
  date_published: '2024-01-15T10:00:00Z',
  article_section_id: 'economy',
  url: 'https://example.com/article',
};

describe('CompactCard', () => {
  it('should render article title', () => {
    render(<CompactCard article={mockArticle} />);
    expect(screen.getByText('Test Article Title for Compact Card')).toBeInTheDocument();
  });

  it('should render article source', () => {
    render(<CompactCard article={mockArticle} />);
    // Source appears both in SourceIcon and text span
    const sourceElements = screen.getAllByText('Test Source');
    expect(sourceElements.length).toBeGreaterThan(0);
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

  it('should use article element for semantic HTML', () => {
    render(<CompactCard article={mockArticle} />);
    const article = screen.getByRole('article');
    expect(article).toBeInTheDocument();
  });

  it('should render time element with datetime attribute', () => {
    render(<CompactCard article={mockArticle} />);
    const timeElement = screen.getByRole('time');
    expect(timeElement).toHaveAttribute('dateTime', '2024-01-15T10:00:00Z');
  });
});
