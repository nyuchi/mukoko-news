import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NavSidebar } from '../nav-sidebar'
import { DESTINATIONS } from '@/lib/navigation'

const usePathname = vi.fn(() => '/')
vi.mock('next/navigation', () => ({ usePathname: () => usePathname() }))

// `AppIcon` reads the theme context, so rendering the sidebar's brand link bare
// throws "useTheme must be used within a ThemeProvider". The header suite stubs
// it for the same reason — the sidebar is not what is under test here.
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: () => <span data-testid="app-icon" /> }))

// The sidebar reads its state from context. Mocking the hook rather than
// wrapping in a real provider is what lets a test put the component in DOCKED
// mode at all: docking is decided by `matchMedia`, and jsdom answers every
// media query with `matches: false`, so a real provider can only ever produce
// the overlay.
const close = vi.fn()
const toggle = vi.fn()
let state = { open: false, isDocked: false }
vi.mock('@/contexts/sidebar-context', () => ({
  useSidebar: () => ({ ...state, close, toggle }),
}))

const panel = () => document.getElementById('nav-sidebar') as HTMLElement

function renderSidebar(next: { open: boolean; isDocked: boolean }) {
  state = next
  return render(<NavSidebar />)
}

describe('NavSidebar', () => {
  beforeEach(() => {
    usePathname.mockReturnValue('/')
    document.body.style.overflow = ''
    close.mockClear()
    toggle.mockClear()
  })

  it('links to every registered destination', () => {
    // The whole reason this exists: one surface that reaches every page. The
    // footer's five-link version is what it replaced, so a sidebar that
    // quietly renders a subset would put the app straight back where it
    // started.
    renderSidebar({ open: true, isDocked: true })
    const hrefs = new Set(
      screen
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'))
        .filter(Boolean)
    )
    for (const d of DESTINATIONS) {
      expect(hrefs.has(d.href), `sidebar has no link to ${d.href}`).toBe(true)
    }
  })

  it('renders nothing inside the embed iframe', () => {
    // Our markup in somebody else's page carries no app chrome.
    usePathname.mockReturnValue('/embed/iframe')
    const { container } = renderSidebar({ open: true, isDocked: true })
    expect(container).toBeEmptyDOMElement()
  })

  describe('when closed', () => {
    it('cannot be tabbed into', () => {
      // A translate alone leaves every link focusable off-screen — a keyboard
      // reader tabs into an invisible menu and cannot see where they are.
      renderSidebar({ open: false, isDocked: false })
      expect(panel().hasAttribute('inert')).toBe(true)
    })

    it('cannot swallow a tap meant for the page behind it', () => {
      const { container } = renderSidebar({ open: false, isDocked: false })
      const scrim = container.querySelector('[aria-hidden="true"]')
      expect(scrim?.className).toContain('pointer-events-none')
    })

    it('leaves the page scrollable', () => {
      renderSidebar({ open: false, isDocked: false })
      expect(document.body.style.overflow).not.toBe('hidden')
    })
  })

  /**
   * Overlay mode is the phone, where there is no room for a column beside the
   * content. It is a modal and behaves like one.
   */
  describe('as an overlay (below lg)', () => {
    it('is a modal dialog and takes focus', () => {
      renderSidebar({ open: true, isDocked: false })
      expect(panel().getAttribute('role')).toBe('dialog')
      expect(panel().getAttribute('aria-modal')).toBe('true')
      // Focus lands on Close, so a reader who opened it by accident is one
      // keystroke from leaving rather than 20 links deep.
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /close menu/i }))
    })

    it('locks the page behind it', () => {
      const { unmount } = renderSidebar({ open: true, isDocked: false })
      expect(document.body.style.overflow).toBe('hidden')
      unmount()
      expect(document.body.style.overflow).not.toBe('hidden')
    })

    it('closes on Escape, on the scrim, and on the close button', () => {
      const { container } = renderSidebar({ open: true, isDocked: false })

      fireEvent.keyDown(panel(), { key: 'Escape' })
      expect(close).toHaveBeenCalledTimes(1)

      fireEvent.click(container.querySelector('[aria-hidden="true"]')!)
      expect(close).toHaveBeenCalledTimes(2)

      fireEvent.click(screen.getByRole('button', { name: /close menu/i }))
      expect(close).toHaveBeenCalledTimes(3)
    })

    it('closes when a destination is chosen', () => {
      // Otherwise the overlay stays over the page the reader just asked for,
      // which reads as the tap not having worked.
      renderSidebar({ open: true, isDocked: false })
      fireEvent.click(screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/saved')!)
      expect(close).toHaveBeenCalled()
    })

    it('closes itself when the route changes underneath it', () => {
      const { rerender } = renderSidebar({ open: true, isDocked: false })
      close.mockClear()

      usePathname.mockReturnValue('/discover')
      rerender(<NavSidebar />)

      expect(close).toHaveBeenCalled()
    })
  })

  /**
   * Docked mode is the whole point of the change: a sidebar you navigate FROM,
   * repeatedly, without it getting out of the way each time. Every assertion
   * here is a behaviour that would make it a dropdown again if it leaked in
   * from the overlay.
   */
  describe('when docked (lg and up)', () => {
    it('is a navigation landmark, not a modal dialog', () => {
      renderSidebar({ open: true, isDocked: true })
      expect(panel().getAttribute('role')).toBe('navigation')
      // Announcing a column that is simply part of the page as a modal dialog
      // would tell a screen-reader user the rest of the page is unavailable.
      expect(panel().hasAttribute('aria-modal')).toBe(false)
    })

    it('does NOT close when a destination is chosen', () => {
      // This is the difference between a sidebar and a dropdown.
      renderSidebar({ open: true, isDocked: true })
      fireEvent.click(screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/saved')!)
      expect(close).not.toHaveBeenCalled()
    })

    it('stays open across a route change', () => {
      const { rerender } = renderSidebar({ open: true, isDocked: true })
      close.mockClear()

      usePathname.mockReturnValue('/insights')
      rerender(<NavSidebar />)

      expect(close).not.toHaveBeenCalled()
    })

    it('does not lock page scroll', () => {
      // Nothing is covering the document — freezing it would strand the reader
      // on whatever row they happened to be at.
      renderSidebar({ open: true, isDocked: true })
      expect(document.body.style.overflow).not.toBe('hidden')
    })

    it('does not steal focus', () => {
      // The reader revealed a column; they did not open a dialog. Yanking
      // focus out of the article they were reading would be hostile.
      const before = document.activeElement
      renderSidebar({ open: true, isDocked: true })
      expect(document.activeElement).toBe(before)
    })

    it('does not trap Tab', () => {
      renderSidebar({ open: true, isDocked: true })
      const links = screen.getAllByRole('link')
      links[links.length - 1].focus()
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      panel().dispatchEvent(event)
      // Not prevented — focus is free to leave the sidebar for the page.
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not close on Escape', () => {
      // Escape dismisses a modal. There is no modal here, and a reader hitting
      // Escape to clear a search field should not lose their navigation.
      renderSidebar({ open: true, isDocked: true })
      fireEvent.keyDown(panel(), { key: 'Escape' })
      expect(close).not.toHaveBeenCalled()
    })
  })

  it('marks the current route, and only the current route', () => {
    usePathname.mockReturnValue('/insights')
    renderSidebar({ open: true, isDocked: true })
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('href')).toBe('/insights')
  })

  it('renders ONE panel, not one per mode', () => {
    // jsdom applies no media queries, so a second subtree behind `lg:hidden`
    // would render here too and every `getByRole` in this file would match
    // twice. One tree that reshapes is the only thing that keeps that honest.
    renderSidebar({ open: true, isDocked: true })
    expect(document.querySelectorAll('#nav-sidebar')).toHaveLength(1)
  })
})
