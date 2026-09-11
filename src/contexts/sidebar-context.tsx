'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import {
  SIDEBAR_DOCK_QUERY,
  applySidebarState,
  readSidebarState,
  storeSidebarState,
} from '@/lib/sidebar'

/**
 * Who knows whether the sidebar is open.
 *
 * Three components need this answer and none of them contains the others: the
 * header draws the toggle, the sidebar draws itself, and the app shell insets
 * the page. So it is context rather than props — lifting it into the layout
 * and threading it down would put the state in a server component, which
 * cannot hold it.
 *
 * `isDocked` is here for the same reason it cannot be a CSS class: the
 * behaviours that differ between the two modes are focus trapping, scroll
 * locking and closing on navigation, and none of those can be expressed in a
 * media query. It is read from `matchMedia` and kept live, so a reader who
 * rotates a tablet or drags a window across the breakpoint gets the right
 * behaviour rather than the one their viewport had at mount.
 */
interface SidebarContextValue {
  open: boolean
  /** True once the viewport is wide enough for the sidebar to take layout space. */
  isDocked: boolean
  toggle: () => void
  close: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Starts closed on BOTH server and client so the first client render matches
  // the server's HTML exactly. The stored value is applied in the effect below
  // — a frame late for the panel, which animates anyway, while the page inset
  // is already correct from the pre-paint bootstrap. See `lib/sidebar.ts`.
  const [open, setOpen] = useState(false)
  const [isDocked, setIsDocked] = useState(false)

  useEffect(() => {
    setOpen(readSidebarState() === 'open')
  }, [])

  useEffect(() => {
    const query = window.matchMedia(SIDEBAR_DOCK_QUERY)
    const sync = () => setIsDocked(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  // Persist and mirror to the document, so a reload is inset before first paint.
  const commit = useCallback((next: boolean) => {
    setOpen(next)
    const state = next ? 'open' : 'closed'
    storeSidebarState(state)
    applySidebarState(state, document.documentElement)
  }, [])

  const toggle = useCallback(() => commit(!open), [commit, open])
  const close = useCallback(() => commit(false), [commit])

  const value = useMemo(
    () => ({ open, isDocked, toggle, close }),
    [open, isDocked, toggle, close]
  )

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

/**
 * Read the sidebar state.
 *
 * Throws outside a provider rather than returning a default. A silent default
 * would render a toggle that does nothing and a page that never insets — a
 * dead control is harder to notice than a crash, and this is wired up in
 * exactly one place (the root layout), so the failure is always a wiring bug.
 */
export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider')
  return context
}
