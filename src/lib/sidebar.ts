/**
 * Whether the navigation sidebar is open, and how wide it is when it is.
 *
 * ## Two modes, one component
 *
 * From `lg` up the sidebar is **docked**: it occupies real layout space, the
 * page is inset by its width, and it stays open while the reader moves between
 * pages. That is the whole point of a sidebar rather than a menu — you navigate
 * *from* it repeatedly, so it closing on every click would make it a dropdown
 * with extra steps.
 *
 * Below `lg` there is no room for a 17rem column beside the content, so it
 * becomes an **overlay**: scrim, focus trap, scroll lock, and it closes when a
 * destination is chosen. Those behaviours belong to the overlay only — applied
 * while docked they would trap a keyboard reader inside a panel that is simply
 * part of the page, and lock the scroll of a document nothing is covering.
 *
 * ## Why the state is persisted
 *
 * Within a session the provider lives in the root layout, which does not
 * remount on client-side navigation, so the sidebar already survives every
 * in-app link. `localStorage` is for the reload: a reader who docked the
 * sidebar means it, and having to re-open it on every hard load is the same
 * papercut as a theme that does not stick.
 *
 * ## The one-frame problem, and which half of it matters
 *
 * The stored value is read in an effect, which is a paint too late. That is
 * fine for the PANEL — it animates in on a transform, so arriving a frame late
 * reads as the animation rather than a glitch. It is NOT fine for the page
 * INSET, which would be a visible sideways jump of the entire document.
 *
 * So the inset is driven by `data-sidebar` on the root element, set pre-paint
 * by the bootstrap script in `layout.tsx`, and the CSS applies it at `lg` with
 * no JavaScript involved. Same split, and same reasoning, as the outline
 * preference in `appearance.ts`.
 */

export type SidebarState = 'open' | 'closed'

/**
 * Storage key.
 *
 * The pre-paint bootstrap in `layout.tsx` reads this as a STRING LITERAL — it
 * runs before any module is evaluated, so it cannot import from here. A test
 * asserts the two still agree; that is the only thing standing between a
 * rename here and a sidebar that silently forgets it was open.
 */
export const SIDEBAR_STORAGE_KEY = 'mukoko-news-sidebar'

/** The attribute the CSS inset keys off. */
export const SIDEBAR_ATTRIBUTE = 'data-sidebar'

/**
 * The viewport at which the sidebar docks instead of overlaying.
 *
 * Exported as a number AND used to build the query string, so the CSS
 * breakpoint and the JavaScript one cannot drift apart — if they did, there
 * would be a band of widths where the page is inset for a sidebar that still
 * thinks it is a modal, or vice versa. `sidebar.test.ts` asserts this matches
 * the `lg` breakpoint the stylesheet uses.
 */
export const SIDEBAR_DOCK_BREAKPOINT_PX = 1024

/** The `matchMedia` query for docked mode. */
export const SIDEBAR_DOCK_QUERY = `(min-width: ${SIDEBAR_DOCK_BREAKPOINT_PX}px)`

/**
 * Anything that is not exactly `"open"` is closed.
 *
 * Strict rather than truthy, for the same reason as the outline preference: a
 * half-written or foreign value must land on the default, not on a sidebar the
 * reader never opened.
 */
export function parseSidebarState(raw: string | null | undefined): SidebarState {
  return raw === 'open' ? 'open' : 'closed'
}

/** Read the stored state. Never throws — private mode and blocked storage both return the default. */
export function readSidebarState(): SidebarState {
  try {
    return parseSidebarState(window.localStorage.getItem(SIDEBAR_STORAGE_KEY))
  } catch {
    return 'closed'
  }
}

/** Persist the state. Never throws; a failed write costs the preference, not the page. */
export function storeSidebarState(state: SidebarState): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, state)
  } catch {
    /* private mode, blocked storage — this session still works, it just won't be remembered */
  }
}

/**
 * Apply the state to the document.
 *
 * `closed` REMOVES the attribute rather than setting it to `"closed"`, so the
 * CSS selector stays a plain `[data-sidebar='open']` and there is exactly one
 * state that means "inset the page".
 */
export function applySidebarState(
  state: SidebarState,
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }
): void {
  if (state === 'open') root.setAttribute(SIDEBAR_ATTRIBUTE, 'open')
  else root.removeAttribute(SIDEBAR_ATTRIBUTE)
}
