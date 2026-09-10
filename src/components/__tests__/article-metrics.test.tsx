import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockUseAuth = vi.fn();
vi.mock('@workos-inc/authkit-nextjs/components', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetProvenance = vi.fn();
vi.mock('@/lib/actions/article-metrics', () => ({
  getArticleProvenanceAction: (...args: unknown[]) => mockGetProvenance(...args),
}));

import { ArticleMetricsPanel, ArticleReadingMeta } from '@/components/article/article-metrics';
import type { ArticleProvenance } from '@/lib/mongodb/article-metrics';

const ARTICLE = {
  id: 'article-1',
  source: 'The Herald',
  original_url: 'https://www.herald.co.zw/a-story',
  published_at: '2026-09-10T05:00:00.000Z',
  word_count: 529,
  reading_time: 3,
  author: 'Richard Kamau',
};

/** The state 53 live articles are in: ingested, never enriched. */
const UNENRICHED_PROVENANCE: ArticleProvenance = {
  enriched: false,
  enrichedAt: null,
  qualityScore: null,
  qualitySignals: [],
  sentiment: null,
  keywordCount: null,
  namedEntityCount: null,
  hasSummary: false,
  topics: [],
  ingestionMethod: 'rss_feed',
  fulltextMethod: null,
  fulltextFetchedAt: null,
  newsdataEnhancedAt: null,
  linkAudit: null,
  coverage: { enriched: 63781, total: 63834, percent: 99.9 },
};

const ENRICHED_PROVENANCE: ArticleProvenance = {
  ...UNENRICHED_PROVENANCE,
  enriched: true,
  enrichedAt: '2026-09-10T05:25:14.133Z',
  qualityScore: 0.85,
  qualitySignals: [
    { key: 'headline_quality', label: 'Headline quality', value: 0.9 },
    { key: 'content_depth', label: 'Content depth', value: 0.8 },
  ],
  sentiment: 'neutral',
  keywordCount: 7,
  namedEntityCount: 5,
  hasSummary: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: null, loading: false });
  mockGetProvenance.mockResolvedValue(null);
});

