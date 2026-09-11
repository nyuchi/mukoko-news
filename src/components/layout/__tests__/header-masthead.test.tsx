import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Header } from '../header'
import { SidebarProvider } from '@/contexts/sidebar-context'

const mockPathname = vi.fn(() => '/')
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('../user-avatar', () => ({ UserAvatar: () => <div data-testid="user-avatar" /> }))
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: () => <span data-testid="app-icon" /> }))
vi.mock('../datetime-weather', () => ({ DateTimeWeather: () => <div /> }))

const renderHeader = () =>
  render(
    <SidebarProvider>
      <Header />
    </SidebarProvider>
  )

const wordmark = () => screen.getByText('mukoko news')
const brandLink = () => wordmark().closest('a')!

/**
 * The masthead sits at the LEFT of the header, and it got there by being put
 * back into the flow.
 *
 * Owner report 2026-09-11, from a phone screenshot of production: *"Look at
 * the header the wordmark needs to be left not centered"* — with "mukoko
 * news" sitting mid-header and its last letters underneath the actions pill.
 *
 * The cause was not a `justify-` class. The lockup and the scrolled page title
 * were two `position: absolute` children of a `relative` box, so that box
 * measured ZERO WIDE — absolutely positioned children contribute nothing to
 * their parent's size. A zero-width flex item between the toggle and the pill
 * is placed by `justify-between` in the MIDDLE of the free space, and the
 * wordmark, overflowing it, ran out from there and straight under the pill.
 *
 * These assertions are about layout participation rather than about a class
 * that happens to spell "left": a future edit that reintroduces the absolute
 * stack would put the wordmark back in the middle without touching any
 * alignment class at all.
 */
describe('Header — the masthead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname.mockReturnValue('/')
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-sidebar')
  })

  it('is in the flow — it is not an absolutely positioned overlay', () => {
    renderHeader()
    expect(brandLink().className).not.toContain('absolute')
    expect(brandLink().parentElement!.className).not.toContain('relative')
  })

  it('gives its container a real width by stacking in a grid cell', () => {
    // The cross-fade with the scrolled page title still needs the two layers
    // on top of each other. A one-cell grid does that AND sizes the container
    // to the wider of them, which is the whole difference from `absolute`.
    renderHeader()
    const stack = brandLink().parentElement!
    expect(stack.className).toContain('grid')
    for (const layer of Array.from(stack.children)) {
      expect(layer.className).toContain('col-start-1')
      expect(layer.className).toContain('row-start-1')
    }
  })

  it('is the first thing in the header after the sidebar toggle', () => {
    const { container } = renderHeader()
    const interactive = Array.from(container.querySelectorAll('button, a[href]'))
    const toggle = screen.getByRole('button', { name: /show sidebar|hide sidebar/i })
    expect(interactive[0]).toBe(toggle)
    expect(interactive[1]).toBe(brandLink())
  })

  it('shrinks rather than sliding under the actions pill', () => {
    // With a real width the lockup takes part in flex shrinking, so a narrow
    // phone ellipsises the wordmark instead of pushing it beneath the pill.
    // `min-w-0` is what lets it shrink below its content at all.
    renderHeader()
    expect(brandLink().className).toContain('min-w-0')
    expect(wordmark().className).toContain('truncate')
  })

  it('still cross-fades with the scrolled page title rather than reflowing', () => {
    // Both layers are mounted at once and swapped by opacity — that is what
    // the stack is for. If one were conditionally rendered instead, the header
    // would change width mid-scroll and the wordmark would jump.
    renderHeader()
    const [brand, title] = Array.from(brandLink().parentElement!.children)
    expect(brand.className).toContain('opacity-100')
    expect(title.className).toContain('opacity-0')
    expect(title.className).toContain('pointer-events-none')
    expect(title.textContent).toContain('feed')
  })
})
