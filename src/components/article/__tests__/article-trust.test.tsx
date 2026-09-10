import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ArticleTrustPanel } from '../article-trust'
import type { Article } from '@/lib/api'

/**
 * The trust panel's whole job is to say only what the platform actually knows.
 *
 * These tests are mostly about ABSENCE, because absence is where this kind of
 * component goes wrong: an unscored publisher rendered at 0/100, or a
 * corrections line that reads "none issued" when nothing was ever checked, are
 * both claims about a real newsroom that Mukoko never made. The pipeline has
 * the same rule written down for `countryCode` — a null is a known gap, a wrong
 * value is a silent error every reader takes as fact.
 */

const base: Article = {
  id: 'a1',
  title: 'Test headline',
  slug: 'test-headline',
  source: 'The Herald',
  published_at: '2026-09-09T08:00:00.000Z',
}

const withTrust = (source_trust?: number): Article => ({ ...base, source_trust })

describe('ArticleTrustPanel', () => {
  it('renders nothing at all when the source has never been scored', () => {
    const { container } = render(<ArticleTrustPanel article={withTrust(undefined)} />)
    // Not an empty card, not "unrated", not a zeroed bar — nothing.
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a genuine zero, because zero is a real score', () => {
    // The distinction this component turns on: `undefined` is "nobody looked",
    // `0` is "somebody looked and this is what they found". Collapsing the two
    // in either direction publishes something false.
    render(<ArticleTrustPanel article={withTrust(0)} />)
    expect(screen.getByText('0 / 100')).toBeInTheDocument()
  })

  it('shows the score and names the publisher it describes', () => {
    render(<ArticleTrustPanel article={{ ...withTrust(82), source: 'Harare Metro News' }} />)
    expect(screen.getByText('82 / 100')).toBeInTheDocument()
    expect(screen.getByText(/Harare Metro News/)).toBeInTheDocument()
  })

  it('prefers the publisher organisation name over the feed-source label', () => {
    // One newsroom holds several feed sources under names that disagree; the
    // organisation record is the single instance of publisher identity.
    render(
      <ArticleTrustPanel
        article={{
          ...withTrust(55),
          source: 'Daily Monitor v2',
          publisher: { id: 'o1', name: 'Daily Monitor Uganda', isVerified: true },
        }}
      />
    )
    expect(screen.getByText(/Daily Monitor Uganda/)).toBeInTheDocument()
    expect(screen.queryByText(/Daily Monitor v2/)).not.toBeInTheDocument()
  })

  it('says the score describes the SOURCE, not this article', () => {
    // A per-source score displayed on an article page reads as a score for the
    // article unless the copy says otherwise. It is not: a trusted outlet can
    // publish a weak piece and an unscored one a strong piece.
    render(<ArticleTrustPanel article={withTrust(82)} />)
    expect(screen.getByText(/describes the/)).toBeInTheDocument()
    expect(screen.getByText('source')).toBeInTheDocument()
  })

  it.each([
    [95, 'Established'],
    [70, 'Established'],
    [69, 'Developing'],
    [40, 'Developing'],
    [39, 'Limited history'],
    [0, 'Limited history'],
  ])('bands %i as "%s"', (score, label) => {
    render(<ArticleTrustPanel article={withTrust(score)} />)
    expect(screen.getByText(`${label}.`)).toBeInTheDocument()
  })

  it('never claims anything about corrections', () => {
    // The design mock pairs the score with "No corrections issued". There is no
    // corrections store anywhere in this platform, so that sentence would not
    // be a read — it would be an assertion that none exist because nobody
    // looked. If someone adds the copy without adding the collection, this
    // fails.
    render(<ArticleTrustPanel article={withTrust(82)} />)
    expect(screen.queryByText(/correction/i)).not.toBeInTheDocument()
  })

  it('keeps the bar inside its track for every score it renders', () => {
    const { container } = render(<ArticleTrustPanel article={withTrust(100)} />)
    const bar = container.querySelector('[style*="width"]') as HTMLElement
    expect(bar.style.width).toBe('100%')
  })
})
