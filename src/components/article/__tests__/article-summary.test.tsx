import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ArticleSummary } from '../article-summary'

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
