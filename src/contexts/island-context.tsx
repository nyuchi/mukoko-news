'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * What a page contributes to the floating island.
 *
 * The island's two ends are fixed — the way home and the way to your account —
 * and everything between them belongs to the page you are on. An article
 * offers like, save, share and open-at-the-publisher; a page with nothing of
 * its own offers nothing and the island falls back to plain navigation.
 */
export interface IslandAction {
  /** Stable across renders; it is the React key and the signature below. */
  id: string
  label: string
  icon: LucideIcon
  /** Rendered as a link when set, a button otherwise. */
  href?: string
  /** A link that leaves the app gets `target=_blank` and the rel guard. */
  external?: boolean
  onSelect?: () => void
  /** Pressed state — liked, saved. Rendered as `aria-pressed`. */
  active?: boolean
  /** Shown instead of the label when present. A like count, chiefly. */
  count?: number
  /** `primary` is the one call to action; `success` is a completed one. */
  emphasis?: 'default' | 'primary' | 'success' | 'destructive'
  /** Overrides the visible label for screen readers when the label is a count. */
  ariaLabel?: string
}

interface IslandContextValue {
  actions: IslandAction[] | null
  setActions: (actions: IslandAction[] | null) => void
}

const IslandContext = createContext<IslandContextValue | null>(null)

export function IslandProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActionsState] = useState<IslandAction[] | null>(null)
  const setActions = useCallback((next: IslandAction[] | null) => setActionsState(next), [])
  const value = useMemo(() => ({ actions, setActions }), [actions, setActions])
  return <IslandContext.Provider value={value}>{children}</IslandContext.Provider>
}

/**
 * Read what the current page contributed. The island itself is the only
 * consumer; pages write through `useIslandActions`.
 */
export function useIsland(): IslandContextValue {
  const context = useContext(IslandContext)
  if (!context) throw new Error('useIsland must be used within an IslandProvider')
  return context
}

/**
 * Everything about an action that can CHANGE what it does or says.
 *
 * This is the effect's dependency, and getting it right is the whole
 * correctness argument. The handlers a page passes are closures — `handleLike`
 * captures `isLiked` and `likesCount` — and storing a stale one would mean a
 * tap that toggles the wrong way. Functions cannot be compared, so instead the
 * signature covers every piece of state those closures read: pressed state and
 * count are in it, and a page whose handler depends on something else must
 * surface that here (as a changing `label`, say) or the island will keep
 * calling the closure it first stored.
 */
function signatureOf(actions: IslandAction[] | null): string {
  if (!actions) return ''
  return actions
    .map((a) => [a.id, a.label, a.href ?? '', a.active ? 1 : 0, a.count ?? '', a.emphasis ?? ''].join(':'))
    .join('|')
}

/**
 * Contribute this page's actions to the island for as long as it is mounted.
 *
 * Clears on unmount, so navigating away from an article returns the island to
 * plain navigation rather than leaving the last article's Like button floating
 * over an unrelated page.
 */
export function useIslandActions(actions: IslandAction[] | null): void {
  const { setActions } = useIsland()

  // The freshest closures, captured every render. The effect below reads this
  // rather than its own captured `actions`, so a re-register always stores
  // handlers from the render whose state triggered it.
  const latest = useRef(actions)
  latest.current = actions

  const signature = signatureOf(actions)

  useEffect(() => {
    setActions(latest.current)
    return () => setActions(null)
  }, [signature, setActions])
}