describe('reader metrics', () => {
  it('states the length and the reading time', () => {
    render(<ArticleMetricsPanel article={ARTICLE} />);
    expect(screen.getByText(/529 words · 3 min read/)).toBeInTheDocument();
  });

  it('links the source back to the original article', () => {
    render(<ArticleMetricsPanel article={ARTICLE} />);
    const link = screen.getByRole('link', { name: /The Herald/ });
    expect(link).toHaveAttribute('href', 'https://www.herald.co.zw/a-story');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('shows the source without a link rather than rendering an unsafe href', () => {
    render(
      <ArticleMetricsPanel article={{ ...ARTICLE, original_url: 'javascript:alert(1)' }} />
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('The Herald')).toBeInTheDocument();
  });

  it('omits the length row entirely for an article with no word count', () => {
    // The failure mode this guards: "0 words · 0 min read".
    render(
      <ArticleMetricsPanel
        article={{ ...ARTICLE, word_count: undefined, reading_time: undefined }}
      />
    );
    expect(screen.queryByText(/Length/)).toBeNull();
    expect(screen.queryByText(/0 words/)).toBeNull();
    expect(screen.queryByText(/0 min read/)).toBeNull();
  });

  it('omits the byline row for the 54% of articles that have none', () => {
    render(<ArticleMetricsPanel article={{ ...ARTICLE, author: undefined }} />);
    expect(screen.queryByText('Byline')).toBeNull();
    expect(screen.queryByText(/Unknown|Anonymous|Staff Reporter/)).toBeNull();
  });
});

describe('the header reading strip', () => {
  it('renders the reading time and byline', () => {
    render(<ArticleReadingMeta article={ARTICLE} />);
    expect(screen.getByText(/3 min read/)).toBeInTheDocument();
    expect(screen.getByText('By Richard Kamau')).toBeInTheDocument();
  });

  it('renders nothing at all when the article has neither', () => {
    const { container } = render(
      <ArticleReadingMeta
        article={{ ...ARTICLE, reading_time: undefined, author: undefined }}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('does not render a zero reading time', () => {
    render(<ArticleReadingMeta article={{ ...ARTICLE, reading_time: 0 }} />);
    expect(screen.queryByText(/0 min read/)).toBeNull();
  });
});

describe('the staff panel is not shown to readers', () => {
  it('asks for nothing when nobody is signed in', async () => {
    render(<ArticleMetricsPanel article={ARTICLE} />);
    await waitFor(() => expect(screen.queryByText('Pipeline provenance')).toBeNull());
    expect(mockGetProvenance).not.toHaveBeenCalled();
  });

  it('renders nothing when the action refuses a signed-in non-staff caller', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user_reader' }, loading: false });
    mockGetProvenance.mockResolvedValue(null);
    render(<ArticleMetricsPanel article={ARTICLE} />);
    await waitFor(() => expect(mockGetProvenance).toHaveBeenCalledWith('article-1'));
    expect(screen.queryByText('Pipeline provenance')).toBeNull();
    expect(screen.queryByText(/Quality score/)).toBeNull();
  });
});

describe('the staff panel', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { id: 'user_staff' }, loading: false });
  });

  it('shows the quality score and its signals for an enriched article', async () => {
    mockGetProvenance.mockResolvedValue(ENRICHED_PROVENANCE);
    render(<ArticleMetricsPanel article={ARTICLE} />);
    expect(await screen.findByText('Pipeline provenance')).toBeInTheDocument();
    expect(screen.getByText('0.85')).toBeInTheDocument();
    expect(screen.getByText('Headline quality')).toBeInTheDocument();
    expect(screen.getByText('neutral')).toBeInTheDocument();
  });

  it('captions the enrichment-derived numbers with their corpus coverage', async () => {
    mockGetProvenance.mockResolvedValue(ENRICHED_PROVENANCE);
    render(<ArticleMetricsPanel article={ARTICLE} />);
    expect(await screen.findByText(/99\.9% of articles/)).toBeInTheDocument();
    expect(screen.getByText(/63,781 of 63,834/)).toBeInTheDocument();
  });

  it('says coverage is unknown rather than omitting the caveat', async () => {
    mockGetProvenance.mockResolvedValue({ ...ENRICHED_PROVENANCE, coverage: null });
    render(<ArticleMetricsPanel article={ARTICLE} />);
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
  });

  it('shows no quality score at all for an un-enriched article', async () => {
    mockGetProvenance.mockResolvedValue(UNENRICHED_PROVENANCE);
    render(<ArticleMetricsPanel article={ARTICLE} />);
    expect(await screen.findByText(/Not enriched/)).toBeInTheDocument();
    expect(screen.queryByText('Quality score')).toBeNull();
    expect(screen.queryByText('0.00')).toBeNull();
    expect(screen.queryByText('Sentiment')).toBeNull();
  });

  it('says an unaudited article is unaudited, never clean', async () => {
    mockGetProvenance.mockResolvedValue(ENRICHED_PROVENANCE);
    render(<ArticleMetricsPanel article={ARTICLE} />);
    expect(await screen.findByText('Not audited')).toBeInTheDocument();
    expect(screen.queryByText(/No spam links matched/)).toBeNull();
  });

  it('says "no spam links matched" only when an audit actually ran', async () => {
    mockGetProvenance.mockResolvedValue({
      ...ENRICHED_PROVENANCE,
      linkAudit: {
        auditedAt: '2026-09-10T05:22:42.790Z',
        outboundLinks: 3,
        spamDomains: [],
        spamReasons: [],
      },
    });
    render(<ArticleMetricsPanel article={ARTICLE} />);
    expect(await screen.findByText(/No spam links matched/)).toBeInTheDocument();
    expect(screen.getByText(/3 outbound links/)).toBeInTheDocument();
  });

  it('names the flagged domains and why they were flagged', async () => {
    mockGetProvenance.mockResolvedValue({
      ...ENRICHED_PROVENANCE,
      linkAudit: {
        auditedAt: '2026-09-10T05:22:42.790Z',
        outboundLinks: 4,
        spamDomains: ['yupitotocasino1.live'],
        spamReasons: ['anchor-lexicon'],
      },
    });
    render(<ArticleMetricsPanel article={ARTICLE} />);
    expect(await screen.findByText(/1 flagged domain/)).toBeInTheDocument();
    expect(screen.getByText(/yupitotocasino1\.live — anchor-lexicon/)).toBeInTheDocument();
  });

  it('omits the full-text row for the 57% of articles that never needed a fetch', async () => {
    mockGetProvenance.mockResolvedValue(ENRICHED_PROVENANCE);
    render(<ArticleMetricsPanel article={ARTICLE} />);
    await screen.findByText('Pipeline provenance');
    expect(screen.queryByText('Full text')).toBeNull();
    expect(screen.queryByText('newsdata merge')).toBeNull();
    expect(screen.queryByText('Topics')).toBeNull();
  });
});

/**
 * The design-system constraint, asserted on the source because a raw palette
 * utility renders perfectly and only fails in the dark theme, on someone
 * else's screen.
 */
describe('styling uses Mzizi semantic tokens only', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/article/article-metrics.tsx'),
    'utf-8'
  );

  it('uses no raw Tailwind palette utilities', () => {
    const palette =
      /\b(?:bg|text|border|ring|from|to|via|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
    expect(src).not.toMatch(palette);
  });

  it('uses no inline styles', () => {
    expect(src).not.toMatch(/style=\{\{/);
  });

  it('pairs every container fill with its on-container ink', () => {
    const fills = src.match(/bg-container-([a-z]+)/g) ?? [];
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      const mineral = fill.replace('bg-container-', '');
      expect(src).toContain(`text-on-container-${mineral}`);
    }
  });

  it('sizes badges on the touch-target tokens, not fixed heights', () => {
    expect(src).toContain('var(--touch-badge)');
  });
});
