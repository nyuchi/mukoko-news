import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NavSidebar } from '../nav-sidebar'
import { DESTINATIONS } from '@/lib/navigation'

const usePathname = vi.fn(() => '/')
vi.mock('next/navigation', () => ({ usePathname: () => usePathname() }))

// `AppIcon` reads the theme context, so rendering the drawer's brand link bare
// throws "useTheme must be used within a ThemeProvider". The header suite stubs
// it for the same reason — the drawer is not what is under test here.
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: () => <span data-testid="app-icon" /> }))

const panel = () => screen.getByRole('dialog', { name: /all pages/i })

describe('NavSidebar', () => {
  beforeEach(() => {
    usePathname.mockReturnValue('/')
    document.body.style.overflow = ''
  })

  it('links to every registered destination', () => {
    // The whole reason this exists: one surface that reaches every page. The
    // footer's five-link version is what it replaced, so a drawer that quietly
    // renders a subset would put the app straight back where it started.
    render(<NavSidebar open onClose={() => {}} />)
    const hrefs = new Set(
      screen
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'))
        .filter(Boolean)
    )
    for (const d of DESTINATIONS) {
      expect(hrefs.has(d.href), `drawer has no link to ${d.href}`).toBe(true)
    }
  })

  it('sits above the floating bottom bar rather than under it', () => {
    // The pill is z-50. If the drawer shared that layer the bar would punch
    // through an open drawer, which is the collision this whole change is
    // meant to avoid.
    render(<NavSidebar open onClose={() => {}} />)
    expect(panel().className).toContain('z-[60]')
  })

  describe('when closed', () => {
    it('cannot be tabbed into', () => {
      // A translate alone leaves every link focusable off-screen — a keyboard
      // reader tabs into an invisible menu and cannot see where they are.
      render(<NavSidebar open={false} onClose={() => {}} />)
      expect(panel().hasAttribute('inert')).toBe(true)
    })

    it('cannot swallow a tap meant for the page behind it', () => {
      const onClose = vi.fn()
      const { container } = render(<NavSidebar open={false} onClose={onClose} />)
      const scrim = container.querySelector('[aria-hidden="true"]')
      expect(scrim?.className).toContain('pointer-events-none')
    })

    it('leaves the page scrollable', () => {
      render(<NavSidebar open={false} onClose={() => {}} />)
      expect(document.body.style.overflow).not.toBe('hidden')
    })
  })

  describe('when open', () => {
    it('is a modal dialog and takes focus', () => {
      render(<NavSidebar open onClose={() => {}} />)
      expect(panel().getAttribute('aria-modal')).toBe('true')
      // Focus lands on Close, so a reader who opened it by accident is one
      // keystroke from leaving rather than 20 links deep.
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /close menu/i }))
    })

    it('locks the page behind it', () => {
      const { unmount } = render(<NavSidebar open onClose={() => {}} />)
      expect(document.body.style.overflow).toBe('hidden')
      unmount()
      expect(document.body.style.overflow).not.toBe('hidden')
    })

    it('closes on Escape, on the scrim, and on the close button', () => {
      const onClose = vi.fn()
      const { container } = render(<NavSidebar open onClose={onClose} />)

      fireEvent.keyDown(panel(), { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)

      fireEvent.click(container.querySelector('[aria-hidden="true"]')!)
      expect(onClose).toHaveBeenCalledTimes(2)

      fireEvent.click(screen.getByRole('button', { name: /close menu/i }))
      expect(onClose).toHaveBeenCalledTimes(3)
    })

    it('closes when a destination is chosen', () => {
      // Otherwise the drawer stays open over the page the reader just asked
      // for, which reads as the tap not having worked.
      const onClose = vi.fn()
      render(<NavSidebar open onClose={onClose} />)
      fireEvent.click(screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/saved')!)
      expect(onClose).toHaveBeenCalled()
    })

    it('hands focus back to the trigger on close', () => {
      const trigger = document.createElement('button')
      document.body.appendChild(trigger)
      const ref = { current: trigger }

      const { rerender } = render(<NavSidebar open onClose={() => {}} returnFocusRef={ref} />)
      expect(document.activeElement).not.toBe(trigger)

      rerender(<NavSidebar open={false} onClose={() => {}} returnFocusRef={ref} />)
      expect(document.activeElement).toBe(trigger)

      trigger.remove()
    })

    it('marks the current route, and only the current route', () => {
      usePathname.mockReturnValue('/insights')
      render(<NavSidebar open onClose={() => {}} />)
      const current = screen
        .getAllByRole('link')
        .filter((a) => a.getAttribute('aria-current') === 'page')
      expect(current).toHaveLength(1)
      expect(current[0].getAttribute('href')).toBe('/insights')
    })
  })

  it('closes itself when the route changes underneath it', () => {
    const onClose = vi.fn()
    const { rerender } = render(<NavSidebar open onClose={onClose} />)
    onClose.mockClear()

    usePathname.mockReturnValue('/discover')
    rerender(<NavSidebar open onClose={onClose} />)

    expect(onClose).toHaveBeenCalled()
  })
})
