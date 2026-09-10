import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ArticleActionBar } from '../article-action-bar'

const props = {
  isLiked: false,
  likesCount: 0,
  isSaved: false,
  copySuccess: false,
  originalUrl: 'https://hararemetronews.com/story',
  sourceName: 'Harare Metro News',
  onLike: vi.fn(),
  onSave: vi.fn(),
  onShare: vi.fn(),
}

describe('ArticleActionBar', () => {
  it('carries no comments control, because nothing reads the comments', () => {
    // The mock puts a speech bubble with a "0" beside it here. This frontend
    // has never read `news.comments`, so that zero would not be a count — it
    // would state that nobody has commented, which we did not check.
    render(<ArticleActionBar {...props} />)
    expect(screen.queryByRole('link', { name: /comment/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/comment/i)).not.toBeInTheDocument()
  })

  it('carries no Listen control, because there is no audio', () => {
    // The mock renders one with a "4:12" duration. No text-to-speech exists
    // anywhere in this platform, so there is nothing to be 4:12 long.
    render(<ArticleActionBar {...props} />)
    expect(screen.queryByText(/listen/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\d:\d\d/)).not.toBeInTheDocument()
  })

  it('exposes like state to assistive technology, not just as colour', () => {
    const { rerender } = render(<ArticleActionBar {...props} />)
    const like = screen.getByRole('button', { name: 'Like this article' })
    expect(like).toHaveAttribute('aria-pressed', 'false')

    rerender(<ArticleActionBar {...props} isLiked likesCount={1} />)
    expect(screen.getByRole('button', { name: 'Remove like' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('exposes save state the same way', () => {
    const { rerender } = render(<ArticleActionBar {...props} />)
    expect(screen.getByRole('button', { name: 'Save this article' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    rerender(<ArticleActionBar {...props} isSaved />)
    expect(screen.getByRole('button', { name: 'Remove from saved' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('calls each handler exactly once per press', () => {
    const onLike = vi.fn()
    const onSave = vi.fn()
    const onShare = vi.fn()
    render(<ArticleActionBar {...props} onLike={onLike} onSave={onSave} onShare={onShare} />)

    fireEvent.click(screen.getByRole('button', { name: 'Like this article' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save this article' }))
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    expect(onLike).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onShare).toHaveBeenCalledTimes(1)
  })

  it('opens the publisher link safely in a new tab', () => {
    render(<ArticleActionBar {...props} />)
    const link = screen.getByRole('link', { name: /Harare Metro News/ })
    expect(link).toHaveAttribute('href', props.originalUrl)
    expect(link).toHaveAttribute('target', '_blank')
    // `noopener` matters: without it the publisher's page gets a handle on this
    // one through `window.opener`.
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('omits the publisher link entirely when the article has no valid one', () => {
    render(<ArticleActionBar {...props} originalUrl={undefined} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('confirms a share by changing what it says, not only its colour', () => {
    const { rerender } = render(<ArticleActionBar {...props} />)
    expect(screen.getByText('Share')).toBeInTheDocument()
    rerender(<ArticleActionBar {...props} copySuccess />)
    expect(screen.getByText('Copied')).toBeInTheDocument()
  })

  it('is a labelled toolbar', () => {
    render(<ArticleActionBar {...props} />)
    expect(screen.getByRole('toolbar', { name: 'Article actions' })).toBeInTheDocument()
  })

  it('meets the touch-target floor on every control', () => {
    // The bar is thumb-reachable chrome on a phone; a 40px target here is the
    // whole interaction, so the tokens are not decoration.
    const { container } = render(<ArticleActionBar {...props} />)
    for (const el of container.querySelectorAll('button, a')) {
      expect(el.className).toMatch(/min-h-\[var\(--touch-(a11y|default)\)\]/)
    }
  })
})
