import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import { SourceProvenancePanel } from '../source-provenance'
import type { Article } from '@/lib/api'

const mockUseAuth = vi.fn(() => ({ user: null, loading: false }) as {
  user: { id: string } | null
  loading: boolean
})

vi.mock('@workos-inc/authkit-nextjs/components', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/article/abc',
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

function article(over: Partial<Article> = {}): Article {
  return {
    id: 'a1',
    title: 'A headline',
    slug: 'a-headline',
    source: 'Hararemetronews',
    published_at: '2026-09-10T00:00:00.000Z',
    updated_at: '2026-09-10T00:00:00.000Z',
    ...over,
  } as Article
}

const SIGNALS = {
  article_count: 1260,
  last_successful_fetch_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  delivering_since: '2026-06-15T03:55:00.000Z',
  country_code_source: 'assumed' as const,
}

beforeEach(() => {
  mockUseAuth.mockReturnValue({ user: null, loading: false })
})

describe('SourceProvenancePanel', () => {
  it('renders nothing when the source carried no signals', () => {
    const { container } = render(<SourceProvenancePanel article={article()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when every signal is absent rather than an empty panel', () => {
    const { container } = render(
      <SourceProvenancePanel article={article({ source_signals: {} })} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  describe('signed in', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({ user: { id: 'u1' }, loading: false })
    })

    it('shows the counts and timestamps the platform actually holds', () => {
      render(
        <SourceProvenancePanel
          article={article({ source_signals: SIGNALS, country: 'Zimbabwe' })}
        />
      )
      expect(screen.getByText('1,260')).toBeInTheDocument()
      expect(screen.getByText('Articles held')).toBeInTheDocument()
      expect(screen.getByText('Delivering since')).toBeInTheDocument()
      expect(screen.getByText('June 2026')).toBeInTheDocument()
    })

    /**
     * The reason the panel exists. A country with no provenance reads as a fact,
     * and 217 of 414 active sources are `assumed` — the bucket that files
     * `theguardian.com` as Zimbabwean.
     */
    it('qualifies an assumed country instead of stating it bare', () => {
      render(
        <SourceProvenancePanel
          article={article({ source_signals: SIGNALS, country: 'Zimbabwe' })}
        />
      )
      expect(screen.getByText('Zimbabwe')).toBeInTheDocument()
      expect(screen.getByText(/Not corroborated/i)).toBeInTheDocument()
    })

    it('omits the country row when there is no provenance to qualify it with', () => {
      render(
        <SourceProvenancePanel
          article={article({
            source_signals: { ...SIGNALS, country_code_source: undefined },
            country: 'Zimbabwe',
          })}
        />
      )
      expect(screen.queryByText('Country')).not.toBeInTheDocument()
    })

    it('says the record is not a rating', () => {
      render(<SourceProvenancePanel article={article({ source_signals: SIGNALS })} />)
      expect(screen.getByText(/not a rating of the newsroom/i)).toBeInTheDocument()
    })

    it('survives a malformed timestamp rather than rendering "Invalid Date"', () => {
      render(
        <SourceProvenancePanel
          article={article({
            source_signals: { article_count: 5, delivering_since: 'not-a-date' },
          })}
        />
      )
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.queryByText(/invalid date|nan/i)).not.toBeInTheDocument()
    })
  })

  describe('signed out', () => {
    it('withholds the values but names what is behind the gate', () => {
      render(
        <SourceProvenancePanel
          article={article({ source_signals: SIGNALS, country: 'Zimbabwe' })}
        />
      )
      expect(screen.queryByText('1,260')).not.toBeInTheDocument()
      expect(screen.queryByText('June 2026')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
    })

    it('returns the reader to the article they were on', () => {
      render(<SourceProvenancePanel article={article({ source_signals: SIGNALS })} />)
      expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
        'href',
        '/sign-in?returnTo=%2Farticle%2Fabc'
      )
    })

    /**
     * Locked while the session resolves, never the other way round — the
     * opposite flashes the gated values to every anonymous reader on every load,
     * which is not a gate. Same rule as `ArticleSummary`.
     */
    it('stays locked while the session is still resolving', () => {
      mockUseAuth.mockReturnValue({ user: { id: 'u1' }, loading: true })
      render(<SourceProvenancePanel article={article({ source_signals: SIGNALS })} />)
      expect(screen.queryByText('1,260')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
    })
  })

  /**
   * The score this panel replaced rated a casino-affiliate source 85.8
   * ("Established") and rated 200 of its 201 "Established" sources on feeds the
   * platform records as broken. Nothing here may reintroduce a composite.
   */
  it('publishes no score, band or rating', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, loading: false })
    const { container } = render(
      <SourceProvenancePanel
        article={article({ source_signals: SIGNALS, country: 'Zimbabwe' })}
      />
    )
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\/\s*100|Established|Developing|Limited history|trust score/i)
  })
})
