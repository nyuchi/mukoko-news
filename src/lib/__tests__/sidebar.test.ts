import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SIDEBAR_ATTRIBUTE,
  SIDEBAR_DOCK_BREAKPOINT_PX,
  SIDEBAR_DOCK_QUERY,
  SIDEBAR_STORAGE_KEY,
  applySidebarState,
  parseSidebarState,
} from '@/lib/sidebar'

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
const LAYOUT = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8')

describe('parseSidebarState', () => {
  it('treats only the exact string "open" as open', () => {
    expect(parseSidebarState('open')).toBe('open')
  })

  it.each([['closed'], [''], ['OPEN'], ['true'], ['1'], [null], [undefined]])(
    'falls back to closed for %s',
    (raw) => {
      // Strict rather than truthy: a half-written or foreign value must land
      // on the default, not on a sidebar the reader never opened and would
      // have to discover how to close.
      expect(parseSidebarState(raw as string | null | undefined)).toBe('closed')
    }
  )
})

describe('applySidebarState', () => {
  it('sets the attribute when open and REMOVES it when closed', () => {
    // Removing rather than writing "closed" is what keeps the CSS selector a
    // plain [data-sidebar='open'] — one state means "inset the page", and
    // there is no second falsy value that could also match.
    const calls: string[] = []
    const root = {
      setAttribute: (n: string, v: string) => calls.push(`set ${n}=${v}`),
      removeAttribute: (n: string) => calls.push(`remove ${n}`),
    }

    applySidebarState('open', root)
    applySidebarState('closed', root)

    expect(calls).toEqual([`set ${SIDEBAR_ATTRIBUTE}=open`, `remove ${SIDEBAR_ATTRIBUTE}`])
  })
})

/**
 * The sidebar's breakpoint is expressed twice — once in CSS for the page
 * inset, once in `matchMedia` for the behaviour. If they drift there is a band
 * of viewport widths where the page is inset for a sidebar that still thinks
 * it is a modal: a focus trap and a scroll lock on a document nothing covers.
 */
describe('the docking breakpoint', () => {
  it('builds its media query from the one number', () => {
    expect(SIDEBAR_DOCK_QUERY).toBe(`(min-width: ${SIDEBAR_DOCK_BREAKPOINT_PX}px)`)
  })

  it('matches the breakpoint the stylesheet insets the page at', () => {
    const rule = new RegExp(
      `@media \\(min-width:\\s*${SIDEBAR_DOCK_BREAKPOINT_PX}px\\)\\s*\\{[^}]*html\\[data-sidebar='open'\\]`
    )
    expect(
      rule.test(CSS),
      `globals.css has no page-inset rule at ${SIDEBAR_DOCK_BREAKPOINT_PX}px`
    ).toBe(true)
  })

  it('insets by the same token the sidebar sizes itself with', () => {
    // Two numbers here would either overlap the content or leave a gap.
    expect(CSS).toMatch(/html\[data-sidebar='open'\]\s+\.app-shell\s*\{\s*padding-left:\s*var\(--sidebar-width\)/)
  })
})

/**
 * The pre-paint bootstrap cannot import this module — it runs before any
 * module is evaluated — so it repeats the storage key and the attribute as
 * string literals. This is the only thing standing between a rename here and
 * a sidebar that silently forgets it was open. Same guard the outline
 * preference carries in `appearance.test.ts`.
 */
describe('the pre-paint bootstrap', () => {
  it('reads the same storage key this module writes', () => {
    expect(LAYOUT).toContain(`localStorage.getItem('${SIDEBAR_STORAGE_KEY}')`)
  })

  it('sets the same attribute the CSS inset keys off', () => {
    expect(LAYOUT).toContain(`setAttribute('${SIDEBAR_ATTRIBUTE}','open')`)
  })

  it('runs before the app shell so the page is never paints-then-jumps', () => {
    // The whole reason the inset is CSS rather than React: applied from an
    // effect it would shift the entire document sideways one frame after
    // paint, on every hard load, for a reader who left the sidebar open.
    expect(LAYOUT.indexOf('data-sidebar')).toBeLessThan(LAYOUT.indexOf('app-shell'))
  })
})
