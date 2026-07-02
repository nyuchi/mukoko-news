import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnalyticsPage from '../page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Pages read via Server Actions — mock @/lib/actions/feed (NOT @/lib/api).
const mockGetStatsAction = vi.fn();
const mockGetTrendingCategoriesAction = vi.fn();
const mockGetSourcesAction = vi.fn();
vi.mock('@/lib/actions/feed', () => ({
  getStatsAction: (...args: unknown[]) => mockGetStatsAction(...args),
  getTrendingCategoriesAction: (...args: unknown[]) => mockGetTrendingCategoriesAction(...args),
  getSourcesAction: (...args: unknown[]) => mockGetSourcesAction(...args),
}));

const defaultStats = {
  database: {
    total_articles: 12345,
    active_sources: 87,
    categories: 14,
    today_articles: 231,
  },
};

const defaultTrending = [
  { id: 'politics', name: 'Politics', slug: 'politics', article_count: 420 },
  { id: 'business', name: 'Business', slug: 'business', article_count: 300 },
  { id: 'sports', name: 'Sports', slug: 'sports', article_count: 150 },
];

const defaultSources = [
  { id: 's1', name: 'The Herald', url: 'https://herald.co.zw/feed', country_id: 'ZW', article_count: 500 },
  { id: 's2', name: 'Chronicle', url: 'https://chronicle.co.zw/feed', country_id: 'ZW', article_count: 250 },
  { id: 's3', name: 'Daily Maverick', url: 'https://dailymaverick.co.za/rss', country_id: 'ZA', article_count: 600 },
  { id: 's4', name: 'Dead Source', url: 'https://dead.example.com/rss', country_id: 'KE', article_count: 0 },
];

describe('AnalyticsPage (public)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatsAction.mockResolvedValue(defaultStats);
    mockGetTrendingCategoriesAction.mockResolvedValue(defaultTrending);
    mockGetSourcesAction.mockResolvedValue(defaultSources);
  });

  it('renders header and real stats from getStatsAction', async () => {
    render(await AnalyticsPage());
    expect(screen.getByText('Open Analytics')).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument(); // articles
    expect(screen.getByText('87')).toBeInTheDocument(); // active sources
    expect(screen.getByText('14')).toBeInTheDocument(); // categories
    expect(screen.getByText('231')).toBeInTheDocument(); // published today
  });

  it('renders trending categories from getTrendingCategoriesAction', async () => {
    render(await AnalyticsPage());
    expect(screen.getByText('Trending Categories')).toBeInTheDocument();
    // Politics appears in the trending grid and the category breakdown
    expect(screen.getAllByText('Politics').length).toBeGreaterThan(0);
    expect(screen.getByText('420 articles')).toBeInTheDocument();
  });

  it('links trending categories to search', async () => {
    render(await AnalyticsPage());
    const link = screen.getByText('420 articles').closest('a');
    expect(link).toHaveAttribute('href', '/search?q=Politics');
  });

  it('aggregates the country breakdown from source article counts', async () => {
    render(await AnalyticsPage());
    expect(screen.getByText('By Country')).toBeInTheDocument();
    expect(screen.getByText('Zimbabwe')).toBeInTheDocument(); // 500 + 250
    expect(screen.getByText('750')).toBeInTheDocument();
    expect(screen.getByText('South Africa')).toBeInTheDocument();
    // Zero-count countries are omitted
    expect(screen.queryByText('Kenya')).not.toBeInTheDocument();
  });

  it('renders an error state instead of fabricated data when actions fail', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetStatsAction.mockRejectedValue(new Error('db down'));
    render(await AnalyticsPage());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to load analytics right now. Please try again later.'
    );
    expect(screen.queryByText('Trending Categories')).not.toBeInTheDocument();
    expect(screen.queryByText('By Country')).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('does not reference the removed /api/analytics endpoint', async () => {
    const { container } = render(await AnalyticsPage());
    expect(container.textContent).not.toContain('/api/analytics');
  });
});
