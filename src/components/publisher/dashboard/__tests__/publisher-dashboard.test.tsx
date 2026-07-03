import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublisherDashboard } from '../publisher-dashboard';
import type { PublisherContext } from '@/lib/publisher/dashboard';

const { mockUpdateOrg, mockSubmitFeed, mockRefresh } = vi.hoisted(() => ({
  mockUpdateOrg: vi.fn(),
  mockSubmitFeed: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/lib/publisher/dashboard', () => ({
  updatePublisherOrg: mockUpdateOrg,
  submitDirectFeed: mockSubmitFeed,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

const CONTEXT: PublisherContext = {
  isPublisher: true,
  pendingClaims: [],
  organizations: [
    {
      id: 'org-1',
      name: 'Herald Zimbabwe',
      slug: 'herald-zimbabwe',
      url: 'https://herald.co.zw',
      description: 'Daily paper',
      logo: null,
      isVerified: true,
      publisherTier: 'verified',
      verificationTier: 2,
      sources: [
        {
          id: 'src-1',
          name: 'Herald Main',
          feedUrl: 'https://herald.co.zw/feed',
          feedType: 'rss',
          countryCode: 'ZW',
          isActive: true,
          trustScore: 30,
          articleCount: 120,
          sourceHealth: 'healthy',
          consecutiveFailures: 0,
          lastFetchStatus: 'success',
          lastFetchError: null,
          lastFetchedAt: null,
          pendingReview: false,
        },
      ],
      trust: {
        averageTrustScore: 30,
        articlesAnalyzed: 100,
        factors: [
          {
            key: 'cover_image',
            label: 'Articles with a cover image',
            coveragePct: 50,
            needsAttention: true,
            hint: 'Articles without an image score lower.',
          },
          {
            key: 'enriched',
            label: 'Articles successfully processed',
            coveragePct: 100,
            needsAttention: false,
            hint: '',
          },
        ],
        recentAdjustments: [],
      },
      analytics: {
        totalArticles: 120,
        articlesLast30Days: 10,
        withImagePct: 50,
        withFullContentPct: 40,
        enrichedPct: 100,
        totalViews: 5000,
        totalLikes: 200,
        totalSaves: 80,
        capped: false,
      },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateOrg.mockResolvedValue({ ok: true, status: 200 });
  mockSubmitFeed.mockResolvedValue({ ok: true, status: 201 });
});

describe('PublisherDashboard', () => {
  it('renders the org header, verified badge and stats', () => {
    render(<PublisherDashboard context={CONTEXT} />);
    expect(screen.getByRole('heading', { name: 'Herald Zimbabwe' })).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument(); // views
  });

  it('shows the trust breakdown with an attention hint on the failing factor', () => {
    render(<PublisherDashboard context={CONTEXT} />);
    expect(screen.getByText('Articles with a cover image')).toBeInTheDocument();
    expect(screen.getByText(/Articles without an image score lower/)).toBeInTheDocument();
    // The healthy factor's (empty) hint is not shown.
    expect(screen.getByText('Articles successfully processed')).toBeInTheDocument();
  });

  it('lists the org feeds with health + trust', () => {
    render(<PublisherDashboard context={CONTEXT} />);
    expect(screen.getByText('Herald Main')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText(/120 articles/)).toBeInTheDocument();
  });

  it('submits a direct feed', async () => {
    render(<PublisherDashboard context={CONTEXT} />);
    fireEvent.click(screen.getByRole('button', { name: /Submit a feed/i }));
    fireEvent.change(screen.getByPlaceholderText(/full-content-feed/i), {
      target: { value: 'https://herald.co.zw/full.xml' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Submit feed/i }));
    await waitFor(() =>
      expect(mockSubmitFeed).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', feedUrl: 'https://herald.co.zw/full.xml' })
      )
    );
    expect(await screen.findByText(/our team will review and activate it/i)).toBeInTheDocument();
  });

  it('edits the organization profile', async () => {
    render(<PublisherDashboard context={CONTEXT} />);
    fireEvent.click(screen.getByRole('button', { name: /^Edit/i }));
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Herald ZW' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/i }));
    await waitFor(() =>
      expect(mockUpdateOrg).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ name: 'Herald ZW' })
      )
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
