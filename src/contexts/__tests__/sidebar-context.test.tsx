import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SidebarProvider, useSidebar } from '../sidebar-context'
import { SIDEBAR_DOCK_QUERY, SIDEBAR_STORAGE_KEY } from '@/lib/sidebar'

/** Drives `matchMedia` so a test can put the provider either side of `lg`. */
function mockViewport(docked: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches: docked,
    media: SIDEBAR_DOCK_QUERY,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  return {
    /** Simulate a rotate or a window drag across the breakpoint. */
    resizeTo(nowDocked: boolean) {
      mql.matches = nowDocked
      act(() => {
        listeners.forEach((fn) => fn({ matches: nowDocked } as MediaQueryListEvent))
      })
    },
  }
}

function Probe() {
  const { open, isDocked, toggle, close } = useSidebar()
  return (
    <div>
      <span data-testid="state">{`${open ? 'open' : 'closed'}/${isDocked ? 'docked' : 'overlay'}`}</span>
      <button onClick={toggle}>toggle</button>
      <button onClick={close}>close</button>
    </div>
  )
}

const state = () => screen.getByTestId('state').textContent

describe('SidebarProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-sidebar')
    mockViewport(false)
  })

  it('starts closed when nothing is stored', () => {
    render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>
    )
    expect(state()).toBe('closed/overlay')
  })

  it('restores a stored open sidebar', () => {
    // The reader docked it and means it. Re-opening on every hard load is the
    // same papercut as a theme that does not stick.
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'open')
    render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>
    )
    expect(state()).toBe('open/overlay')
  })

  it('persists a toggle and mirrors it to the document', () => {
    render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>
    )
    fireEvent.click(screen.getByText('toggle'))

    expect(state()).toBe('open/overlay')
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('open')
    // The attribute is what the CSS inset reads on the NEXT load, before any
    // JavaScript runs. Storing without mirroring would leave this load's DOM
    // disagreeing with the state that drives the panel.
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('open')
  })

  it('removes the attribute when closed again', () => {
    render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>
    )
    fireEvent.click(screen.getByText('toggle'))
    fireEvent.click(screen.getByText('close'))

    expect(state()).toBe('closed/overlay')
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('closed')
    expect(document.documentElement.hasAttribute('data-sidebar')).toBe(false)
  })

  it('reports docked when the viewport is wide enough', () => {
    mockViewport(true)
    render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>
    )
    expect(state()).toBe('closed/docked')
  })

  it('follows the viewport across the breakpoint', () => {
    // A tablet rotated, or a window dragged wider. Reading `matchMedia` once
    // at mount would leave a docked-width viewport behaving like a modal —
    // focus trapped inside a column nothing is covering.
    const viewport = mockViewport(false)
    render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>
    )
    expect(state()).toBe('closed/overlay')

    viewport.resizeTo(true)
    expect(state()).toBe('closed/docked')

    viewport.resizeTo(false)
    expect(state()).toBe('closed/overlay')
  })

  it('survives storage being unavailable', () => {
    // Private mode, or blocked site data. A failed read costs the preference,
    // never the page.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>
    )
    expect(state()).toBe('closed/overlay')

    // And it still works for this session, it just will not be remembered.
    fireEvent.click(screen.getByText('toggle'))
    expect(state()).toBe('open/overlay')

    getItem.mockRestore()
    setItem.mockRestore()
  })
})

describe('useSidebar outside a provider', () => {
  it('throws rather than returning a silent default', () => {
    // A default would render a toggle that does nothing and a page that never
    // insets. A dead control is much harder to notice than a crash, and this
    // is wired up in exactly one place, so the failure is always a wiring bug.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/must be used within a SidebarProvider/)
    quiet.mockRestore()
  })
})
