import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroCard } from '../hero-card';

// Mock Next.js Image component
vi.mock('next/image', () => ({
  default: ({ src, alt, onError, ...props }: { src: string; alt: string; onError?: () => void; [key: string]: unknown }) => (
    <img src={src} alt={alt} data-testid="hero-image" {...props} />
  ),
}));

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const mockArticle = {
  id: 'test-article-1',
  headline: 'Test Article Title',
  slug: 'test-article-title',
  description: 'Test article description for the hero card',
  publisher_name: 'Test Source',
  date_published: '2024-01-15T10:00:00Z',
  image: 'https://example.com/image.jpg',
  article_section_id: 'politics',
  url: 'https://example.com/article',
};

describe('HeroCard', () => {
  it('should render article title', () => {
    render(<HeroCard article={mockArticle} />);
    expect(screen.getByText('Test Article Title')).toBeInTheDocument();
  });

  it('should render article description', () => {
    render(<HeroCard article={mockArticle} />);
    expect(screen.getByText('Test article description for the hero card')).toBeInTheDocument();
  });

  it('should render article source', () => {
    render(<HeroCard article={mockArticle} />);
    expect(screen.getByText('Test Source')).toBeInTheDocument();
  });

  it('should render category badge', () => {
    render(<HeroCard article={mockArticle} />);
    expect(screen.getByText('politics')).toBeInTheDocument();
  });

  it('should link to article detail page', () => {
    render(<HeroCard article={mockArticle} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/article/test-article-1');
  });

  it('should have proper aria-label', () => {
    render(<HeroCard article={mockArticle} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('aria-label', 'Read article: Test Article Title');
  });

  it('should render image when valid URL provided', () => {
    render(<HeroCard article={mockArticle} />);
    const image = screen.getByTestId('hero-image');
    expect(image).toHaveAttribute('src', 'https://example.com/image.jpg');
    expect(image).toHaveAttribute('alt', 'Test article description for the hero card');
  });

  it('should render gradient fallback when no image URL', () => {
    const articleWithoutImage = { ...mockArticle, image: undefined };
    render(<HeroCard article={articleWithoutImage} />);
    expect(screen.queryByTestId('hero-image')).not.toBeInTheDocument();
  });
});
