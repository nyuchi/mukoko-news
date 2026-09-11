import { Bookmark, Heart, Share2 } from 'lucide-react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BottomNav } from '../bottom-nav'
import { IslandProvider, useIslandActions, type IslandAction } from '@/contexts/island-context'
import { ISLAND_ACCOUNT_HREF, ISLAND_DEFAULT_HREFS, ISLAND_HOME_HREF } from '@/lib/navigation'

const mockUsePathname = vi.fn(() => '/')
vi.mock('next/navigation', () => ({ usePathname: () => mockUsePathname() }))

/** A page that contributes actions, the way the article client does. */
function ContributingPage({ actions }: { actions: IslandAction[] | null }) {
  useIslandActions(actions)
  return null
}

function renderWith(actions: IslandAction[] | null, path = '/article/abc') {
  mockUsePathname.mockReturnValue(path)
  return render(
    <IslandProvider>
      <ContributingPage actions={actions} />
      <BottomNav />
    </IslandProvider>
  )
}

const island = () => screen.getByRole('navigation', { name: /main navigation/i })
const slotLabels = () =>
  Array.from(island().querySelectorAll('a, button')).map((el) => el.textContent?.trim())

describe('the island at rest', () => {
  beforeEach(() => mockUsePathname.mockReturnValue('/'))

  it('falls back to navigation when the page contributes nothing', () => {
    // A reading surface with no actions of its own should still be
    // navigation, not a gap where three controls used to be.
    renderWith(null, '/')
    const hrefs = Array.from(island().querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual([ISLAND_HOME_HREF, ...ISLAND_DEFAULT_HREFS, ISLAND_ACCOUNT_HREF])
  })

  it('is no longer hidden above the phone breakpoint', () => {
    // It was `md:hidden`, which is why a second bar existed on desktop at all
    // — and why that bar shipped left-anchored with an invisible Share button.
    renderWith(null, '/')
    expect(island().className).not.toContain('md:hidden')
  })
})

describe('the island on a page with its own actions', () => {
  const actions: IslandAction[] = [
    { id: 'like', label: 'Like', icon: Heart, onSelect: () => {}, active: false, count: 3 },
    { id: 'save', label: 'Save', icon: Bookmark, onSelect: () => {}, active: false },
    { id: 'share', label: 'Share', icon: Share2, onSelect: () => {}, emphasis: 'primary' },
  ]

  it('keeps Feed and Profile at the two ends', () => {
    // The whole contract: the way home and the way to your account never move,
    // because a control that shifts under your thumb between pages is worse
    // than no control.
    renderWith(actions)
    const slots = Array.from(island().querySelectorAll('a, button'))
    expect(slots[0].getAttribute('href')).toBe(ISLAND_HOME_HREF)
    expect(slots[slots.length - 1].getAttribute('href')).toBe(ISLAND_ACCOUNT_HREF)
  })

  it('swaps the middle for the page’s actions', () => {
    renderWith(actions)
    expect(slotLabels()).toEqual(['Feed', '3', 'Save', 'Share', 'Profile'])
    // The default destinations are gone while the page owns the middle.
    const hrefs = Array.from(island().querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).not.toContain('/discover')
  })

  it('renders an action as a button and a destination as a link', () => {
    renderWith(actions)
    expect(screen.getByRole('button', { name: /^Like$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Feed/ })).toBeInTheDocument()
  })

  it('announces a pressed action with aria-pressed, not aria-current', () => {
    // Liked is a toggle state; "the page you are on" is a different claim and
    // gets a different attribute.
    renderWith([{ ...actions[0], active: true }])
    const like = screen.getByRole('button', { name: /^Like$/ })
    expect(like.getAttribute('aria-pressed')).toBe('true')
    expect(like.hasAttribute('aria-current')).toBe(false)
  })

  it('sends an external action out with the rel guard', () => {
    renderWith([
      { id: 'original', label: 'Original', icon: Share2, href: 'https://example.com/x', external: true },
    ])
    const link = screen.getByRole('link', { name: /Original/ })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    // An outbound link is never "the page you are on".
    expect(link.hasAttribute('aria-current')).toBe(false)
  })

  it('runs the handler the page gave it', () => {
    const onSelect = vi.fn()
    renderWith([{ id: 'like', label: 'Like', icon: Heart, onSelect }])
    fireEvent.click(screen.getByRole('button', { name: /^Like$/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('clears back to navigation when the contributing page unmounts', () => {
    // Otherwise the last article's Like button floats over an unrelated page.
    const { rerender } = renderWith(actions)
    expect(slotLabels()).toContain('Save')

    rerender(
      <IslandProvider>
        <BottomNav />
      </IslandProvider>
    )
    expect(slotLabels()).not.toContain('Save')
  })
})

/**
 * The correctness argument for the whole mechanism.
 *
 * A page's handlers are closures over its state. If the island stored the
 * first render's `onSelect`, a tap after the state changed would run against
 * a stale value — you would un-like an article you had just liked, or like it
 * twice. The hook re-registers whenever the action SIGNATURE changes, and the
 * signature covers the state those closures read.
 */
describe('handler freshness', () => {
  function Counter() {
    const [count, setCount] = useState(0)
    useIslandActions([
      {
        id: 'bump',
        label: 'Bump',
        icon: Heart,
        count,
        // Closes over `count`. Stale capture would stick the island at 1.
        onSelect: () => setCount(count + 1),
      },
    ])
    return null
  }

  it('re-registers so a handler always sees current state', () => {
    mockUsePathname.mockReturnValue('/')
    render(
      <IslandProvider>
        <Counter />
        <BottomNav />
      </IslandProvider>
    )

    const bump = () => screen.getByRole('button', { name: /Bump/ })
    fireEvent.click(bump())
    expect(bump().textContent).toContain('1')

    // The second click is the one that catches a stale closure: it can only
    // reach 2 if the handler stored after the first click saw count === 1.
    fireEvent.click(bump())
    expect(bump().textContent).toContain('2')

    fireEvent.click(bump())
    expect(bump().textContent).toContain('3')
  })
})

describe('useIslandActions outside a provider', () => {
  it('throws rather than silently dropping the page’s actions', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<ContributingPage actions={null} />)).toThrow(
      /must be used within an IslandProvider/
    )
    quiet.mockRestore()
  })
})
