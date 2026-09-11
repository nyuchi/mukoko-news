import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ArticleSummary, firstSentence } from '../article-summary'

// The AuthKit client entry pulls server-only modules through vitest, and the
// suite is about what the card SAYS, not about the session. Same stub the
// user-avatar and article-metrics suites use.
const mockUseAuth = vi.fn<() => { user: { id: string } | null; loading: boolean }>(() => ({
  user: { id: 'u1' },
  loading: false,
}))
vi.mock('@workos-inc/authkit-nextjs/components', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/article/abc' }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

beforeEach(() => {
  // Signed in by default, so the existing assertions below still describe the
  // card a reader with an account sees.
  mockUseAuth.mockReturnValue({ user: { id: 'u1' }, loading: false })
})

/**
 * The summary card must never be mistaken for the newsroom's own words.
 *
 * The design mock heads this slot "Key takeaways" with three editorial-looking
 * bullets. What the platform actually has is `aiSummary` — one paragraph
 * written by Qwen from the article body. The gap between those two things is
 * the entire subject of this file.
 */
describe('ArticleSummary', () => {
  it('renders nothing when the article has no summary', () => {
    // Unenriched articles are common — the drain backlog runs into thousands at
    // any moment. A card saying "no summary available" is worse than the reader
    // simply reading on.
    const { container } = render(<ArticleSummary summary={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a summary that is only whitespace', () => {
    // An expression, not a JSX attribute string: inside `summary="  \\n "`
    // the escape is not interpreted, so the value would be a literal
    // backslash-n and the assertion would be testing the wrong thing.
    const { container } = render(<ArticleSummary summary={'   \n\t  '} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels the summary as machine-written', () => {
    // Without this label a reader takes the paragraph for the publisher's own
    // standfirst, which is a claim about who wrote the words.
    render(<ArticleSummary summary="Parliament passed the bill on Tuesday." />)
    expect(screen.getByText('AI summary')).toBeInTheDocument()
  })

  it('never calls itself "Key takeaways"', () => {
    // The mock's heading. It implies a person distilled the piece; nobody did.
    render(<ArticleSummary summary="Parliament passed the bill on Tuesday." />)
    expect(screen.queryByText(/key takeaways/i)).not.toBeInTheDocument()
  })

  it('shows the summary text', () => {
    render(<ArticleSummary summary="Parliament passed the bill on Tuesday." />)
    expect(screen.getByText('Parliament passed the bill on Tuesday.')).toBeInTheDocument()
  })

  it('sits on the sodalite container, the mineral reserved for AI surfaces', () => {
    // Consistency across the platform is what makes the signal readable: if
    // every AI surface looks the same, a reader learns it once.
    const { container } = render(<ArticleSummary summary="A summary." />)
    const section = container.querySelector('section')!
    expect(section.className).toContain('bg-container-sodalite')
  })
})

/**
 * The summary is a gated feature (owner decision 2026-09-11): signed-in
 * readers and subscribers only. The gate has to CONVERT, though — a component
 * that simply vanishes for anonymous readers teaches them nothing about what
 * they are missing.
 */
describe('the sign-in gate', () => {
  const summary = 'Gaming has become a creative medium. It now reaches billions of players.'

  it('shows the full summary to a signed-in reader', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, loading: false })
    render(<ArticleSummary summary={summary} />)
    expect(screen.getByText(summary)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull()
  })

  it('withholds the full text from an anonymous reader', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false })
    render(<ArticleSummary summary={summary} />)
    expect(screen.queryByText(summary)).toBeNull()
  })

  it('teases the first sentence rather than showing a blank card', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false })
    render(<ArticleSummary summary={summary} />)
    // The card still announces itself, so a reader learns the feature exists.
    expect(screen.getByText(/ai summary/i)).toBeInTheDocument()
    expect(screen.getByText(/Gaming has become a creative medium\./)).toBeInTheDocument()
    // …but not the sentence behind the gate.
    expect(screen.queryByText(/reaches billions/)).toBeNull()
  })

  it('sends the reader back to the article after signing in', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false })
    render(<ArticleSummary summary={summary} />)
    const link = screen.getByRole('link', { name: /sign in to read the summary/i })
    expect(link.getAttribute('href')).toBe('/sign-in?returnTo=%2Farticle%2Fabc')
  })

  it('stays locked while the session is still resolving', () => {
    // The other way round would flash the gated text to every anonymous
    // reader on every load, which is not a gate.
    mockUseAuth.mockReturnValue({ user: null, loading: true })
    render(<ArticleSummary summary={summary} />)
    expect(screen.queryByText(summary)).toBeNull()
  })

  it('still renders nothing at all when there is no summary', () => {
    // An unenriched article gets no card in either state — a locked card over
    // a summary that does not exist would advertise a feature that has nothing
    // behind it for this article.
    mockUseAuth.mockReturnValue({ user: null, loading: false })
    const { container } = render(<ArticleSummary summary={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('firstSentence', () => {
  it('cuts on the sentence boundary, not mid-word', () => {
    expect(firstSentence('One thing. Two thing.')).toBe('One thing.')
    expect(firstSentence('A question? And more.')).toBe('A question?')
  })

  it('falls back to a hard cut for one long unpunctuated run', () => {
    const long = 'x'.repeat(400)
    const out = firstSentence(long)
    expect(out.length).toBeLessThanOrEqual(180)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns a short summary whole', () => {
    expect(firstSentence('Short one.')).toBe('Short one.')
  })
})
