import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Header } from '../header'
import { SidebarProvider } from '@/contexts/sidebar-context'
import { SIDEBAR_STORAGE_KEY } from '@/lib/sidebar'

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

const toggle = () => screen.getByRole('button', { name: /show sidebar|hide sidebar/i })

/**
 * Three things about this control were wrong in the first cut and named
 * explicitly in owner review: it sat on the RIGHT inside the actions pill, it
 * wore a HAMBURGER, and it opened a menu rather than a sidebar. The first two
 * are asserted here; the third lives in `nav-sidebar.test.tsx`.
 */
describe('Header — the sidebar toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname.mockReturnValue('/')
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-sidebar')
  })

  it('is the first control in the header — the far left', () => {
    // "Far left" is a claim about ORDER, not about a class name, so this asks
    // the DOM rather than the stylesheet. It sat in the actions pill on the
    // right, grouped with search and the account control, which is the one
    // place a sidebar toggle never goes.
    const { container } = renderHeader()
    const interactive = container.querySelectorAll('button, a[href]')
    expect(interactive[0]).toBe(toggle())
  })

  it('wears the standard sidebar glyph, not a hamburger', () => {
    // A hamburger promises a menu that drops down and goes away. This reveals
    // a column that stays, and readers already know the panel icon from every
    // editor and mail client they use.
    renderHeader()
    const icon = toggle().querySelector('svg')
    expect(icon?.getAttribute('class')).toContain('lucide-panel-left')
  })

  it('says what the next tap does, and swaps the glyph when open', () => {
    renderHeader()
    expect(toggle()).toHaveAccessibleName('Show sidebar')
    expect(toggle().getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle())

    expect(toggle()).toHaveAccessibleName('Hide sidebar')
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(toggle().querySelector('svg')?.getAttribute('class')).toContain('lucide-panel-left-close')
  })

  it('points at the panel it controls', () => {
    // Without this a screen reader announces a button with a state and no
    // subject — "expanded", of what?
    renderHeader()
    expect(toggle().getAttribute('aria-controls')).toBe('nav-sidebar')
  })

  it('persists the reader’s choice', () => {
    renderHeader()
    fireEvent.click(toggle())
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('open')
  })

  it('is absent inside the embed iframe', () => {
    // Our markup in somebody else's page has no sidebar to toggle.
    mockPathname.mockReturnValue('/embed/iframe')
    renderHeader()
    expect(screen.queryByRole('button', { name: /sidebar/i })).toBeNull()
  })

  it('no longer offers a second, hamburger-shaped way in', () => {
    // The old trigger lived in the actions pill. Leaving both would be two
    // controls for one panel, which is how the header ended up with a
    // page-list dropdown beside a drawer in the first place.
    renderHeader()
    expect(screen.getAllByRole('button', { name: /menu|sidebar/i })).toHaveLength(1)
  })
})
