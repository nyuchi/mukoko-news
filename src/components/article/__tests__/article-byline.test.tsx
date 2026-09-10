import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ArticleByline } from '../article-byline'
import type { Article } from '@/lib/api'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// The icon resolver fetches a favicon service; the byline's own logic is what
// is under test, so only the rendering half is stubbed.
vi.mock('@/components/ui/source-icon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/source-icon')>()),
  SourceIcon: () => <span data-testid="source-icon" />,
}))

const base: Article = {
  id: 'a1',
  title: 'Test headline',
  slug: 'test-headline',
  source: 'Daily Monitor v2',
  published_at: '2026-09-09T08:00:00.000Z',
}

const DATE = '9 September 2026'

describe('ArticleByline', () => {
  it('attributes to the publisher organisation, not the feed source', () => {
    // 35 organisations on the live cluster hold feed sources whose names
    // disagree, covering 24% of the corpus. The organisation record is the one
    // instance of publisher identity; the feed label is a delivery endpoint.
    render(
      <ArticleByline
        article={{
          ...base,
          publisher: { id: 'o1', name: 'Daily Monitor Uganda', isVerified: false },
        }}
        formattedDate={DATE}
      />
    )
    expect(screen.getByText('Daily Monitor Uganda')).toBeInTheDocument()
    expect(screen.queryByText('Daily Monitor v2')).not.toBeInTheDocument()
  })

  it('falls back to the feed-source name when no organisation resolved', () => {
    render(<ArticleByline article={base} formattedDate={DATE} />)
    expect(screen.getByText('Daily Monitor v2')).toBeInTheDocument()
  })

  it('shows Verified only when the organisation record says so', () => {
    render(
      <ArticleByline
        article={{ ...base, publisher: { id: 'o1', name: 'Herald', isVerified: true } }}
        formattedDate={DATE}
      />
    )
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('renders NO badge at all when the publisher is not verified', () => {
    // Not an "Unverified" pill. Most publishers in this corpus have simply
    // never been through the Tier-2 review, and labelling a real newsroom
    // unverified because staff have not got to it is a claim we have not
    // earned. Absence of a badge is the honest rendering of absence of a review.
    render(
      <ArticleByline
        article={{ ...base, publisher: { id: 'o1', name: 'Herald', isVerified: false } }}
        formattedDate={DATE}
      />
    )
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()
    expect(screen.queryByText(/unverified/i)).not.toBeInTheDocument()
  })

  it('renders no badge when there is no organisation record to read at all', () => {
    render(<ArticleByline article={base} formattedDate={DATE} />)
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()
  })

  it("shows the journalist's byline when the pipeline resolved one", () => {
    render(<ArticleByline article={{ ...base, author: 'Tendai Moyo' }} formattedDate={DATE} />)
    expect(screen.getByText('By Tendai Moyo')).toBeInTheDocument()
  })

  it('omits the byline entirely rather than crediting the outlet', () => {
    // 38,712 of 38,926 articles carried no author before the 2026-09 backfill,
    // so absent is the common case. Falling back to the masthead would credit a
    // newsroom for a piece whose author we simply do not know.
    render(<ArticleByline article={base} formattedDate={DATE} />)
    expect(screen.queryByText(/^By /)).not.toBeInTheDocument()
  })

  it('names the country rather than printing a bare ISO code', () => {
    render(<ArticleByline article={{ ...base, country: 'ZW' }} formattedDate={DATE} />)
    expect(screen.getByText('Zimbabwe')).toBeInTheDocument()
    expect(screen.queryByText('ZW')).not.toBeInTheDocument()
  })

  it('shows no place for a country code the app has no entry for', () => {
    // `places` owns geography and can list a country before this app has art
    // for it. Printing "XK" under a byline reads as a typo, not a location.
    render(<ArticleByline article={{ ...base, country: 'XK' }} formattedDate={DATE} />)
    expect(screen.queryByText('XK')).not.toBeInTheDocument()
  })

  it('emits a machine-readable published date', () => {
    const { container } = render(<ArticleByline article={base} formattedDate={DATE} />)
    const time = container.querySelector('time')
    expect(time?.getAttribute('dateTime')).toBe(base.published_at)
    expect(time?.textContent).toBe(DATE)
  })

  it('has no Follow control, because nothing stores a follow', () => {
    // The design mock puts one here. There is no collection, no action and no
    // read behind it in this app, so the button would either do nothing or
    // write somewhere it does not belong.
    render(<ArticleByline article={base} formattedDate={DATE} />)
    expect(screen.queryByRole('button', { name: /follow/i })).not.toBeInTheDocument()
  })
})
