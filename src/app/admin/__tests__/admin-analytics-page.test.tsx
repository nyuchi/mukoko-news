import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminAnalyticsPage from '../analytics/page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Admin reads go directly through src/lib/mongodb/admin.ts — mock that module.
const mockGetAdminStats = vi.fn();
const mockGetAdminEngagementTotals = vi.fn();
const mockGetAdminCategoryCounts = vi.fn();
vi.mock('@/lib/mongodb/admin', () => ({
  getAdminStats: (...args: unknown[]) => mockGetAdminStats(...args),
  getAdminEngagementTotals: (...args: unknown[]) => mockGetAdminEngagementTotals(...args),
  getAdminCategoryCounts: (...args: unknown[]) => mockGetAdminCategoryCounts(...args),
}));

const defaultStats = {
  totalArticles: 9876,
  activeSources: 42,
  categories: 12,
  todayArticles: 55,
  pendingArticles: 3,
};

const defaultEngagement = { likes: 120, saves: 45, viewEvents: 3200 };

const defaultCategories = [
  { slug: 'politics', name: 'Politics', count: 400 },
  { slug: 'business', name: 'Business', count: 250 },
];

describe('AdminAnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminStats.mockResolvedValue(defaultStats);
    mockGetAdminEngagementTotals.mockResolvedValue(defaultEngagement);
    mockGetAdminCategoryCounts.mockResolvedValue(defaultCategories);
  });

  it('renders real article and source counts from MongoDB reads', async () => {
    render(await AdminAnalyticsPage());
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('9,876')).toBeInTheDocument();
    expect(screen.getByText('Total Articles')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Active Sources')).toBeInTheDocument();
    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.getByText('Published Today')).toBeInTheDocument();
  });

  it('renders engagement totals from the event collections', async () => {
    render(await AdminAnalyticsPage());
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('Likes')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('Saves')).toBeInTheDocument();
    expect(screen.getByText('3,200')).toBeInTheDocument();
    expect(screen.getByText('Tracked View Events')).toBeInTheDocument();
  });

  it('renders real per-category counts', async () => {
    render(await AdminAnalyticsPage());
    expect(screen.getByText('Top Categories by Article Count')).toBeInTheDocument();
    expect(screen.getByText('Politics')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
  });

  it('states untracked metrics honestly instead of fabricating them', async () => {
    render(await AdminAnalyticsPage());
    expect(screen.getByText('Not tracked yet')).toBeInTheDocument();
    // No fabricated KPIs from the old mock page
    expect(screen.queryByText('24.5K')).not.toBeInTheDocument();
    expect(screen.queryByText('68%')).not.toBeInTheDocument();
    expect(screen.queryByText('Engagement Rate')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg. Session')).not.toBeInTheDocument();
  });

  it('shows an error banner when the database is unreachable', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetAdminStats.mockRejectedValue(new Error('down'));
    render(await AdminAnalyticsPage());
    expect(
      screen.getByText('Could not reach the database. Analytics are unavailable right now.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Total Articles')).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
